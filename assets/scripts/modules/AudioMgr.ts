import {
    assetManager,
    AssetManager,
    AudioClip,
    AudioSource,
    director,
    Node,
    resources,
    sys,
    tween,
    Tween,
} from "cc";

/** 模块私有 localStorage 键（独立于 StorageMgr，便于单独安装/卸载） */
const STORAGE_BGM_VOLUME = "audio_mgr_bgm_volume";
const STORAGE_SFX_VOLUME = "audio_mgr_sfx_volume";
const STORAGE_BGM_MUTE = "audio_mgr_bgm_mute";
const STORAGE_SFX_MUTE = "audio_mgr_sfx_mute";
/** 旧版键名，仅用于读取迁移 */
const LEGACY_STORAGE_BGM_VOLUME = "audio_bgm_volume";
const LEGACY_STORAGE_SFX_VOLUME = "audio_sfx_volume";
const LEGACY_STORAGE_BGM_MUTE = "audio_bgm_mute";
const LEGACY_STORAGE_SFX_MUTE = "audio_sfx_mute";

/** 播放结果特殊 taskId（模块内使用，不导出） */
const AudioResult = {
    /** 静音，未创建任务 */
    MUTED: 0,
    /** 播放失败，未创建任务 */
    FAILED: -1,
    /** 被限流跳过，未创建任务 */
    THROTTLED: -2,
} as const;

const DEFAULT_SFX_POOL_MAX = 16;
const SETTINGS_SAVE_DEBOUNCE_MS = 200;
const TASK_WAIT_TIMEOUT_MS = 30000;
const SFX_THROTTLE_MAP_MAX = 128;
const SFX_THROTTLE_MAX_AGE_MS = 60000;
const VOLUME_RETARGET_FADE_SEC = 0.1;

type AudioTaskId = number;

interface IPendingBgm {
    kind: "path" | "clip";
    item?: IAudioLoadItem;
    clip?: AudioClip;
    options: IPlayAudioOptions;
}

/** 任务状态（模块内使用，不导出） */
enum AudioTaskStatus {
    Loading = "loading",
    Playing = "playing",
    Paused = "paused",
    Stopped = "stopped",
    Finished = "finished",
    Failed = "failed",
}

/** getTask 返回值结构（模块内使用，不导出） */
interface AudioTaskInfo {
    readonly id: AudioTaskId;
    readonly type: "bgm" | "sfx";
    readonly status: AudioTaskStatus;
    readonly clip: AudioClip | null;
    readonly path: string;
    readonly source: AudioSource | null;
    readonly loop: boolean;
    readonly volume: number;
    readonly playing: boolean;
    readonly currentTime: number;
    readonly duration: number;
}

interface IAudioLoadItem {
    path: string;
    bundle: string;
}

interface IPlayAudioOptions {
    loop?: boolean;
    volume?: number;
    /** 淡入时长（秒），BGM 切换时可与旧曲 crossfade */
    fadeIn?: number;
    /** 淡出时长（秒），stopTask / 被新 BGM 替换时生效 */
    fadeOut?: number;
    /** 同路径 SFX 最小播放间隔（毫秒），默认使用 sfxDefaultThrottleMs */
    throttleMs?: number;
    /** 自然播放完成时回调（loop 为 true 时不触发） */
    onComplete?: () => void;
    /** 被 stopTask 中断时回调 */
    onStop?: () => void;
}

interface IAudioTask {
    id: AudioTaskId;
    type: "bgm" | "sfx";
    status: AudioTaskStatus;
    clip: AudioClip | null;
    path: string;
    bundle: string;
    source: AudioSource | null;
    loop: boolean;
    volume: number;
    fadeIn: number;
    fadeOut: number;
    onComplete?: () => void;
    onStop?: () => void;
    throttleKey?: string;
    shouldRecordThrottle: boolean;
}

/**
 * 音频管理器
 *
 * **模块独立**：仅依赖 Cocos `cc` API，不引用 `storageMgr` / `assetMgr` / `logMgr` 等其他模块；
 * 音量持久化使用模块私有 `sys.localStorage` 键，资源加载与缓存由本模块自行管理，
 * 可单独安装或卸载，不依赖项目内其他 Manager。
 *
 * - 每次播放返回 taskID，可精准控制暂停 / 恢复 / 停止
 * - 通过 getTask(taskID) 获取播放实例与状态
 * - BGM 双 AudioSource crossfade，同时仅保留一个活跃任务
 * - SFX AudioSource 对象池复用，支持叠加
 * - 失败返回 -1、静音返回 0、限流返回 -2，均不创建任务；成功返回 >0 的 taskId
 * - BGM 静音时播放请求记入待播队列，取消静音后自动播放
 *
 * @example
 * const taskId = await m.audioMgr.playBgm({ path: "audio/bgm_main", bundle: "resources" }, { loop: true, fadeIn: 1 });
 * m.audioMgr.setBgmVolume(0.8);
 */
export class AudioMgr implements egf.IModule {

    /** 模块标识，用于 egf 模块系统注册，固定值为 `"audioMgr"` */
    key = "audioMgr";

    private _ownerRoot: Node;
    private _bgmRoot: Node = null!;
    private _sfxRoot: Node = null!;
    private _bgmSourceA: AudioSource = null!;
    private _bgmSourceB: AudioSource = null!;
    private _activeBgmSource: AudioSource = null!;

    private _clipCache = new Map<string, AudioClip>();
    private _loadingPromises = new Map<string, Promise<AudioClip | null>>();
    private _bundleCache = new Map<string, AssetManager.Bundle>();

    private _tasks = new Map<AudioTaskId, IAudioTask>();
    private _sourceTaskMap = new Map<AudioSource, IAudioTask>();
    private _sourceEndedHandler = new WeakMap<AudioSource, () => void>();

    private _sfxPool: AudioSource[] = [];
    private _sfxPoolCreated = 0;
    private _sfxPoolMax = DEFAULT_SFX_POOL_MAX;

    private _sfxLastPlayTime = new Map<string, number>();
    private _sfxDefaultThrottleMs = 0;

