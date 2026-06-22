import { DpcMgr, Layer, LayerMgr, NodeCtrl } from "@ailhc/dpctrl-c3d";
import { ObjPoolMgr } from "@ailhc/obj-pool";
import { Asset, Node } from "cc";
import { LayerClassMap, LayerType } from "../configs/LayerConfig";
import { LogMgr } from "./LogMgr";
import { HotUpdateMgr } from "./HotUpdateMgr";
import { AudioMgr } from "./AudioMgr";
import { StorageMgr } from "./StorageMgr";
import { CsvMgr } from "./CsvMgr";
import { JsbBridgeMgr } from "./JsbBridgeMgr";
import { AssetMgr } from "./AssetMgr";
import { syncViewRegistryToUiMgr, validateViewRegistry } from "../configs/ViewRegistry";
import "../configs/ViewConfig";
import { BroadCastMgr } from "./BroadCastMgr";
import { HttpMgr } from "./HttpMgr";

declare global {

    /**
     * 模块映射
     */
    interface IModuleMap {
        /**
         * UI管理器
         */
        uiMgr: DpcMgr<IViewKeyMap, IViewInitDataMap, IViewShowDataMap, IViewUpdateDataMap>;
        /**
         * 层级管理器
         */
        layerMgr: LayerMgr<Node>;
        /**
         * 对象池管理器
         */
        poolMgr: objPool.IPoolMgr;
        /**
         * 日志管理器
         */
        logMgr: LogMgr;
        /**
         * 热更新管理器
         */
        hotUpdateMgr: HotUpdateMgr;
        /**
         * 音频管理器
         */
        audioMgr: AudioMgr;
        /**
         * 存储管理器
         */
        storageMgr: StorageMgr;
        /**
         * CSV 管理器
         */
        csvMgr: CsvMgr;
        /**
         * JSB 桥接管理器
         */
        jsbBridgeMgr: JsbBridgeMgr;
        /**
         * 资源管理器
         */
        assetMgr: AssetMgr;
        /**
         * 广播管理器
         */
        broadCastMgr: BroadCastMgr;
        /**
         * HTTP 管理器
         */
        httpMgr: HttpMgr;
    }

    /**
     * 资源加载配置资源项
     */
    interface IViewRessItem {
        /**
         * bundle name
         */
        bundle: string;
        /**
         * 资源路径（相对于 bundle）
         */
        path: string;
        /**
         * 资源类型
         */
        type: typeof Asset;
    }

    /**
     * 加载数据映射
     */
    interface IOnLoadData {
        /**
         * 是否显示加载提示界面，默认 false
         */
        showLoading: boolean;
    }
};



/**
 * 全局模块访问器
 */
export let m: IModuleMap = null!;

/**
 * 应用实例
 */
export let app: egf.IApp<IModuleMap> = null!;

/**
 * 模块加载器
 */
export class ModuleLoader implements egf.IBootLoader {

    /**
     * 是否挂载到 window 对象
     */
    private isMountWindow: boolean = false;

    /**
     * 根节点
     */
    private root: Node;

    /**
     * 构造函数
     * @param root 根节点
     * @param isMountWindow 是否将app.moduleMap 挂载到 window 对象, 默认 false
     */
    constructor(root: Node, isMountWindow: boolean) {
        this.root = root;
        this.isMountWindow = isMountWindow;
    };

    /**
     * 启动加载器
     * @param app 应用实例
     * @param bootEnd 启动结束回调
     */
    onBoot(appInstance: egf.IApp<IModuleMap>, bootEnd: egf.BootEndCallback): void {
        app = appInstance;
        this.initModules(app);
        bootEnd(true);
    };

    private initModules(app: egf.IApp<IModuleMap>) {
        /**
         * UI 管理器
         */
        const uiMgr = new DpcMgr<IViewKeyMap, IViewInitDataMap, IViewShowDataMap, IViewUpdateDataMap>();
        uiMgr.init({
            loadRes: (config) => {
                this.loadResHandler(config);
            },
            releaseRes: (ctrlIns) => {
                this.releaseResHandler(ctrlIns);
            },
        });

        /**
         * 日志管理器（View 注册校验需要 logMgr，先创建实例）
         */
        const logMgr = new LogMgr();

        validateViewRegistry(logMgr);
        syncViewRegistryToUiMgr(uiMgr, logMgr);

        /**
         * 层级管理器
         */
        const layerMgr = new LayerMgr<Node>();
        layerMgr.init(LayerType, Layer, LayerClassMap, this.root);
        /**
         * 对象池管理器
         */
        const poolMgr = new ObjPoolMgr();
        /**
         * 热更新管理器
         */
        const hotUpdateMgr = new HotUpdateMgr();
        /**
         * 音频管理器
         */
        const audioMgr = new AudioMgr(this.root);
        /**
         * 存储管理器
         */
        const storageMgr = new StorageMgr();
        /**
         * CSV 管理器
         */
        const csvMgr = new CsvMgr();
        /**
         * JSB 桥接管理器
         */
        const jsbBridgeMgr = new JsbBridgeMgr();
        /**
         * 资源管理器
         */
        const assetMgr = new AssetMgr();
        /**
         * 广播管理器
         */
        const broadCastMgr = new BroadCastMgr();
        /**
         * HTTP 管理器
         */
        const httpMgr = new HttpMgr();

        app.loadModule(assetMgr, "assetMgr");
        app.loadModule(uiMgr, "uiMgr");
        app.loadModule(layerMgr, "layerMgr");
        app.loadModule(poolMgr, "poolMgr");
        app.loadModule(logMgr, "logMgr");
        app.loadModule(hotUpdateMgr, "hotUpdateMgr");
        app.loadModule(audioMgr, "audioMgr");
        app.loadModule(storageMgr, "storageMgr");
        app.loadModule(csvMgr, "csvMgr");
        app.loadModule(jsbBridgeMgr, "jsbBridgeMgr");
        app.loadModule(broadCastMgr, "broadCastMgr");
        app.loadModule(httpMgr, "httpMgr");

        m = app.moduleMap;
        if (this.isMountWindow) {
            (window as any).m = m;
        };
    };

