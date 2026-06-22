import { LayerType } from "./LayerConfig";

type ViewCtrlConstructor = displayCtrl.CtrlClassMap[keyof displayCtrl.CtrlClassMap];

/** View 控制器静态元数据（由装饰器写入） */
export interface IViewCtrlMeta {
    typeKey: string;
    prefabUrl?: string;
    viewBundle?: string;
    viewLayer?: LayerType;
}

/** @registTypesToUiMgr 可选配置 */
export interface IRegistViewOptions {
    /** prefab 路径，不带扩展名 */
    prefabUrl?: string;
    /** prefab 所在 bundle，默认 `resources` */
    bundle?: string;
    /** 挂载层级，默认 `LayerType.UI` */
    layer?: LayerType;
}

/**
 * View 控制器注册表
 * 由 @registTypesToUiMgr 装饰器在类定义时写入，启动时交给 uiMgr.registTypes。
 */
class ViewCtrlRegistry {
    private static _map: Record<string, ViewCtrlConstructor> = {};

    static register(key: string, ctor: ViewCtrlConstructor): void {
        const trimmed = key?.trim();
        if (!trimmed) {
            console.warn("[ViewRegistry] viewName 不能为空");
            return;
        }
        if (this._map[trimmed] && this._map[trimmed] !== ctor) {
            console.warn(`[ViewRegistry] 重复注册 View: ${trimmed}`);
        }
        this._map[trimmed] = ctor;
    }

    static getClassMap(): displayCtrl.CtrlClassMap {
        return { ...this._map };
    }

    static getKeys(): string[] {
        return Object.keys(this._map);
    }

    static has(key: string): boolean {
        return !!this._map[key?.trim()];
    }
}

function defineStatic<T extends ViewCtrlConstructor, V>(
    target: T,
    key: string,
    value: V,
): void {
    Object.defineProperty(target, key, {
        value,
        writable: false,
        configurable: true,
    });
}

/**
 * 将 View 控制器注册到 uiMgr。
 * 需在 ModuleLoader 启动前 import 对应 View 文件（见 views/index.ts）。
 *
 * @param viewName View 类型 key，需与 IViewKeyMap 中的键一致
 * @param options 可选静态配置（prefab / bundle / layer）
 *
 * @example
 * @registTypesToUiMgr("LoginView", {
 *     prefabUrl: "login/LoginView",
 *     bundle: "resources",
 *     layer: LayerType.UI,
 * })
 * export class LoginView extends BaseView { ... }
 */
export function registTypesToUiMgr<K extends keyof IViewKeyMap>(
    viewName: K,
    options?: IRegistViewOptions,
) {
    return function <T extends ViewCtrlConstructor>(target: T): T {
        defineStatic(target, "typeKey", viewName);

        if (options?.prefabUrl?.trim()) {
            defineStatic(target, "prefabUrl", options.prefabUrl.trim());
        }
        if (options?.bundle?.trim()) {
            defineStatic(target, "viewBundle", options.bundle.trim());
        }
        if (options?.layer !== undefined) {
            defineStatic(target, "viewLayer", options.layer);
        }

        if (target.name && target.name !== viewName) {
            console.warn(
                `[ViewRegistry] 类名 "${target.name}" 与 viewName "${String(viewName)}" 不一致，建议保持相同`,
            );
        }

        ViewCtrlRegistry.register(viewName as string, target);
        return target;
    };
}

/** 获取已注册的 View 控制器映射，供 uiMgr.registTypes 使用 */
export function getViewCtrlClassMap(): displayCtrl.CtrlClassMap {
    return ViewCtrlRegistry.getClassMap();
}

/** 获取已注册的 View key 列表 */
export function getRegisteredViewKeys(): string[] {
    return ViewCtrlRegistry.getKeys();
}

/** 读取 View 控制器静态元数据 */
export function getViewCtrlMeta(ctor: ViewCtrlConstructor): IViewCtrlMeta | null {
    const typeKey = (ctor as IViewCtrlMeta).typeKey;
    if (!typeKey) {
        return null;
    }
    return {
        typeKey,
        prefabUrl: (ctor as IViewCtrlMeta).prefabUrl,
        viewBundle: (ctor as IViewCtrlMeta).viewBundle,
        viewLayer: (ctor as IViewCtrlMeta).viewLayer,
    };
}

/** 启动校验 / 同步注册用的日志接口，避免 ViewRegistry 依赖 LogMgr */
interface IViewRegistryLogger {
    warn: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
}

/** uiMgr 注册所需的最小接口 */
interface IUiMgrRegistrar {
    isRegisted(typeKey: string): boolean;
    regist(ctrlClass: ViewCtrlConstructor, typeKey?: string): void;
}

/**
 * 将 ViewCtrlRegistry 中尚未注册到 uiMgr 的控制器同步注册。
 * 启动时、热更后 dynamic import View 模块后均可调用。
 *
 * @param uiMgr 目标 uiMgr；不传则尝试读取全局 `m.uiMgr`（需已完成 bootstrap）
 * @param logger 可选日志器
 * @returns 本次新注册到 uiMgr 的 viewName 列表
 *
 * @example
 * // 启动时（ModuleLoader 内部）
 * syncViewRegistryToUiMgr(uiMgr, logMgr);
 *
 * @example
 * // 热更后延迟注册
 * await import("../views/ShopView");
 * syncViewRegistryToUiMgr();
 * m.uiMgr.showDpc("ShopView", { ... });
 */
export function syncViewRegistryToUiMgr(
    uiMgr?: IUiMgrRegistrar,
    logger?: IViewRegistryLogger,
): string[] {
    const mgr = uiMgr ?? _getGlobalUiMgr();
    const log = logger ?? console;

    if (!mgr) {
        log.warn?.("[ViewRegistry] uiMgr 不可用，同步注册已跳过");
        return [];
    }

    const registered: string[] = [];
    for (const [key, ctor] of Object.entries(ViewCtrlRegistry.getClassMap())) {
        if (mgr.isRegisted(key)) {
            continue;
        }
        mgr.regist(ctor, key);
        if (mgr.isRegisted(key)) {
            registered.push(key);
        } else {
            log.warn?.(`[ViewRegistry] 同步 uiMgr 失败: ${key}`);
        }
    }

    if (registered.length > 0) {
        log.info?.(`[ViewRegistry] 同步到 uiMgr (${registered.length}): ${registered.join(", ")}`);
    }
    return registered;
}

function _getGlobalUiMgr(): IUiMgrRegistrar | null {
    try {
        // 延迟加载，避免 ViewRegistry ↔ ModuleMgr 顶层循环依赖
        const mod = require("../modules/ModuleMgr") as typeof import("../modules/ModuleMgr");
        return mod.m?.uiMgr ?? null;
    } catch {
        return null;
    }
}

/**
 * 启动前校验 View 装饰器注册结果（ViewCtrlRegistry）
 * @returns 未通过时为 false
 */
export function validateViewRegistry(logger?: IViewRegistryLogger): boolean {
    const keys = ViewCtrlRegistry.getKeys();
    const log = logger ?? console;

    if (keys.length === 0) {
        log.warn?.("[ViewRegistry] 未注册任何 View，请检查 views/index.ts 是否 import 了 View 文件");
        return false;
    }

    log.info?.(`[ViewRegistry] 已注册 View (${keys.length}): ${keys.join(", ")}`);
    return true;
}