    private _pendingBgm: IPendingBgm | null = null;
    private _fadingSources = new WeakSet<AudioSource>();

    private _nextTaskId = 1;
    private _activeBgmTaskId: AudioTaskId | null = null;
    private _userPausedTasks = new Set<AudioTaskId>();
    private _destroyed = false;

    private _bgmVolume = 1;
    private _sfxVolume = 1;
    private _bgmMute = false;
    private _sfxMute = false;

    private _saveSettingsTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * 创建音频管理器实例
     * @param node AudioSource 挂载的持久父节点（建议挂到游戏常驻根节点，随场景不销毁）
     */
    constructor(node: Node) {
        this._ownerRoot = node;
        this._createAudioRoots();
        this._loadSettings();
    }

    /**
     * SFX 对象池上限（活跃播放数 + 空闲池内数量之和的上限），也就是同时播放的音效数量上限。
     * 池满时新的 SFX 播放请求会失败并返回 -1，不会创建任务。
     */
    get sfxPoolMax(): number {
        return this._sfxPoolMax;
    }

    /**
     * 设置 SFX 对象池上限，最小为 1；超出部分空闲节点会被销毁
     * @param value 池上限
     */
    set sfxPoolMax(value: number) {
        this._sfxPoolMax = Math.max(1, Math.floor(value));
        this._trimSfxPool();
    }

    /**
     * 同路径 SFX 默认限流间隔（毫秒）
     * 0 表示不限流；可被单次 playSfx 的 options.throttleMs 覆盖
     */
    get sfxDefaultThrottleMs(): number {
        return this._sfxDefaultThrottleMs;
    }

    /**
     * 设置同路径 SFX 默认限流间隔（毫秒），小于 0 时按 0 处理
     * @param value 限流间隔（毫秒）
     */
    set sfxDefaultThrottleMs(value: number) {
        this._sfxDefaultThrottleMs = Math.max(0, value);
    }

    onInit(): void {
        if (this._destroyed) {
            this._createAudioRoots();
            this._destroyed = false;
        }
        console.log("[AudioMgr] onInit");
    }

    /**
     * 模块卸载生命周期回调（egf.IModule）
     * 立即停止所有任务（跳过淡出）、持久化音量设置、清空资源缓存与对象池
     */
    onStop(): void {
        this._flushSaveSettings();
        this._destroyed = true;
        this._pendingBgm = null;
        this._userPausedTasks.clear();
        director.getScheduler().unscheduleAllForTarget(this._bgmRoot);
        this.stopAllTasks(true);
        for (const source of [this._bgmSourceA, this._bgmSourceB]) {
            Tween.stopAllByTarget(source);
            source.stop();
        }
        for (const clip of this._clipCache.values()) {
            assetManager.releaseAsset(clip);
        }
        this._clipCache.clear();
        this._loadingPromises.clear();
        this._bundleCache.clear();
        this._sfxLastPlayTime.clear();

        for (const source of this._sfxPool) {
            source?.node?.destroy();
        }
        this._sfxPool.length = 0;
        this._sfxPoolCreated = 0;
        this._sourceTaskMap.clear();
        this._activeBgmTaskId = null;
        this._bgmRoot.destroy();
        this._sfxRoot.destroy();
        console.log("[AudioMgr] onStop");
    }

    // ── 播放 API ─────────────────────────────────────────

    /**
     * 播放背景音乐（按资源路径异步加载）
     * 新 BGM 会替换当前活跃 BGM；若旧曲仍在播放且新曲设置了 fadeIn，则自动 crossfade
     * @param item 音频资源项（path + bundle）
     * @param options.loop 是否循环，默认 true
     * @param options.volume 任务音量倍率 0~1，默认 1（再乘以 BGM 总音量 bgmVolume）
     * @param options.fadeIn 淡入时长（秒），默认 0；大于 0 时切换 BGM 可与旧曲交叉淡入淡出
     * @param options.fadeOut 淡出时长（秒），默认 0；被 stopTask / 新 BGM 替换时生效
     * @param options.onComplete 非循环音频自然播放结束时的回调
     * @param options.onStop 被 stopTask / stopBgm / 新 BGM 替换中断时的回调
     * @returns 大于 0 为任务 ID；-1 失败（路径无效、已销毁、播放异常）；0 通道静音（未创建任务，请求会记入待播 BGM 队列，取消静音后自动播放）
     */
    playBgm(item: IAudioLoadItem, options: IPlayAudioOptions = {}): number {
        return this._playByPath("bgm", item, options);
    }

    /**
     * 播放背景音乐（使用已加载的 AudioClip，无需异步等待）
     * @param clip 已加载的音频剪辑
     * @param options.loop 是否循环，默认 true
     * @param options.volume 任务音量倍率 0~1，默认 1（再乘以 BGM 总音量 bgmVolume）
     * @param options.fadeIn 淡入时长（秒），默认 0
     * @param options.fadeOut 淡出时长（秒），默认 0
     * @param options.onComplete 非循环音频自然播放结束时的回调
     * @param options.onStop 被中断停止时的回调
     * @returns 大于 0 为任务 ID；-1 失败；0 通道静音（未创建任务，请求会记入待播 BGM 队列，取消静音后自动播放）
     */
    playBgmClip(clip: AudioClip, options: IPlayAudioOptions = {}): number {
        return this._playByClip("bgm", clip, options);
    }

    /**
     * 播放音效（按资源路径异步加载，支持多实例叠加）
     * @param item 音频资源项（path + bundle）
     * @param options.loop 是否循环，默认 false
     * @param options.volume 任务音量倍率 0~1，默认 1（再乘以 SFX 总音量 sfxVolume）
     * @param options.throttleMs 同路径 / 同 Clip 最小播放间隔（毫秒），默认使用 sfxDefaultThrottleMs
     * @param options.onComplete 非循环音频自然播放结束时的回调
     * @param options.onStop 被 stopTask 中断时的回调
     * @returns 大于 0 为任务 ID；-1 失败；-2 被限流跳过；0 通道静音（均未创建任务）
     */
    playSfx(item: IAudioLoadItem, options: IPlayAudioOptions = {}): number {
        return this._playByPath("sfx", item, options);
    }