    private async loadResHandler(config: displayCtrl.IResLoadConfig) {
        const ress = config.ress as Array<IViewRessItem>;
        if (!ress || ress.length === 0) {
            config.complete?.();
            return;
        }

        const loadItems = this._normalizeResItems(ress);
        if (loadItems.length === 0 || loadItems.length !== ress.length) {
            m.logMgr?.error("[module] loadRes 资源项必须全部有效，且必须包含 path / type / bundle");
            config.error?.();
            return;
        }

        const onLoadData = config.onLoadData as IOnLoadData;
        const isShowLoading = onLoadData?.showLoading === true;
        let assets: Array<Asset | null> | null = null;

        try {
            if (isShowLoading) {
                // m.uiMgr.showDpc('LoadingView');
            }

            assets = await m.assetMgr.loadBatch(loadItems.map((res) => ({
                path: res.path,
                type: res.type,
                bundle: res.bundle,
            })));

            if (assets.some((asset) => !asset)) {
                this._rollbackLoadedAssets(loadItems, assets);
                config.error?.();
                return;
            }

            if (config.onLoadData) {
                const usedFields = new Set<string>();
                for (let i = 0; i < loadItems.length; i++) {
                    const field = this._resFieldKey(loadItems[i].path, loadItems[i].bundle, usedFields);
                    config.onLoadData[field] = assets[i];
                }
            }

            config.complete?.();
        } catch (err) {
            m.logMgr?.error("[module] loadRes failed", err);
            if (assets) {
                this._rollbackLoadedAssets(loadItems, assets);
            }
            config.error?.();
        } finally {
            if (isShowLoading) {
                // m.uiMgr.hideDpc('LoadingView');
            }
        }
    }

    private _normalizeResItems(
        ress: Array<IViewRessItem>,
    ): IViewRessItem[] {
        const items: IViewRessItem[] = [];
        for (const item of ress) {
            if (!item?.path?.trim() || !item.type || !item.bundle?.trim()) {
                continue;
            }
            items.push({
                path: item.path.trim(),
                type: item.type,
                bundle: item.bundle.trim(),
            });
        }
        return items;
    }

    private _rollbackLoadedAssets(
        items: IViewRessItem[],
        assets: Array<Asset | null>,
    ): void {
        for (let i = 0; i < items.length; i++) {
            if (!assets[i]) {
                continue;
            }
            m.assetMgr.release(items[i]);
        }
    }

    /**
     * 获取资源字段 key
     * @param path 资源路径
     * @returns 
     */
    private _resFieldKey(path: string, bundle: string, usedFields: Set<string>): string {
        const trimmed = path.trim();
        const slash = trimmed.lastIndexOf("/");
        const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
        if (!usedFields.has(base)) {
            usedFields.add(base);
            return base;
        }
        const fallbackBase = `${bundle || "resources"}_${trimmed}`
            .replace(/[^\w$]+/g, "_")
            .replace(/^_+|_+$/g, "");
        const stableBase = fallbackBase || "res";
        let candidate = stableBase;
        let suffix = 1;
        while (usedFields.has(candidate)) {
            suffix++;
            candidate = `${stableBase}_${suffix}`;
        }
        usedFields.add(candidate);
        m.logMgr?.warn(`[module] loadRes 字段名冲突，已重命名: ${base} -> ${candidate}`);
        return candidate;
    }

    private releaseResHandler(ctrlIns: displayCtrl.ICtrl<any>) {
        const ress = ctrlIns.getRess?.() as Array<IViewRessItem>;
        if (!ress?.length) {
            return;
        }
        const releaseItems = this._normalizeResItems(ress);
        if (releaseItems.length !== ress.length) {
            m.logMgr?.warn("[module] releaseRes 存在无效资源项，已跳过无效项");
        }
        for (const item of releaseItems) {
            if (!m.assetMgr.release(item)) {
                m.logMgr?.warn(`[module] releaseRes 未命中资源: ${item.bundle}://${item.path}`);
            }
        }
    }
};

/**
 * 卸载模块
 * @param moduleName 模块名称
 * @returns 
 */
export function unloadModule(moduleName: keyof IModuleMap) {
    if (!app) {
        console.error("[module] unloadModule: app is not initialized");
        return;
    };
    if (app.hasModule(moduleName)) {
        const module = app.moduleMap[moduleName] as egf.IModule;
        module.onStop?.();
        m.logMgr?.info("[module] unload: " + moduleName);
    };
    delete app.moduleMap[moduleName];
};

/**
 * 加载模块
 * @param module 模块实例
 * @param moduleName 模块名称
 * @returns 
 */
export function loadModule(module: egf.IModule | any, moduleName?: keyof IModuleMap) {
    if (!app) {
        console.error("[module] loadModule: app is not initialized");
        return;
    };
    if (!moduleName) moduleName = module.key as keyof IModuleMap;
    if (!moduleName) {
        console.error("[module] loadModule: moduleName is required");
        return;
    };
    unloadModule(moduleName);
    app.loadModule(module, moduleName);
    m.logMgr?.info("[module] load : " + moduleName);
};


