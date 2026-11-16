import "@ailhc/egf-core";
import { sys } from "cc";
import { native } from "cc";
import { assetManager } from "cc";

/**
 * 热更新管理器
 * 负责管理热更新实例，包括创建、获取、销毁等生命周期管理。
 */
export class HotUpdateMgr implements egf.IModule {

    key = "hotUpdateMgr";

    private hotUpdaterRecord: Map<string, HotUpdater> = new Map();


    onInit(): void {
        console.log("[HotUpdateMgr] onInit");
    }

    onStop(): void {
        this.destroyAllHotUpdater();
        console.log("[HotUpdateMgr] onStop");
    }

    /**
     * 创建热更新实例
     * @param bundleName - Bundle的名称
     * @param updateUrl - 更新服务器的基础URL
     * @param version - 远程版本号
     * @returns 
     */
    createHotUpdater(bundleName: string, updateUrl: string, version: string) {
        const existing = this.hotUpdaterRecord.get(bundleName);
        if (existing) {
            this.destroyHotUpdater(bundleName);
        }
        const hotUpdateUtil = new HotUpdater(bundleName, updateUrl, version);
        this.hotUpdaterRecord.set(bundleName, hotUpdateUtil);
        return hotUpdateUtil;
    };

    /**
     * 获取热更新实例
     * @param bundleName - Bundle的名称
     * @returns 
     */
    getHotUpdater(bundleName: string) {
        const hotUpdateUtil = this.hotUpdaterRecord.get(bundleName);
        if (!hotUpdateUtil) {
            return null;
        };
        return hotUpdateUtil;
    };

    /**
     * 销毁热更新实例
     * @param bundleName - Bundle的名称
     */
    destroyHotUpdater(bundleName: string) {
        let hotUpdateUtil = this.getHotUpdater(bundleName);
        if (hotUpdateUtil) {
            this.hotUpdaterRecord.delete(bundleName);
            hotUpdateUtil.destroy();
        };
    };

    /**
     * 销毁所有热更新实例
     */
    destroyAllHotUpdater() {
        const bundleNames = [...this.hotUpdaterRecord.keys()];
        for (const bundleName of bundleNames) {
            this.destroyHotUpdater(bundleName);
        }
    }
};




/**
 * 最大并发下载任务数
 */
const MaxProcessingTasks = 5;

/** manifest / 网络请求最大重试次数 */
const MaxManifestRetryCount = 3;

/** 单文件下载最大重试次数（含 MD5 校验失败） */
const MaxDownloadRetryPerFile = 3;

/** 解压超时（毫秒） */
const UnzipTimeoutMs = 5 * 60 * 1000;

/** 正式热更新目录 */
const HOT_UPDATE_ROOT = "hotUpdateAssets/";

/** 暂存热更新目录 */
const HOT_UPDATE_STAGING_ROOT = "hotUpdateStaging/";

/** CDN：各 Bundle manifest 目录（manifest/{bundleName}_version.json） */
const HOT_UPDATE_MANIFEST_DIR = "manifest/";

/** CDN：Zip 全量包目录 */
const HOT_UPDATE_ZIPS_DIR = "zips/";

/**
 * 始终走增量下载的 Bundle（不走 Zip 全量）。
 * - engine：application.js、jsb-adapter/、main.js、src/ 等引擎资源
 * - main：assets/main/
 * - internal：assets/internal/
 */
const INCREMENTAL_ONLY_BUNDLES = new Set(['engine', 'main', 'internal']);

/**
 * 热更新工具类。
 * engine / main / internal：内置资源，仅增量更新；
 * 其他：普通 Asset Bundle，首次无 res_version 时走 Zip 全量。
 */
class HotUpdater {

    private _bundleName = '';
    private _updateUrl = '';
    private _version = '';
    private _remoteProjectManifest: IProjectManifest = null;

    private _downloader: native.Downloader = null;
    private _taskMap: Map<string, native.DownloadTask> = new Map();
    private _taskRetryMap: Map<string, number> = new Map();
    private _onProgress: IOnProgress = null;
    private _isUpdating = false;
    private _stopped = false;
    private _updateSettled = false;
    private _activeResolve: ((v: boolean) => void) | null = null;


    constructor(bundleName: string, updateUrl: string, version: string) {
        this._bundleName = bundleName;
        this._updateUrl = this._removeTrailingSlash(updateUrl);
        this._version = version;
    };