    /**
     * 播放音效（使用已加载的 AudioClip，支持多实例叠加）
     * @param clip 已加载的音频剪辑
     * @param options.loop 是否循环，默认 false
     * @param options.volume 任务音量倍率 0~1，默认 1（再乘以 SFX 总音量 sfxVolume）
     * @param options.throttleMs 同 Clip 最小播放间隔（毫秒），默认使用 sfxDefaultThrottleMs
     * @param options.onComplete 非循环音频自然播放结束时的回调
     * @param options.onStop 被 stopTask 中断时的回调
     * @returns 大于 0 为任务 ID；-1 失败（clip 无效、对象池已满、播放异常）；0 通道静音（未创建任务）
     */
    playSfxClip(clip: AudioClip, options: IPlayAudioOptions = {}): number {
        return this._playByClip("sfx", clip, options);
    }

    /**
     * 异步播放背景音乐，在音频真正进入 Playing 状态后 resolve
     * @param item 音频资源项（path + bundle）
     * @param options 同 playBgm 的 options
     * @returns Promise：大于 0 为任务 ID；-1 加载/播放失败或超时（30s）；0 通道静音；-2 不适用（BGM 无限流）
     */
    async playBgmAsync(item: IAudioLoadItem, options: IPlayAudioOptions = {}): Promise<number> {
        const id = this.playBgm(item, options);
        return id > 0 ? this._waitTaskReady(id) : id;
    }

    /**
     * 异步播放音效，在音频真正进入 Playing 状态后 resolve
     * @param item 音频资源项（path + bundle）
     * @param options 同 playSfx 的 options
     * @returns Promise：大于 0 为任务 ID；-1 加载/播放失败或超时（30s）；0 通道静音；-2 被限流跳过
     */
    async playSfxAsync(item: IAudioLoadItem, options: IPlayAudioOptions = {}): Promise<number> {
        const id = this.playSfx(item, options);
        return id > 0 ? this._waitTaskReady(id) : id;
    }

    // ── 任务控制 ─────────────────────────────────────────

    /**
     * 获取播放任务详情
     * @param taskId 播放任务 ID（须大于 0）
     * @returns 任务信息（含 AudioSource、播放进度等）；taskId <= 0 或任务不存在时返回 null
     */
    getTask(taskId: number): AudioTaskInfo | null {
        if (taskId <= 0) {
            return null;
        }
        const task = this._tasks.get(taskId);
        if (!task) {
            return null;
        }
        return this._toTaskInfo(task);
    }

    /**
     * 暂停指定任务
     * @param taskId 播放任务 ID
     * @returns 是否暂停成功；任务不存在、非 Playing 状态、taskId <= 0 时返回 false
     */
    pauseTask(taskId: number): boolean {
        if (taskId <= 0) {
            return false;
        }
        const task = this._tasks.get(taskId);
        if (!task || task.status !== AudioTaskStatus.Playing || !task.source) {
            return false;
        }
        return this._pauseTaskInternal(task, true);
    }

    /**
     * 恢复播放指定任务
     * @param taskId 播放任务 ID
     * @returns 是否恢复成功；任务不存在、非 Paused 状态、通道静音或 taskId <= 0 时返回 false
     */
    resumeTask(taskId: number): boolean {
        if (taskId <= 0) {
            return false;
        }
        const task = this._tasks.get(taskId);
        if (!task || task.status !== AudioTaskStatus.Paused || !task.source) {
            return false;
        }
        if (this._isChannelMuted(task.type)) {
            return false;
        }
        task.source.volume = this._calcSourceVolume(task);
        task.source.play();
        task.status = AudioTaskStatus.Playing;
        this._userPausedTasks.delete(taskId);
        return true;
    }

    /**
     * 停止并移除指定任务
     * 若任务设置了 fadeOut 且正在播放，则先淡出再停止（immediate 为 true 时立即跳过淡出）；Loading 状态会立即取消并触发 onStop
     * @param taskId 播放任务 ID
     * @param immediate 是否立即跳过淡出，默认 false
     * @returns 是否停止成功；成功时触发 onStop 回调（若已设置）
     */
    stopTask(taskId: number, immediate = false): boolean {
        if (taskId <= 0) {
            return false;
        }
        const task = this._tasks.get(taskId);
        if (!task) {
            return false;
        }
        if (task.status === AudioTaskStatus.Loading) {
            task.status = AudioTaskStatus.Stopped;
            task.onStop?.();
            this._removeTask(task);
            return true;
        }
        if (!task.source) {
            return false;
        }
        if (!immediate && task.fadeOut > 0 && task.source.playing) {
            this._fadeOutAndStopTask(task, true);
            return true;
        }
        this._stopTaskInternal(task, true);
        return true;
    }

    /**
     * 设置任务的自然播放完成回调
     * @param taskId 播放任务 ID
     * @param cb 回调函数；传 null 可清除已有回调
     * @returns 是否设置成功；loop 为 true 时 onComplete 不会在自然结束时触发
     */
    setTaskOnComplete(taskId: number, cb: (() => void) | null): boolean {
        if (taskId <= 0) {
            return false;
        }
        const task = this._tasks.get(taskId);
        if (!task) {
            return false;
        }
        task.onComplete = cb ?? undefined;
        return true;
    }

    /**
     * 设置任务被中断停止时的回调
     * @param taskId 播放任务 ID
     * @param cb 回调函数；传 null 可清除已有回调
     * @returns 是否设置成功
     */
    setTaskOnStop(taskId: number, cb: (() => void) | null): boolean {
        if (taskId <= 0) {
            return false;
        }
        const task = this._tasks.get(taskId);
        if (!task) {
            return false;
        }
        task.onStop = cb ?? undefined;
        return true;
    }

    /**
     * 停止并移除所有 BGM 与 SFX 任务
     * @param immediate 是否立即跳过淡出，默认 false；模块卸载时内部传 true
     */
    stopAllTasks(immediate = false): void {
        const ids = [...this._tasks.keys()];
        ids.forEach((id) => this.stopTask(id, immediate));
    }

