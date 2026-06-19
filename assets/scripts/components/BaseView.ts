// assets/scripts/views/base/PopView.ts
import { Node, tween, Tween, UIOpacity, Vec3 } from 'cc';
import { NodeCtrl } from '@ailhc/dpctrl-c3d';

const SHOW_DURATION = 0.25;
const HIDE_DURATION = 0.2;

/**
 * 基础视图类。所有视图都应该继承自此基类。
 */
export abstract class BaseView extends NodeCtrl {

    isShowing = false;
    protected panel: Node;
    protected maskOpacity: UIOpacity;


    /** onInit 里 instantiate 之后调用 */
    protected bindAnimNodes(panelName = 'panel', maskName = 'mask') {
        this.panel = this.node.getChildByName(panelName);
        const mask = this.node.getChildByName(maskName);
        this.maskOpacity = mask?.getComponent(UIOpacity) ?? mask?.addComponent(UIOpacity);
    }

    onShow(config?: displayCtrl.IShowConfig) {
        super.onShow(config);          // ① 先显示节点
        this.isShowing = true;
        this._playShowAnim(() => {
            this.isShowing = false;
            config?.showEndCb?.();     // ② 动画结束回调
        });
    }

    onHide() {
        if (!this.node?.active) {
            return;
        }
        // 正在播放入场动画时，先停掉
        Tween.stopAllByTarget(this.panel);
        this.maskOpacity && Tween.stopAllByTarget(this.maskOpacity);

        this._playHideAnim(() => {
            super.onHide();            // ③ 动画结束再真正隐藏
        });
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
            .to(SHOW_DURATION, { scale: Vec3.ONE }, { easing: 'backOut' })
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
            .to(HIDE_DURATION, { scale: new Vec3(0.85, 0.85, 1) }, { easing: 'backIn' })
            .call(onComplete)
            .start();

        if (this.maskOpacity) {
            tween(this.maskOpacity)
                .to(HIDE_DURATION, { opacity: 0 })
                .start();
        }
    }
}