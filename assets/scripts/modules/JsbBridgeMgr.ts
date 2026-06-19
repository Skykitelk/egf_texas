import { native, sys } from "cc";

/** 进行中的原生事件（listener + 超时 timer） */
interface INativeEventPending {
    eventName: string;
    timer: ReturnType<typeof setTimeout> | null;
    listener: native.OnNativeEventListener;
    reject: (reason?: unknown) => void;
};

/**
 * JSB 桥接管理器
 *
 * 仅依赖 Cocos `cc` API，不引用其他业务模块。
 * 各原生回调统一登记在 `_pendingEvents`，不支持同一事件的并发请求。
 */
export class JsbBridgeMgr implements egf.IModule {
    key = "jsbBridgeMgr";

    private _isNativePlatform = false;
    /** 进行中的原生事件，key 为 eventName */
    private _pendingEvents = new Map<string, INativeEventPending>();

    constructor() {
        this._isNativePlatform = sys.platform === sys.Platform.ANDROID
            || sys.platform === sys.Platform.IOS;
    };

    onInit(): void {
        console.log("JsbBridgeMgr onInit");
    };

    onStop(): void {
        this._clearAllNativeEvents();
        console.log("JsbBridgeMgr onStop");
    };

    private _clearNativeEvent(eventName: string, rejectReason?: Error): void {
        const pending = this._pendingEvents.get(eventName);
        if (!pending) {
            return;
        }
        native.jsbBridgeWrapper.removeNativeEventListener(
            eventName,
            pending.listener,
        );
        if (pending.timer !== null) {
            clearTimeout(pending.timer);
        }
        this._pendingEvents.delete(eventName);
        if (rejectReason) {
            pending.reject(rejectReason);
        }
    };

    private _clearAllNativeEvents(): void {
        const reason = new Error("JsbBridgeMgr stopped");
        for (const eventName of [...this._pendingEvents.keys()]) {
            this._clearNativeEvent(eventName, reason);
        }
    };

    /**
     * 注册原生事件监听，等待单次回调或超时
     * @param eventName 事件名（同时作为 Map key，同一事件勿并发调用）
     * @param payload 发送给原生的参数
     * @param timeout 超时时间（秒）
     * @param onResult 将原生回调参数转换为业务结果,参数为原生回调参数的 trim 结果
     */
    private _waitNativeEvent<T>(
        eventName: string,
        payload: string,
        timeout: number,
        onResult: (result: string) => T,
    ): Promise<T> {
        if (this._pendingEvents.has(eventName)) {
            return Promise.reject(new Error(`${eventName} already pending`));
        }
        return new Promise((resolve, reject) => {
            let settled = false;

            const listener: native.OnNativeEventListener = (arg: string) => {
                if (settled) {
                    return;
                }
                settled = true;
                const result = arg.trim();
                this._clearNativeEvent(eventName);
                resolve(onResult(result));
            };

            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                this._clearNativeEvent(eventName);
                reject(new Error(`${eventName} timeout`));
            }, timeout * 1000);

            this._pendingEvents.set(eventName, { eventName, timer, listener, reject });
            native.jsbBridgeWrapper.addNativeEventListener(eventName, listener);
            native.jsbBridgeWrapper.dispatchEventToNative(eventName, payload);
        });
    };

    /**
     * 是否是原生平台
     */
    public isNativePlatform(): boolean {
        return this._isNativePlatform;
    }

    /**
     * 分享文本（仅原生端生效）
     * @param text 分享文本
     */
    public shareText(text: string): void {
        if (!this._isNativePlatform) {
            return;
        }
        native.jsbBridgeWrapper.dispatchEventToNative("shareText", text);
    }

    /**
     * 获取 Adjust ID。非原生端直接返回成功但 id 为空。
     * @param adjustToken Adjust Token
     * @param timeout 超时时间（秒），默认 10
     */
    public getAdjustId(
        adjustToken: string,
        timeout = 10,
    ): Promise<{ success: boolean; id: string }> {
        if (!this._isNativePlatform) {
            return Promise.resolve({ success: true, id: "" });
        }
        if (!adjustToken?.trim()) {
            return Promise.reject(new Error("adjustToken is empty"));
        }

        return this._waitNativeEvent("getAdjustId", adjustToken, timeout, (id) => ({
            success: true, id: id,
        }));
    };

    /**
     * 获取设备 ID. 非原生端直接生成一个 uuid 作为 id。
     * @param timeout 超时时间（秒）
     */
    public getDeviceId(timeout = 5): Promise<string> {
        const localId = sys.localStorage.getItem("local_device_id");
        if (localId) {
            return Promise.resolve(localId);
        };
        if (!this._isNativePlatform) {
            const uuid = () => {
                return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
                    const r = Math.random() * 16 | 0;
                    const v = c === "x" ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            };
            const id = uuid();
            sys.localStorage.setItem("local_device_id", id);
            return Promise.resolve(id);
        };
        return this._waitNativeEvent("getDeviceId", "", timeout, (id) => {
            sys.localStorage.setItem("local_device_id", id);
            return id;
        });
    };
};