    /** 停止并移除所有 SFX 任务（不影响当前 BGM） */
    stopAllSfx(): void {
        for (const [id, task] of this._tasks) {
            if (task.type === "sfx") {
                this.stopTask(id);
            }
        }
    }

    // ── BGM 便捷方法 ─────────────────────────────────────

    /**
     * 停止并移除当前活跃的 BGM 任务
     * 若任务设置了 fadeOut，则先淡出再停止
     */
    stopBgm(): void {
        if (this._activeBgmTaskId !== null) {
            this.stopTask(this._activeBgmTaskId);
        }
    }

    /** 暂停当前活跃的 BGM 任务 */
    pauseBgm(): void {
        if (this._activeBgmTaskId !== null) {
            this.pauseTask(this._activeBgmTaskId);
        }
    }

    /** 恢复当前活跃的 BGM 任务（通道静音时无效） */
    resumeBgm(): void {
        if (this._activeBgmTaskId !== null) {
            this.resumeTask(this._activeBgmTaskId);
        }
    }

    /** 当前活跃的 BGM 任务 ID；无 BGM 时返回 null */
    get currentBgmTaskId(): number | null {
        return this._activeBgmTaskId;
    }

    /**
     * 当前 BGM 是否处于 Playing 状态
     * @returns 活跃 BGM 任务存在且状态为 Playing 时返回 true
     */
    isBgmPlaying(): boolean {
        const task = this._activeBgmTaskId !== null
            ? this._tasks.get(this._activeBgmTaskId)
            : null;
        return task?.status === AudioTaskStatus.Playing;
    }

    // ── 音量 / 静音 ──────────────────────────────────────

    /** BGM 总音量（0~1），从 localStorage 读取初始值 */
    get bgmVolume(): number {
        return this._bgmVolume;
    }

    /** SFX 总音量（0~1），从 localStorage 读取初始值 */
    get sfxVolume(): number {
        return this._sfxVolume;
    }

    /** BGM 是否静音；静音时新 BGM 请求返回 0 并记入待播队列，已有任务会被暂停 */
    get bgmMute(): boolean {
        return this._bgmMute;
    }

    /** SFX 是否静音；静音时新 SFX 播放请求返回 0，已有任务会被暂停 */
    get sfxMute(): boolean {
        return this._sfxMute;
    }

    /**
     * 设置 BGM 总音量，同步到所有进行中的 BGM 任务并防抖持久化到 localStorage
     * @param volume 音量值，自动限制在 0~1
     */
    setBgmVolume(volume: number): void {
        this._bgmVolume = this._clamp01(volume);
        this._syncChannelVolume("bgm");
        this._scheduleSaveSettings();
    }

    /**
     * 设置 SFX 总音量，同步到所有进行中的 SFX 任务并防抖持久化到 localStorage
     * @param volume 音量值，自动限制在 0~1
     */
    setSfxVolume(volume: number): void {
        this._sfxVolume = this._clamp01(volume);
        this._syncChannelVolume("sfx");
        this._scheduleSaveSettings();
    }

    /**
     * 设置 BGM 静音
     * @param mute true 暂停所有 BGM 任务；false 恢复因静音而暂停的 BGM 任务，并自动播放待播 BGM（若有）
     */
    setBgmMute(mute: boolean): void {
        this._bgmMute = mute;
        this._applyChannelMute("bgm");
        this._scheduleSaveSettings();
        if (!mute) {
            this._playPendingBgm();
        }
    }

    /**
     * 设置 SFX 静音
     * @param mute true 暂停所有 SFX 任务；false 恢复因静音而暂停的 SFX 任务
     */
    setSfxMute(mute: boolean): void {
        this._sfxMute = mute;
        this._applyChannelMute("sfx");
        this._scheduleSaveSettings();
    }

    // ── 预加载 ──────────────────────────────────────────

    /**
     * 预加载音频资源到内部缓存（并发加载，同路径自动去重）
     * @param items 音频资源项列表
     */
    async preload(items: IAudioLoadItem[]): Promise<void> {
        await Promise.all(items.map((item) => this._loadClip(item)));
    }

    /**
     * 释放已缓存的音频资源
     * @param item 音频资源项（path + bundle）
     * @returns true 释放成功；仍有任务引用或缓存中不存在时返回 false
     */
    releaseClip(item: IAudioLoadItem): boolean {
        const normalized = this._normalizeLoadItem(item);
        if (!normalized) {
            return false;
        }
        const key = this._cacheKey(normalized);
        const clip = this._clipCache.get(key);
        if (this._isClipInUse(key, clip)) {
            console.warn(`[AudioMgr] 资源仍被引用，跳过释放: ${key}`);
            return false;
        }
        if (!clip) {
            return false;
        }
        this._clipCache.delete(key);
        assetManager.releaseAsset(clip);
        return true;
    }

    // ── 内部：创建与播放 ─────────────────────────────────

    private _playByPath(
        type: "bgm" | "sfx",
        item: IAudioLoadItem,
        options: IPlayAudioOptions,
    ): number {
        const normalized = this._normalizeLoadItem(item);
        if (!normalized) {
            return AudioResult.FAILED;
        }
        if (type === "bgm") {
            const muted = this._queueBgmIfMuted(normalized, null, options);
            if (muted !== null) {
                return muted;
            }
            this._pendingBgm = null;
        }

        const rejected = this._checkPlayInput(type, normalized, options);
        if (rejected !== null) {
            return rejected;
        }

        const task = this._createTask(type, normalized, options);
        task.status = AudioTaskStatus.Loading;

        if (type === "bgm") {
            this._replaceActiveBgm(task);
        }

        this._loadClip(normalized).then((clip) => {
            if (this._destroyed || !this._isCurrentTask(task)) {
                return;
            }
            if (task.status === AudioTaskStatus.Stopped) {
                return;
            }
            if (!clip) {
                this._failTask(task);
                return;
            }
            if (type === "bgm" && this._activeBgmTaskId !== task.id) {
                this._removeTask(task);
                return;
            }
            if (!this._startTask(task, clip)) {
                this._failTask(task);
            }
        });

        return task.id;
    }

