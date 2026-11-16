import { instantiate, Node, Prefab, tween, Tween, UIOpacity, Vec3 } from "cc";
import { NodeCtrl } from "@ailhc/dpctrl-c3d";
import { LayerType } from "../configs/LayerConfig";
import { getViewConfig, IViewConfig, ViewConfigMap } from "../configs/ViewConfig";
import { m } from "../modules/ModuleMgr";

const SHOW_DURATION = 0.25;
const HIDE_DURATION = 0.2;

type ViewCtrlWithTypeKey = { typeKey?: string };

/**
 * 基础视图类。所有视图都应该继承自此基类。
 * 该类继承NodeCtrl-(Node), 不是Component。
 */
export abstract class BaseView extends NodeCtrl {
    /**
     * 面板节点
     */
    protected panel: Node;
    /**
     * 遮罩透明度
     */
    protected maskOpacity: UIOpacity;
    /**
     * 视图配置（首次解析后缓存）
     */
    protected viewConfig: IViewConfig | null = null;
    /**
     * 显示界面前需要加载的资源列表（子类可 override 追加其他资源）
     */
    protected ressItems: IViewRessItem[] = [];
    /**
     * 是否正在播放显示动画
     */
    isShowing = false;

    /**
     * 获取显示界面前需要加载的资源列表
     * @returns 资源列表
     */
    getRess(): IViewRessItem[] {
        super.getRess();
        const config = this._getViewConfig();
        if (!config?.path) {
            return [];
        }
        this.ressItems = [{
            path: config.path,
            type: Prefab,
            bundle: config.bundle
        }];
        return this.ressItems;
    }

    onInit(config?: displayCtrl.IInitConfig) {
        super.onInit(config);
        this._mountPrefabView();
    }

    onShow(config?: displayCtrl.IShowConfig) {
        super.onShow(config);
        this.isShowing = true;
        this._playShowAnim(() => {
            this.isShowing = false;
            config?.showEndCb?.();
        });
    }

    onHide() {
        if (!this.node || !this.node.active) {
            super.onHide();
            return;
        }
        Tween.stopAllByTarget(this.panel);
        this.maskOpacity && Tween.stopAllByTarget(this.maskOpacity);

        this._playHideAnim(() => {
            super.onHide();
        });
    }

    /**
     * 从 AssetMgr 缓存实例化 prefab 并挂载到层级
     * @returns 是否挂载成功
     */
    private _mountPrefabView(): boolean {
        const config = this._getViewConfig();
        if (!config?.path) {
            m.logMgr?.error(`[${config?.name ?? this.constructor.name}] 未配置 prefab path`);
            return false;
        }

        const bundle = config.bundle;
        if (!bundle) {
            m.logMgr?.error(`[${config?.name ?? this.constructor.name}] 未配置 prefab bundle`);
            return false;
        }

        const layer = config.layer ?? LayerType.UI;
        const prefab = m.assetMgr.get({
            path: config.path,
            type: Prefab,
            bundle,
        });

        if (!prefab) {
            m.logMgr?.error(
                `[${config.name}] prefab 未加载: ${bundle}://${config.path}`,
            );
            return false;
        }

        this.node = instantiate(prefab);
        m.layerMgr.addNodeToLayer(this.node, layer);
        this._bindAnimNodes();
        return true;
    }

    private _bindAnimNodes(panelName = "panel", maskName = "mask") {
        this.panel = this.node.getChildByName(panelName);
        const mask = this.node.getChildByName(maskName);
        this.maskOpacity = mask?.getComponent(UIOpacity) ?? mask?.addComponent(UIOpacity);
    }

    private _getTypeKey(): keyof IViewKeyMap | null {
        const insKey = this.key;
        console.log("insKey ============================>", insKey);
        if (insKey && insKey in ViewConfigMap) {
            return insKey as keyof IViewKeyMap;
        }
        const ctorKey = (this.constructor as ViewCtrlWithTypeKey).typeKey;
        console.log("ctorKey ============================>", ctorKey);
        if (ctorKey && ctorKey in ViewConfigMap) {
            return ctorKey as keyof IViewKeyMap;
        }
        return null;
    }

    private _getViewConfig(): IViewConfig | null {
        if (this.viewConfig) {
            return this.viewConfig;
        }
        const typeKey = this._getTypeKey();
        if (!typeKey) {
            return null;
        }
        this.viewConfig = getViewConfig(typeKey);
        if (!this.viewConfig) {
            m.logMgr?.error(`[${typeKey}] 未找到视图配置`);
            return null;
        }
        return this.viewConfig;
    }

    private _playShowAnim(onComplete?: () => void) {
        if (!this.panel) {
            onComplete?.();
            return;
        }
        this.panel.setScale(0.85, 0.85, 1);
        if (this.maskOpacity) {
            this.maskOpacity.opacity = 0;
        }

        tween(this.panel)
            .to(SHOW_DURATION, { scale: Vec3.ONE }, { easing: "backOut" })
            .call(onComplete)
            .start();

        if (this.maskOpacity) {
            tween(this.maskOpacity)
                .to(SHOW_DURATION, { opacity: 180 })
                .start();
        }
    }

    private _playHideAnim(onComplete?: () => void) {
        if (!this.panel) {
            onComplete?.();
            return;
        }
        tween(this.panel)
            .to(HIDE_DURATION, { scale: new Vec3(0.85, 0.85, 0.85) }, { easing: "backIn" })
            .call(onComplete)
            .start();

        if (this.maskOpacity) {
            tween(this.maskOpacity)
                .to(HIDE_DURATION, { opacity: 0 })
                .start();
        }
    }
}