    /**
     * 监听更新进度回调
     * @param onProgress - 进度回调函数, 参数为当前进度, 范围为 0 ~ 1.
     */
    onUpdateProgress(onProgress: IOnProgress) {
        this._onProgress = onProgress;
    };

    /**
     * 销毁热更新实例
     */
    destroy() {
        this.stopUpdate();
        this._downloader = null;
        this._taskMap.clear();
        this._taskRetryMap.clear();
        this._onProgress = null;
        this._isUpdating = false;
        this._stopped = false;
        this._updateSettled = false;
        this._activeResolve = null;
        this._remoteProjectManifest = null;
        this._bundleName = '';
        this._updateUrl = '';
        this._version = '';
    };

    /**
     * 移除路径末尾的斜杠
     * @param url - 移除路径末尾的斜杠
     * @returns string - 移除末尾斜杠后的路径
     */
    private _removeTrailingSlash(url: string) {
        return url.endsWith('/') ? url.slice(0, -1) : url;
    };

    /**
     * 检查更新
     * @returns boolean - 是否需要更新
     */
    public checkUpdate() {
        const storageVersion = sys.localStorage.getItem(`${this._bundleName}_res_version`);
        if (storageVersion !== this._version) {
            return true;
        }
        return false;
    };

    /**
     * 开始更新
     * @returns Promise<boolean> - 是否成功
     */
    public async startUpdate(): Promise<boolean> {
        if (this._isUpdating) {
            console.warn(`${this._bundleName} update already in progress`);
            return false;
        }
        this._isUpdating = true;
        this._stopped = false;
        this._updateSettled = false;
        this._taskRetryMap.clear();

        try {
            this._remoteProjectManifest = await this._getProjectManifest();
            if (!this._remoteProjectManifest) {
                console.error(`${this._bundleName} project manifest is null`);
                return false;
            }
            this._prepareStaging();

            const storageVersion = sys.localStorage.getItem(`${this._bundleName}_res_version`);
            if (!storageVersion && !INCREMENTAL_ONLY_BUNDLES.has(this._bundleName)) {
                return await this._downLoadZipFile();
            }
            return await this._downLoadFiles();
        } finally {
            this._isUpdating = false;
        }
    };

    /**
     * 停止更新（进行中的任务会 abort，Staging 保留供下次续传）
     */
    public stopUpdate() {
        this._stopped = true;
        if (this._activeResolve) {
            this._finishUpdate(this._activeResolve, false);
        } else {
            this._abortAllTasks();
        }
    };

    /**
     * 中止所有进行中的下载任务
     */
    private _abortAllTasks() {
        this._taskMap.forEach((task) => {
            if (this._downloader && task) {
                this._downloader.abort(task);
            }
        });
        this._taskMap.clear();
    }

    /**
     * 结束更新 Promise（防重复 resolve / 防重复提交）
     */
    private _finishUpdate(resolve: (v: boolean) => void, ok: boolean): void {
        if (this._updateSettled) {
            return;
        }
        this._updateSettled = true;
        this._activeResolve = null;
        this._abortAllTasks();
        resolve(ok);
    }

    /**
     * 尝试提交 Staging 并结束更新
     */
    private _tryCommitUpdate(resolve: (v: boolean) => void): void {
        if (this._updateSettled || this._stopped) {
            return;
        }
        const ok = this._dealUpdateEnd();
        this._finishUpdate(resolve, ok);
    }

    /**
     * 获取远程 manifest URL：{updateUrl}/{version}/manifest/{bundleName}_version.json
     */
    private _getManifestUrl(): string {
        return `${this._updateUrl}/${this._version}/${HOT_UPDATE_MANIFEST_DIR}${this._bundleName}_version.json`;
    }

    /**
     * 获取项目 manifest
     * @returns Promise<IProjectManifest>
     */
    private _getProjectManifest(): Promise<IProjectManifest> {
        return this._getProjectJson(this._getManifestUrl());
    };