    private _playByClip(
        type: "bgm" | "sfx",
        clip: AudioClip,
        options: IPlayAudioOptions,
    ): number {
        if (type === "bgm") {
            const muted = this._queueBgmIfMuted(null, clip, options);
            if (muted !== null) {
                return muted;
            }
            this._pendingBgm = null;
        }

        const rejected = this._checkPlayInput(type, null, options, clip);
        if (rejected !== null) {
            return rejected;
        }

        const task = this._createTask(type, { path: "", bundle: "resources" }, options);
        if (type === "sfx") {
            task.throttleKey = this._clipThrottleKey(clip);
        }
        if (type === "bgm") {
            this._replaceActiveBgm(task);
        }
        if (!this._startTask(task, clip)) {
            this._failTask(task);
            return AudioResult.FAILED;
        }
        return task.id;
    }

    private _checkPlayInput(
        type: "bgm" | "sfx",
        item: IAudioLoadItem | null,
        options: IPlayAudioOptions,
        clip?: AudioClip,
    ): number | null {
        if (this._destroyed) {
            return AudioResult.FAILED;
        }
        if (type === "sfx" && this._sfxMute) {
            return AudioResult.MUTED;
        }
        if (!item && !clip) {
            return AudioResult.FAILED;
        }
        if (type === "sfx") {
            const throttle = options.throttleMs ?? this._sfxDefaultThrottleMs;
            if (throttle > 0) {
                const key = clip
                    ? this._clipThrottleKey(clip)
                    : this._cacheKey(item!);
                const now = Date.now();
                const last = this._sfxLastPlayTime.get(key) ?? 0;
                if (now - last < throttle) {
                    return AudioResult.THROTTLED;
                }
                this._sfxLastPlayTime.set(key, now);
                this._pruneSfxThrottleMap();
            }
        }
        return null;
    }

    private _queueBgmIfMuted(
        item: IAudioLoadItem | null,
        clip: AudioClip | null,
        options: IPlayAudioOptions,
    ): number | null {
        if (!this._bgmMute || this._destroyed) {
            return null;
        }
        if (clip) {
            this._pendingBgm = { kind: "clip", clip, options };
        } else if (item) {
            this._pendingBgm = { kind: "path", item, options };
        } else {
            return AudioResult.FAILED;
        }
        return AudioResult.MUTED;
    }

    private _playPendingBgm(): void {
        const pending = this._pendingBgm;
        if (!pending || this._bgmMute || this._destroyed) {
            return;
        }
        this._pendingBgm = null;
        if (pending.kind === "clip" && pending.clip) {
            this.playBgmClip(pending.clip, pending.options);
        } else if (pending.kind === "path" && pending.item) {
            this.playBgm(pending.item, pending.options);
        }
    }

    private _pauseTaskInternal(task: IAudioTask, markUserPause: boolean): boolean {
        if (!task.source || task.status !== AudioTaskStatus.Playing) {
            return false;
        }
        Tween.stopAllByTarget(task.source);
        task.source.pause();
        task.status = AudioTaskStatus.Paused;
        if (markUserPause) {
            this._userPausedTasks.add(task.id);
        }
        return true;
    }

    private _failTask(task: IAudioTask): void {
        this._rollbackSfxThrottle(task);
        task.status = AudioTaskStatus.Failed;
        task.onStop?.();
        this._removeTask(task);
    }

    private _createTask(
        type: "bgm" | "sfx",
        item: IAudioLoadItem,
        options: IPlayAudioOptions,
    ): IAudioTask {
        const id = this._nextTaskId++;
        const task: IAudioTask = {
            id,
            type,
            status: AudioTaskStatus.Loading,
            clip: null,
            path: item.path,
            bundle: item.bundle,
            source: null,
            loop: options.loop ?? (type === "bgm"),
            volume: this._clamp01(options.volume ?? 1),
            fadeIn: options.fadeIn ?? 0,
            fadeOut: options.fadeOut ?? 0,
            onComplete: options.onComplete,
            onStop: options.onStop,
            throttleKey: type === "sfx" && item.path ? this._cacheKey(item) : undefined,
            shouldRecordThrottle: type === "sfx" && (options.throttleMs ?? this._sfxDefaultThrottleMs) > 0,
        };
        this._tasks.set(id, task);
        return task;
    }

    private _startTask(task: IAudioTask, clip: AudioClip): boolean {
        try {
            if (task.type === "bgm") {
                return this._startBgmTask(task, clip);
            }
            return this._startSfxTask(task, clip);
        } catch (err) {
            console.warn(`[AudioMgr] 播放失败: task ${task.id}`, err);
            return false;
        }
    }

    private _startBgmTask(task: IAudioTask, clip: AudioClip): boolean {
        const targetVolume = this._calcSourceVolume(task);
        const oldTask = this._findPlayingBgmTask(task.id);
        const oldSource = oldTask?.source ?? null;
        const canCrossfade = task.fadeIn > 0 && !!oldSource?.playing;

        let source: AudioSource;
        if (canCrossfade) {
            source = this._getInactiveBgmSource();
        } else {
            source = this._activeBgmSource;
            if (oldTask && oldSource === source && oldTask.id !== task.id) {
                // 新任务复用同一 AudioSource 时，先取消旧任务残留的淡出/回调，避免后续异步回调误停新曲。
                Tween.stopAllByTarget(oldSource);
                this._fadingSources.delete(oldSource);
                this._detachSource(oldSource);
                oldTask.source = null;
                oldTask.status = AudioTaskStatus.Stopped;
                oldTask.onStop?.();
                this._removeTask(oldTask);
            }
            if (oldSource && oldSource !== source) {
                this._detachSource(oldSource);
                Tween.stopAllByTarget(oldSource);
                oldSource.stop();
            }
        }

        this._bindSourceTask(source, task);
        source.clip = clip;
        source.loop = task.loop;
        source.volume = canCrossfade || task.fadeIn > 0 ? 0 : targetVolume;
        task.clip = clip;
        task.status = AudioTaskStatus.Playing;
        source.play();

        this._activeBgmSource = source;

        if (canCrossfade && oldSource && oldTask) {
            this._fadeVolume(source, 0, targetVolume, task.fadeIn);
            this._fadeVolume(oldSource, oldSource.volume, 0, task.fadeIn, () => {
                if (this._destroyed) {
                    return;
                }
                if (oldTask.source === oldSource) {
                    this._detachSource(oldSource);
                    oldSource.stop();
                }
                if (oldTask.id !== task.id && this._tasks.has(oldTask.id)) {
                    oldTask.status = AudioTaskStatus.Stopped;
                    oldTask.onStop?.();
                    this._removeTask(oldTask);
                }
            });
        } else if (task.fadeIn > 0) {
            this._fadeVolume(source, 0, targetVolume, task.fadeIn);
        }

        return true;
    }

