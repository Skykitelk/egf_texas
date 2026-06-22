import { instantiate, Node, Prefab, tween, Tween, UIOpacity, Vec3 } from "cc";
import { NodeCtrl } from "@ailhc/dpctrl-c3d";
import { LayerType } from "../configs/LayerConfig";
import { getViewCtrlMeta, IViewCtrlMeta } from "../configs/ViewRegistry";
import { m } from "../modules/ModuleMgr";

const SHOW_DURATION = 0.25;
const HIDE_DURATION = 0.2;
const DEFAULT_VIEW_BUNDLE = "resources";

type ViewCtrlClass = typeof BaseView & Partial<IViewCtrlMeta>;

/**
 * 基础视图类。所有视图都应该继承自此基类。
 */
export abstract class BaseView extends NodeCtrl {

    isShowing = false;
    protected panel: Node;
    protected maskOpacity: UIOpacity;

    /**
     * 默认资源列表：读取装饰器写入的 prefabUrl / viewBundle
     * 子类可 override 追加其他资源
     */
    getRess(): IViewRessItem[] {
        const meta = this._getViewMeta();
        if (!meta?.prefabUrl) {
            return [];
        }
        return [{
            path: meta.prefabUrl,
            type: Prefab,
            bundle: meta.viewBundle ?? DEFAULT_VIEW_BUNDLE,
        }];
    }

    /**
     * 从 AssetMgr 缓存实例化 prefab 并挂载到层级
     * @returns 是否挂载成功
     */
    protected mountPrefabView(): boolean {
        const meta = this._getViewMeta();
        if (!meta?.prefabUrl) {
            m.logMgr?.error(`[${meta?.typeKey ?? this.constructor.name}] 未配置 prefabUrl`);
            return false;
        }

        const bundle = meta.viewBundle ?? DEFAULT_VIEW_BUNDLE;
        const layer = meta.viewLayer ?? LayerType.UI;
        const prefab = m.assetMgr.get({
            path: meta.prefabUrl,
            type: Prefab,
            bundle,
        });

        if (!prefab) {
            m.logMgr?.error(
                `[${meta.typeKey}] prefab 未加载: ${bundle}://${meta.prefabUrl}`,
            );
            return false;
        }

        this.node = instantiate(prefab);
        m.layerMgr.addNodeToLayer(this.node, layer);
        this.bindAnimNodes();
        return true;
    }

    /** onInit 里 instantiate 之后调用 */
    protected bindAnimNodes(panelName = "panel", maskName = "mask") {
        this.panel = this.node.getChildByName(panelName);
        const mask = this.node.getChildByName(maskName);
        this.maskOpacity = mask?.getComponent(UIOpacity) ?? mask?.addComponent(UIOpacity);
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
        if (!this.node?.active) {
            return;
        }
        Tween.stopAllByTarget(this.panel);
        this.maskOpacity && Tween.stopAllByTarget(this.maskOpacity);

        this._playHideAnim(() => {
            super.onHide();
        });
    }

    protected _getViewMeta(): IViewCtrlMeta | null {
        //@ts-ignore
        return getViewCtrlMeta(this.constructor as ViewCtrlClass);
    }

    protected _playShowAnim(onComplete?: () => void) {
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

    protected _playHideAnim(onComplete?: () => void) {
        if (!this.panel) {
            onComplete?.();
            return;
        }
        tween(this.panel)
            .to(HIDE_DURATION, { scale: new Vec3(0.85, 0.85, 1) }, { easing: "backIn" })
            .call(onComplete)
            .start();

        if (this.maskOpacity) {
            tween(this.maskOpacity)
                .to(HIDE_DURATION, { opacity: 0 })
                .start();
        }
    }
}