    /**
     * 获取项目 manifest
     * @param url - 项目 manifest 的 URL
     * @param retryCount - 重试次数
     * @returns Promise<IProjectManifest>
     */
    private async _getProjectJson(url: string, retryCount: number = 0): Promise<IProjectManifest> {
        if (retryCount > MaxManifestRetryCount) {
            console.error(`${this._bundleName} Get manifest failed, exceeded max retry: ${url}`);
            return null;
        }
        try {
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`${this._bundleName} Get manifest http error: ${res.status}, retry: ${retryCount}`);
                return await this._getProjectJson(url, retryCount + 1);
            }
            const manifest = await res.json() as IProjectManifest;
            if (!manifest?.assets || typeof manifest.assets !== 'object') {
                console.error(`${this._bundleName} Invalid manifest: missing assets, retry: ${retryCount}`);
                return await this._getProjectJson(url, retryCount + 1);
            }
            return manifest;
        }
        catch (error) {
            console.error(`${this._bundleName} Get manifest failed, retry: ${retryCount}, error: ${JSON.stringify(error)}`);
            return await this._getProjectJson(url, retryCount + 1);
        }
    };

    /**
     * 下载 zip 文件
     * @returns Promise<boolean>
     */
    private _downLoadZipFile(): Promise<boolean> {
        return new Promise((resolve) => {
            this._activeResolve = resolve;
            const stagingRoot = this._getStagingRoot();
            const zipFileUrl = `${this._updateUrl}/${this._version}/${HOT_UPDATE_ZIPS_DIR}${this._bundleName}.zip`;
            const stagingBundleDir = `${stagingRoot}assets/${this._bundleName}`;
            const zipStoragePath = `${stagingRoot}${this._bundleName}.zip`;
            const zipTaskKey = `zip:${this._bundleName}`;

            // Staging 已完整（如：解压完成但未提交时进程被杀），跳过 zip 直接提交
            if (this._isStagingComplete(stagingRoot)) {
                this._tryCommitUpdate(resolve);
                return;
            }

            this._downloader = new native.Downloader();
            this._downloader.onSuccess = (task: native.DownloadTask) => {
                if (this._updateSettled || this._stopped) {
                    return;
                }
                this._taskMap.delete(task.identifier);
                this._taskRetryMap.delete(zipTaskKey);

                this._clearDirectory(stagingBundleDir);
                this._unzipFile(zipStoragePath, stagingBundleDir)
                    .then(() => {
                        if (this._updateSettled || this._stopped) {
                            return;
                        }
                        native.fileUtils.removeFile(zipStoragePath);
                        if (!this._isStagingComplete(stagingRoot)) {
                            console.error(`${this._bundleName} staging incomplete after unzip`);
                            this._finishUpdate(resolve, false);
                            return;
                        }
                        this._tryCommitUpdate(resolve);
                    })
                    .catch((err) => {
                        console.error(`${this._bundleName} unzip failed:`, err);
                        this._finishUpdate(resolve, false);
                    });
            };
            this._downloader.onError = (task: native.DownloadTask, errorCode: number, errorCodeInternal: number, errorStr: string) => {
                if (this._updateSettled || this._stopped) {
                    return;
                }
                this._taskMap.delete(task.identifier);
                if (!this._shouldRetryDownload(zipTaskKey, resolve)) {
                    return;
                }
                const newTask = this._downloader.createDownloadTask(task.requestURL, task.storagePath, task.identifier);
                this._taskMap.set(newTask.identifier, newTask);
            };
            this._downloader.onProgress = (task: native.DownloadTask, bytesReceived: number, totalBytesReceived: number, totalBytesExpected: number) => {
                if (this._onProgress && totalBytesExpected > 0) {
                    this._onProgress(totalBytesReceived / totalBytesExpected);
                }
            };
            const task = this._downloader.createDownloadTask(zipFileUrl, zipStoragePath, zipFileUrl);
            this._taskMap.set(task.identifier, task);
        });
    };

    /**
     * 下载文件
     * @returns Promise<boolean>
     */
    private _downLoadFiles(): Promise<boolean> {
        return new Promise((resolve) => {
            this._activeResolve = resolve;
            let loadedCount = 0;
            const finalRoot = this._getFinalStoragePath();
            const stagingRoot = this._getStagingRoot();
            const needDownloadAssets = this._collectNeedDownloadAssets(finalRoot, stagingRoot);
            const needDownloadAssetsLen = needDownloadAssets.length;

            if (needDownloadAssetsLen === 0) {
                this._tryCommitUpdate(resolve);
                return;
            }

            const hints: native.DownloaderHints = {
                countOfMaxProcessingTasks: MaxProcessingTasks,
                timeoutInSeconds: 100,
                tempFileNameSuffix: ".tmp"
            };
            this._downloader = new native.Downloader(hints);

            const onFileDone = () => {
                if (this._updateSettled || this._stopped) {
                    return;
                }
                loadNeedUpdateFiles();
            };

            const failUpdate = () => {
                this._finishUpdate(resolve, false);
            };

            const retryDownload = (task: native.DownloadTask, taskKey: string) => {
                if (this._updateSettled || this._stopped) {
                    return;
                }
                if (!this._shouldRetryDownload(taskKey, resolve)) {
                    return;
                }
                const newTask = this._downloader.createDownloadTask(task.requestURL, task.storagePath, task.identifier);
                this._taskMap.set(newTask.identifier, newTask);
            };

            this._downloader.onSuccess = (task: native.DownloadTask) => {
                if (this._updateSettled || this._stopped) {
                    return;
                }
                this._taskMap.delete(task.identifier);
                const path = task.identifier;
                const remoteMd5 = this._remoteProjectManifest.assets[path]?.md5;
                if (!remoteMd5) {
                    console.error(`${this._bundleName} asset md5 not found in manifest: ${path}`);
                    failUpdate();
                    return;
                }

                const isMd5Match = this._checkFileMd5InBase(stagingRoot, path, remoteMd5);
                if (!isMd5Match) {
                    retryDownload(task, path);
                    return;
                }

                this._taskRetryMap.delete(path);
                loadedCount += 1;
                if (this._onProgress) {
                    this._onProgress(loadedCount / needDownloadAssetsLen);
                }
                onFileDone();
            };

            this._downloader.onError = (task: native.DownloadTask, errorCode: number, errorCodeInternal: number, errorStr: string) => {
                if (this._updateSettled || this._stopped) {
                    return;
                }
                this._taskMap.delete(task.identifier);
                retryDownload(task, task.identifier);
            };

            const loadNeedUpdateFiles = () => {
                if (this._updateSettled || this._stopped) {
                    return;
                }
                const fileInfo = needDownloadAssets.shift();
                if (fileInfo) {
                    const path = fileInfo.path;
                    const md5 = fileInfo.md5;
                    const url = `${this._updateUrl}/${this._version}/${path}?md5=${md5}`;
                    const task = this._downloader.createDownloadTask(url, `${stagingRoot}${path}`, path);
                    this._taskMap.set(task.identifier, task);
                }
                else if (loadedCount >= needDownloadAssetsLen) {
                    this._tryCommitUpdate(resolve);
                }
            };

            for (let i = 0; i < MaxProcessingTasks; i++) {
                loadNeedUpdateFiles();
            }
        });
    };

    /**
     * 收集仍需下载的资源（正式目录或 Staging 中 MD5 已正确则跳过）
     */
    private _collectNeedDownloadAssets(finalRoot: string, stagingRoot: string) {
        const needDownloadAssets: { path: string; size: number; md5: string; compressed: boolean }[] = [];
        const assets = this._remoteProjectManifest.assets;
        for (const key in assets) {
            const asset = assets[key];
            const path = key;
            const md5 = asset.md5;
            const dir = path.split('/').slice(0, -1).join('/');

            if (this._checkFileMd5InBase(finalRoot, path, md5)) {
                continue;
            }
            if (this._checkFileMd5InBase(stagingRoot, path, md5)) {
                continue;
            }

            this._ensureDirectory(stagingRoot + dir);
            needDownloadAssets.push({
                path: path,
                size: asset.size,
                md5: md5,
                compressed: asset.compressed
            });
        }
        return needDownloadAssets;
    }

    /**
     * Staging 中是否已包含 manifest 所需的全部文件
     */
    private _isStagingComplete(stagingRoot: string): boolean {
        const assets = this._remoteProjectManifest?.assets;
        if (!assets) {
            return false;
        }
        for (const path in assets) {
            if (!this._checkFileMd5InBase(stagingRoot, path, assets[path].md5)) {
                return false;
            }
        }
        return true;
    }

    /**
     * 提交前校验：每个 manifest 资源在正式目录或 Staging 中至少有一处 MD5 正确
     */
    private _canCommitUpdate(): boolean {
        const finalRoot = this._getFinalStoragePath();
        const stagingRoot = this._getStagingRoot();
        return this._isVersionAssetsComplete(finalRoot, stagingRoot);
    }

    /**
     * 指定版本资源是否完整（正式目录或 staging 至少一处存在且 md5 正确）
     */
    private _isVersionAssetsComplete(finalRoot: string, stagingRoot: string): boolean {
        const assets = this._remoteProjectManifest?.assets;
        if (!assets) {
            return false;
        }
        for (const path in assets) {
            const md5 = assets[path].md5;
            if (
                !this._checkFileMd5InBase(finalRoot, path, md5)
                && !this._checkFileMd5InBase(stagingRoot, path, md5)
            ) {
                console.error(`${this._bundleName} asset not ready before commit: ${path}`);
                return false;
            }
        }
        return true;
    }

    /**
     * 是否需要重试下载
     * @param taskKey - 任务键
     * @param resolve - 回调函数
     * @returns boolean
     */
    private _shouldRetryDownload(taskKey: string, resolve: (v: boolean) => void): boolean {
        const retries = (this._taskRetryMap.get(taskKey) || 0) + 1;
        this._taskRetryMap.set(taskKey, retries);
        if (retries > MaxDownloadRetryPerFile) {
            console.error(`${this._bundleName} download exceeded max retry: ${taskKey}`);
            this._finishUpdate(resolve, false);
            return false;
        }
        return true;
    }

    /**
     * 更新版本号存储
     */
    private _updateVersionStorage() {
        sys.localStorage.setItem(`${this._bundleName}_res_version`, this._version);
    };

    /**
     * 更新搜索路径
     */
    private _updateSearchPath() {
        const searchPaths = native.fileUtils.getSearchPaths();
        const hotUpdatePath = this._getFinalStoragePath();
        Array.prototype.unshift.apply(searchPaths, [hotUpdatePath]);
        const deduped = this._arrayDeduplication(searchPaths);
        sys.localStorage.setItem('HotUpdateSearchPaths', JSON.stringify(deduped));
        native.fileUtils.setSearchPaths(deduped);
    };

    /**
     * 移除 bundle
     */
    private _removeBundle() {
        if (this._bundleName === 'engine') {
            return;
        }
        const bundle = assetManager.getBundle(this._bundleName);
        if (bundle) {
            bundle.releaseAll();
            assetManager.removeBundle(bundle);
        }
    };

    /**
     * 更新完成：校验 → 提交 Staging → 写版本号
     * @returns 是否成功
     */
    private _dealUpdateEnd(): boolean {
        if (!this._canCommitUpdate()) {
            return false;
        }
        if (!this._promoteStagingToFinal()) {
            console.error(`${this._bundleName} promote staging to final failed`);
            return false;
        }
        if (this._onProgress) {
            this._onProgress(1);
        }
        this._updateVersionStorage();
        this._clearPendingVersion();
        this._updateSearchPath();
        this._removeBundle();
        this._clearStaging();
        return true;
    };

    /**
     * 数组去重
     * @param arr - 数组
     * @returns string[]
     */
    private _arrayDeduplication(arr: string[]) {
        const map = new Map<string, boolean>();
        const newArr: string[] = [];
        arr.forEach(item => {
            if (!map.has(item)) {
                map.set(item, true);
                newArr.push(item);
            }
        });
        return newArr;
    };

    /**
     * 获取可写根路径
     * @returns string
     */
    private _getWritableRoot(): string {
        const root = native.fileUtils.getWritablePath();
        return root.endsWith('/') ? root : `${root}/`;
    }

    /**
     * 获取正式存储路径
     * @returns string
     */
    private _getFinalStoragePath(): string {
        return `${this._getWritableRoot()}${HOT_UPDATE_ROOT}`;
    }

    /**
     * 获取暂存存储路径
     * @returns string
     */
    private _getStagingRoot(): string {
        return `${this._getWritableRoot()}${HOT_UPDATE_STAGING_ROOT}${this._bundleName}/${this._version}/`;
    }

    /**
     * 获取 pending 版本号键
     * @returns string
     */
    private _getPendingVersionKey(): string {
        return `${this._bundleName}_pending_version`;
    }

    /**
     * 准备暂存目录
     */
    private _prepareStaging(): void {
        const pendingKey = this._getPendingVersionKey();
        const pendingVersion = sys.localStorage.getItem(pendingKey);

        if (pendingVersion && pendingVersion !== this._version) {
            this._clearStagingForBundle(pendingVersion);
            sys.localStorage.removeItem(pendingKey);
        }

        sys.localStorage.setItem(pendingKey, this._version);
        this._ensureDirectory(this._getStagingRoot());
    }

    /**
     * 清除 pending 版本号
     */
    private _clearPendingVersion(): void {
        sys.localStorage.removeItem(this._getPendingVersionKey());
    }

    /**
     * 确保目录存在
     * @param dirPath - 目录路径
     * @returns void
     */
    private _ensureDirectory(dirPath: string): void {
        if (dirPath && !native.fileUtils.isDirectoryExist(dirPath)) {
            native.fileUtils.createDirectory(dirPath);
        }
    }

    /**
     * 检查文件的md5是否匹配（通过搜索路径）
     * @param basePath - 基础路径
     * @param relativePath - 相对路径
     * @param remoteMd5 - 远程md5
     * @returns boolean
     */
    private _checkFileMd5InBase(basePath: string, relativePath: string, remoteMd5: string): boolean {
        const fullPath = `${basePath}${relativePath}`;
        if (!native.fileUtils.isFileExist(fullPath)) {
            return false;
        }
        //@ts-ignore
        const localMd5 = jsb.getFileMd5(fullPath);
        return localMd5 === remoteMd5;
    }

    /**
     * 将暂存目录提升为正式目录（先 copy 后删 staging，失败时回滚）
     * @returns boolean
     */
    private _promoteStagingToFinal(): boolean {
        const stagingRoot = this._getStagingRoot();
        const finalRoot = this._getFinalStoragePath();
        if (!native.fileUtils.isDirectoryExist(stagingRoot)) {
            return true;
        }

        const stagedFiles: string[] = [];
        this._collectFiles(stagingRoot, stagedFiles);
        const promoteRecords: IPromoteRecord[] = [];

        for (let i = 0; i < stagedFiles.length; i++) {
            const src = stagedFiles[i];
            const relativePath = src.substring(stagingRoot.length);
            const dest = `${finalRoot}${relativePath}`;
            let backupPath: string | null = null;

            if (native.fileUtils.isFileExist(dest)) {
                backupPath = `${dest}.hotupdate_bak`;
                if (!this._backupFile(dest, backupPath)) {
                    console.error(`${this._bundleName} backup failed before promote: ${dest}`);
                    this._rollbackPromote(promoteRecords);
                    return false;
                }
            }

            if (!this._copyFile(src, dest)) {
                console.error(`${this._bundleName} copy failed during promote: ${src} -> ${dest}`);
                if (backupPath) {
                    this._restoreBackup(backupPath, dest);
                }
                this._rollbackPromote(promoteRecords);
                return false;
            }

            promoteRecords.push({ dest, backupPath });
        }

        for (let i = 0; i < stagedFiles.length; i++) {
            native.fileUtils.removeFile(stagedFiles[i]);
        }
        for (let i = 0; i < promoteRecords.length; i++) {
            const backupPath = promoteRecords[i].backupPath;
            if (backupPath && native.fileUtils.isFileExist(backupPath)) {
                native.fileUtils.removeFile(backupPath);
            }
        }
        return true;
    }

    private _rollbackPromote(records: IPromoteRecord[]): void {
        for (let i = records.length - 1; i >= 0; i--) {
            const item = records[i];
            if (item.backupPath) {
                if (native.fileUtils.isFileExist(item.dest)) {
                    native.fileUtils.removeFile(item.dest);
                }
                if (native.fileUtils.isFileExist(item.backupPath)) {
                    this._restoreBackup(item.backupPath, item.dest);
                }
            } else if (native.fileUtils.isFileExist(item.dest)) {
                native.fileUtils.removeFile(item.dest);
            }
        }
    }

    private _backupFile(src: string, backupPath: string): boolean {
        if (native.fileUtils.isFileExist(backupPath)) {
            native.fileUtils.removeFile(backupPath);
        }
        if (native.fileUtils.renameFile(src, backupPath)) {
            return true;
        }
        const data = native.fileUtils.getDataFromFile(src);
        if (!data) {
            return false;
        }
        if (!native.fileUtils.writeDataToFile(data, backupPath)) {
            return false;
        }
        native.fileUtils.removeFile(src);
        return true;
    }

    private _restoreBackup(backupPath: string, dest: string): void {
        if (native.fileUtils.isFileExist(dest)) {
            native.fileUtils.removeFile(dest);
        }
        if (!native.fileUtils.renameFile(backupPath, dest)) {
            const data = native.fileUtils.getDataFromFile(backupPath);
            if (data) {
                native.fileUtils.writeDataToFile(data, dest);
                native.fileUtils.removeFile(backupPath);
            }
        }
    }

    private _copyFile(src: string, dest: string): boolean {
        this._ensureParentDir(dest);
        const data = native.fileUtils.getDataFromFile(src);
        if (!data) {
            return false;
        }
        return native.fileUtils.writeDataToFile(data, dest);
    }

    /**
     * 收集目录下的所有文件
     * @param dirPath - 目录路径
     * @param out - 输出文件列表
     * @returns void
     */
    private _collectFiles(dirPath: string, out: string[]): void {
        const files = native.fileUtils.listFiles(dirPath);
        if (!files || files.length === 0) {
            return;
        }
        for (let i = 0, len = files.length; i < len; i++) {
            const name = files[i];
            if (name === '.' || name === '..') {
                continue;
            }
            const fullPath = dirPath.endsWith('/') ? `${dirPath}${name}` : `${dirPath}/${name}`;
            if (native.fileUtils.isDirectoryExist(fullPath)) {
                this._collectFiles(fullPath, out);
            }
            else {
                out.push(fullPath);
            }
        }
    }

    /**
     * 确保父目录存在
     * @param filePath - 文件路径
     * @returns void
     */
    private _ensureParentDir(filePath: string): void {
        const idx = filePath.lastIndexOf('/');
        if (idx <= 0) {
            return;
        }
        this._ensureDirectory(filePath.substring(0, idx));
    }

    private _clearDirectory(dirPath: string): void {
        if (native.fileUtils.isDirectoryExist(dirPath)) {
            native.fileUtils.removeDirectory(dirPath);
        }
    }

    private _clearStaging(): void {
        this._clearStagingForBundle(this._version);
    }

    private _clearStagingForBundle(version: string): void {
        const stagingRoot = `${this._getWritableRoot()}${HOT_UPDATE_STAGING_ROOT}${this._bundleName}/${version}/`;
        if (native.fileUtils.isDirectoryExist(stagingRoot)) {
            native.fileUtils.removeDirectory(stagingRoot);
        }
    }

    private _unzipFile(zipFilePath: string, destDirectory: string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            let settled = false;

            const cleanup = (callback: (result: string) => void) => {
                native.jsbBridgeWrapper.removeNativeEventListener("unzipFile", callback);
            };

            const callback = (result: string) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                cleanup(callback);

                if (this._isUnzipSuccess(result)) {
                    resolve(true);
                } else {
                    reject(new Error(`${this._bundleName} unzip failed: ${result}`));
                }
            };

            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup(callback);
                reject(new Error(`${this._bundleName} unzip timeout`));
            }, UnzipTimeoutMs);

            native.jsbBridgeWrapper.addNativeEventListener("unzipFile", callback);
            native.jsbBridgeWrapper.dispatchEventToNative("unzipFile", JSON.stringify({ zipFilePath, destDirectory }));
        });
    }

    /**
     * 解析 Native 解压回调结果（兼容 JSON 与纯字符串）
     */
    private _isUnzipSuccess(result: string): boolean {
        if (!result) {
            return false;
        }
        try {
            const data = JSON.parse(result);
            if (data && typeof data === 'object') {
                if (data.success === true || data.code === 0) {
                    return true;
                }
                if (data.success === false || (typeof data.code === 'number' && data.code !== 0)) {
                    return false;
                }
            }
        } catch (_e) {
            // 非 JSON，按字符串判断
        }
        const lower = result.trim().toLowerCase();
        if (lower === 'ok' || lower === 'true' || lower === '1' || lower === 'success') {
            return true;
        }
        if (lower === 'fail' || lower === 'false' || lower === '0' || lower === 'error') {
            return false;
        }
        // 未知返回统一按失败处理，避免把异常结果误判成成功。
        return false;
    }
};

interface IProjectManifest {
    /** manifest 文件内记录的版本号（元数据；运行时以 createHotUpdater 传入的 version 为准） */
    version: string;
    /** 资源清单，key 为相对版本根目录的路径 */
    assets: {
        [key: string]: IAssetItem;
    };
    /** 预留字段，当前运行时未读取 manifest 内的 searchPaths */
    searchPaths: string[];
};

interface IAssetItem {
    size: number;
    md5: string;
    compressed: boolean;
};

interface IOnProgress {
    /**
     * 更新进度
     * @param percent 当前进度 0 ~ 1
     */
    (percent: number): void;
};

interface IPromoteRecord {
    dest: string;
    backupPath: string | null;
}