    private _startSfxTask(task: IAudioTask, clip: AudioClip): boolean {
        const source = this._acquireSfxSource();
        if (!source) {
            console.warn(`[AudioMgr] SFX 池已满 (max=${this._sfxPoolMax})，跳过播放`);
            return false;
        }

        this._bindSourceTask(source, task);
        source.clip = clip;
        source.loop = task.loop;
        source.volume = this._calcSourceVolume(task);
        task.clip = clip;
        task.status = AudioTaskStatus.Playing;
        source.play();
        this._recordSfxThrottle(task);
        return true;
    }

    private _onTaskEnded(task: IAudioTask): void {
        if (task.loop) {
            return;
        }
        task.status = AudioTaskStatus.Finished;
        task.onComplete?.();
        this._removeTask(task);
    }

    private _recordSfxThrottle(task: IAudioTask): void {
        if (task.type !== "sfx" || !task.shouldRecordThrottle || !task.throttleKey) {
            return;
        }
        this._sfxLastPlayTime.set(task.throttleKey, Date.now());
        this._pruneSfxThrottleMap();
    }

    private _rollbackSfxThrottle(task: IAudioTask): void {
        if (task.type !== "sfx" || !task.shouldRecordThrottle || !task.throttleKey) {
            return;
        }
        this._sfxLastPlayTime.delete(task.throttleKey);
    }

    private _stopTaskInternal(task: IAudioTask, triggerOnStop: boolean): void {
        if (task.source) {
            Tween.stopAllByTarget(task.source);
            this._fadingSources.delete(task.source);
            task.source.stop();
        }
        task.status = AudioTaskStatus.Stopped;
        if (triggerOnStop) {
            task.onStop?.();
        }
        this._removeTask(task);
    }

    private _fadeOutAndStopTask(task: IAudioTask, triggerOnStop: boolean): void {
        if (!task.source) {
            this._stopTaskInternal(task, triggerOnStop);
            return;
        }
        const source = task.source;
        Tween.stopAllByTarget(source);
        this._fadeVolume(source, source.volume, 0, task.fadeOut, () => {
            if (this._destroyed || !this._isCurrentTask(task)) {
                return;
            }
            this._stopTaskInternal(task, triggerOnStop);
        });
    }

    private _removeTask(task: IAudioTask): void {
        if (task.source) {
            Tween.stopAllByTarget(task.source);
            this._fadingSources.delete(task.source);
            this._detachSource(task.source);
            if (task.type === "sfx") {
                this._releaseSfxSource(task.source);
            } else {
                task.source.stop();
            }
        }
        task.source = null;
        this._tasks.delete(task.id);
        this._userPausedTasks.delete(task.id);
        this._clearActiveBgmIfMatch(task);
    }

    private _clearActiveBgmIfMatch(task: IAudioTask): void {
        if (task.type === "bgm" && this._activeBgmTaskId === task.id) {
            this._activeBgmTaskId = null;
        }
    }

    private _isCurrentTask(task: IAudioTask): boolean {
        return this._tasks.get(task.id) === task;
    }

    private _replaceActiveBgm(newTask: IAudioTask): void {
        const oldId = this._activeBgmTaskId;
        if (oldId !== null && oldId !== newTask.id) {
            const oldTask = this._tasks.get(oldId);
            if (oldTask) {
                const deferToCrossfade = newTask.fadeIn > 0 && oldTask.source?.playing;
                if (!deferToCrossfade) {
                    if (oldTask.fadeOut > 0 && oldTask.source?.playing) {
                        this._fadeOutAndStopTask(oldTask, true);
                    } else {
                        this.stopTask(oldId);
                    }
                }
            }
        }
        this._activeBgmTaskId = newTask.id;
    }

    // ── 内部：AudioSource 池与绑定 ───────────────────────

    private _createAudioRoots(): void {
        this._bgmRoot = new Node("AudioBgmRoot");
        this._sfxRoot = new Node("AudioSfxRoot");
        this._ownerRoot.addChild(this._bgmRoot);
        this._ownerRoot.addChild(this._sfxRoot);

        this._bgmSourceA = this._createPersistentSource(this._bgmRoot, "BgmA");
        this._bgmSourceB = this._createPersistentSource(this._bgmRoot, "BgmB");
        this._activeBgmSource = this._bgmSourceA;
    }

    private _createPersistentSource(parent: Node, name: string): AudioSource {
        const node = new Node(name);
        parent.addChild(node);
        const source = node.addComponent(AudioSource);
        this._bindSourceEnded(source);
        return source;
    }

    private _acquireSfxSource(): AudioSource | null {
        if (this._sfxPool.length > 0) {
            return this._sfxPool.pop()!;
        }
        if (this._countTotalSfxSources() >= this._sfxPoolMax) {
            return null;
        }
        const node = new Node(`SfxPool_${this._sfxPoolCreated++}`);
        this._sfxRoot.addChild(node);
        const source = node.addComponent(AudioSource);
        this._bindSourceEnded(source);
        return source;
    }

    private _releaseSfxSource(source: AudioSource): void {
        source.stop();
        source.clip = null;
        if (this._countTotalSfxSources() < this._sfxPoolMax) {
            this._sfxPool.push(source);
        } else {
            const handler = this._sourceEndedHandler.get(source);
            if (handler) {
                source.node.off(AudioSource.EventType.ENDED, handler, this);
                this._sourceEndedHandler.delete(source);
            }
            source.node.destroy();
        }
    }

    private _trimSfxPool(): void {
        while (this._countTotalSfxSources() > this._sfxPoolMax && this._sfxPool.length > 0) {
            const source = this._sfxPool.pop();
            source?.node.destroy();
        }
    }

    private _countActiveSfxSources(): number {
        let count = 0;
        for (const task of this._tasks.values()) {
            if (task.type === "sfx" && task.source) {
                count++;
            }
        }
        return count;
    }

    private _countTotalSfxSources(): number {
        return this._countActiveSfxSources() + this._sfxPool.length;
    }

    private _bindSourceEnded(source: AudioSource): void {
        if (this._sourceEndedHandler.has(source)) {
            return;
        }
        const onEnded = () => {
            const task = this._sourceTaskMap.get(source);
            if (task) {
                this._onTaskEnded(task);
            }
        };
        this._sourceEndedHandler.set(source, onEnded);
        source.node.on(AudioSource.EventType.ENDED, onEnded, this);
    }

    private _bindSourceTask(source: AudioSource, task: IAudioTask): void {
        this._sourceTaskMap.set(source, task);
        task.source = source;
    }

    private _detachSource(source: AudioSource): void {
        this._sourceTaskMap.delete(source);
    }

    private _getInactiveBgmSource(): AudioSource {
        return this._activeBgmSource === this._bgmSourceA
            ? this._bgmSourceB
            : this._bgmSourceA;
    }

    private _findPlayingBgmTask(excludeId: AudioTaskId): IAudioTask | null {
        for (const task of this._tasks.values()) {
            if (
                task.type === "bgm"
                && task.id !== excludeId
                && task.status === AudioTaskStatus.Playing
                && task.source?.playing
            ) {
                return task;
            }
        }
        return null;
    }

    // ── 内部：淡入淡出 ───────────────────────────────────

    private _fadeVolume(
        source: AudioSource,
        from: number,
        to: number,
        duration: number,
        onComplete?: () => void,
    ): void {
        Tween.stopAllByTarget(source);
        this._fadingSources.delete(source);
        if (duration <= 0) {
            source.volume = to;
            onComplete?.();
            return;
        }
        source.volume = from;
        this._fadingSources.add(source);
        tween(source)
            .to(duration, { volume: to })
            .call(() => {
                this._fadingSources.delete(source);
                if (this._destroyed) {
                    return;
                }
                onComplete?.();
            })
            .start();
    }

    // ── 内部：状态同步 ───────────────────────────────────

    private _toTaskInfo(task: IAudioTask): AudioTaskInfo {
        const source = task.source;
        return {
            id: task.id,
            type: task.type,
            status: task.status,
            clip: task.clip,
            path: task.path,
            source,
            loop: task.loop,
            volume: task.volume,
            playing: source?.playing ?? false,
            currentTime: source?.currentTime ?? 0,
            duration: task.clip?.getDuration() ?? 0,
        };
    }

    private _calcSourceVolume(task: IAudioTask): number {
        return task.volume * this._getChannelVolume(task.type);
    }

    private _isChannelMuted(type: "bgm" | "sfx"): boolean {
        return type === "bgm" ? this._bgmMute : this._sfxMute;
    }

    private _getChannelVolume(type: "bgm" | "sfx"): number {
        return type === "bgm" ? this._bgmVolume : this._sfxVolume;
    }

    private _syncChannelVolume(type: "bgm" | "sfx"): void {
        const scale = this._getChannelVolume(type);
        if (type === "bgm") {
            const updated = new Set<AudioSource>();
            for (const source of [this._bgmSourceA, this._bgmSourceB]) {
                const task = this._sourceTaskMap.get(source);
                if (task) {
                    this._applyVolumeToSource(source, task, scale);
                    updated.add(source);
                }
            }
            for (const task of this._tasks.values()) {
                if (task.type === "bgm" && task.source && !updated.has(task.source)) {
                    this._applyVolumeToSource(task.source, task, scale);
                }
            }
            return;
        }
        for (const task of this._tasks.values()) {
            if (task.type === "sfx" && task.source) {
                this._applyVolumeToSource(task.source, task, scale);
            }
        }
    }

    private _applyVolumeToSource(
        source: AudioSource,
        task: IAudioTask,
        scale: number,
    ): void {
        const target = task.volume * scale;
        if (this._fadingSources.has(source)) {
            this._fadeVolume(source, source.volume, target, VOLUME_RETARGET_FADE_SEC);
            return;
        }
        Tween.stopAllByTarget(source);
        source.volume = target;
    }

    private _applyChannelMute(type: "bgm" | "sfx"): void {
        if (this._isChannelMuted(type)) {
            for (const [, task] of this._tasks) {
                if (task.type === type) {
                    this._pauseTaskInternal(task, false);
                }
            }
        } else {
            for (const [id, task] of this._tasks) {
                if (
                    task.type === type
                    && task.status === AudioTaskStatus.Paused
                    && !this._userPausedTasks.has(id)
                ) {
                    this.resumeTask(id);
                }
            }
        }
    }

    private _waitTaskReady(taskId: number): Promise<number> {
        return new Promise((resolve) => {
            const deadline = Date.now() + TASK_WAIT_TIMEOUT_MS;
            const target = this._bgmRoot;
            const check = () => {
                director.getScheduler().unschedule(check, target);
                if (this._destroyed) {
                    resolve(AudioResult.FAILED);
                    return;
                }
                const task = this._tasks.get(taskId);
                if (!task) {
                    resolve(AudioResult.FAILED);
                    return;
                }
                if (task.status === AudioTaskStatus.Playing) {
                    resolve(taskId);
                    return;
                }
                if (
                    task.status === AudioTaskStatus.Failed
                    || task.status === AudioTaskStatus.Stopped
                ) {
                    resolve(AudioResult.FAILED);
                    return;
                }
                if (Date.now() >= deadline) {
                    this.stopTask(taskId, true);
                    resolve(AudioResult.FAILED);
                    return;
                }
                director.getScheduler().schedule(check, target, 0, 0, 0.016, false);
            };
            check();
        });
    }

    private _clamp01(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, Math.min(1, value));
    }

    private _readStorageItem(currentKey: string, legacyKey: string): string | null {
        const value = sys.localStorage.getItem(currentKey);
        if (value !== null && value !== "") {
            return value;
        }
        return sys.localStorage.getItem(legacyKey);
    }

    private _loadSettings(): void {
        const bgmVol = this._readStorageItem(STORAGE_BGM_VOLUME, LEGACY_STORAGE_BGM_VOLUME);
        const sfxVol = this._readStorageItem(STORAGE_SFX_VOLUME, LEGACY_STORAGE_SFX_VOLUME);
        const bgmMute = this._readStorageItem(STORAGE_BGM_MUTE, LEGACY_STORAGE_BGM_MUTE);
        const sfxMute = this._readStorageItem(STORAGE_SFX_MUTE, LEGACY_STORAGE_SFX_MUTE);

        if (bgmVol !== null && bgmVol !== "") {
            const parsed = parseFloat(bgmVol);
            if (Number.isFinite(parsed)) {
                this._bgmVolume = this._clamp01(parsed);
            }
        }
        if (sfxVol !== null && sfxVol !== "") {
            const parsed = parseFloat(sfxVol);
            if (Number.isFinite(parsed)) {
                this._sfxVolume = this._clamp01(parsed);
            }
        }
        if (bgmMute !== null && bgmMute !== "") {
            this._bgmMute = bgmMute === "1";
        }
        if (sfxMute !== null && sfxMute !== "") {
            this._sfxMute = sfxMute === "1";
        }
    }

    private _scheduleSaveSettings(): void {
        if (this._saveSettingsTimer !== null) {
            clearTimeout(this._saveSettingsTimer);
        }
        this._saveSettingsTimer = setTimeout(() => {
            this._saveSettingsTimer = null;
            this._saveSettings();
        }, SETTINGS_SAVE_DEBOUNCE_MS);
    }

    private _flushSaveSettings(): void {
        if (this._saveSettingsTimer !== null) {
            clearTimeout(this._saveSettingsTimer);
            this._saveSettingsTimer = null;
        }
        this._saveSettings();
    }

    private _saveSettings(): void {
        if (this._destroyed) {
            return;
        }
        sys.localStorage.setItem(STORAGE_BGM_VOLUME, String(this._bgmVolume));
        sys.localStorage.setItem(STORAGE_SFX_VOLUME, String(this._sfxVolume));
        sys.localStorage.setItem(STORAGE_BGM_MUTE, this._bgmMute ? "1" : "0");
        sys.localStorage.setItem(STORAGE_SFX_MUTE, this._sfxMute ? "1" : "0");
    }

    private _cacheKey(item: IAudioLoadItem): string {
        return `${item.bundle}://${item.path}`;
    }

    private _clipThrottleKey(clip: AudioClip): string {
        return `clip://${clip.uuid || clip.nativeUrl || clip.name}`;
    }

    private _normalizeLoadItem(item: IAudioLoadItem): IAudioLoadItem | null {
        const path = item?.path?.trim();
        if (!path) {
            console.warn("[AudioMgr] path 不能为空");
            return null;
        }
        const bundle = item.bundle?.trim();
        if (!bundle) {
            console.warn(`[AudioMgr] bundle 不能为空: ${path}`);
            return null;
        }
        return { path, bundle };
    }

    private _pruneSfxThrottleMap(): void {
        if (this._sfxLastPlayTime.size <= SFX_THROTTLE_MAP_MAX) {
            return;
        }
        const now = Date.now();
        for (const [key, time] of this._sfxLastPlayTime) {
            if (now - time > SFX_THROTTLE_MAX_AGE_MS) {
                this._sfxLastPlayTime.delete(key);
            }
        }
        if (this._sfxLastPlayTime.size > SFX_THROTTLE_MAP_MAX) {
            this._sfxLastPlayTime.clear();
        }
    }

    private _isClipInUse(key: string, clip?: AudioClip | null): boolean {
        const targetClip = clip ?? this._clipCache.get(key) ?? null;
        for (const task of this._tasks.values()) {
            if (task.path && this._cacheKey({ path: task.path, bundle: task.bundle }) === key) {
                return true;
            }
            if (targetClip && task.clip === targetClip) {
                return true;
            }
        }
        return false;
    }

    private _loadClip(item: IAudioLoadItem): Promise<AudioClip | null> {
        if (this._destroyed) {
            return Promise.resolve(null);
        }

        const key = this._cacheKey(item);
        const cached = this._clipCache.get(key);
        if (cached) {
            return Promise.resolve(cached);
        }

        const inflight = this._loadingPromises.get(key);
        if (inflight) {
            return inflight;
        }

        const promise = this._doLoadClip(item, key).finally(() => {
            this._loadingPromises.delete(key);
        });
        this._loadingPromises.set(key, promise);
        return promise;
    }

    private _doLoadClip(
        item: IAudioLoadItem,
        key: string,
    ): Promise<AudioClip | null> {
        return new Promise((resolve) => {
            const onLoaded = (err: Error | null, clip: AudioClip) => {
                if (this._destroyed) {
                    if (clip) {
                        assetManager.releaseAsset(clip);
                    }
                    resolve(null);
                    return;
                }
                if (err || !clip) {
                    console.warn(`[AudioMgr] 加载失败: ${key}`, err);
                    resolve(null);
                    return;
                }
                this._clipCache.set(key, clip);
                resolve(clip);
            };

            if (item.bundle === "resources") {
                resources.load(item.path, AudioClip, onLoaded);
                return;
            }

            const cachedBundle = this._bundleCache.get(item.bundle);
            if (cachedBundle) {
                cachedBundle.load(item.path, AudioClip, onLoaded);
                return;
            }

            assetManager.loadBundle(item.bundle, (err, b) => {
                if (this._destroyed) {
                    resolve(null);
                    return;
                }
                if (err || !b) {
                    console.warn(`[AudioMgr] Bundle 加载失败: ${item.bundle}`, err);
                    resolve(null);
                    return;
                }
                this._bundleCache.set(item.bundle, b);
                b.load(item.path, AudioClip, onLoaded);
            });
        });
    }
}
