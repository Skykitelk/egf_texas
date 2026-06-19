import { director, Director, Node, NodeEventType, UITransform } from 'cc';

/**
 * 场景层：作为 NodeCtrl 界面的父节点，随子节点可见性自动显隐。
 */
export class SceneLayer extends Node implements layer.ILayer {

    protected _layerType = 0;
    protected _layerMgr: layer.IMgr<Node>;

    /** 已绑定可见性监听的子节点 */
    private _boundChildren = new Set<Node>();

    /** 父层隐藏期间，子节点 active 变化不会派发事件，需轮询兜底 */
    private _isVisibilityWatching = false;

    get layerType() {
        return this._layerType;
    }

    get layerName() {
        return this.name;
    }

    onInit(layerName: string, layerType: number, layerMgr: layer.IMgr<Node>) {
        this._layerType = layerType;
        this.name = layerName;
        this._layerMgr = layerMgr;
    }

    onDestroy() {
        this._stopVisibilityWatch();
        this._unbindAllChildren();
        this._layerMgr = null;
        this._layerType = 0;
        this.name = "";
        this.destroy();
    }

    /** SceneLayer 被挂载到根节点时 */
    onAdd(root: Node) {
        root.addChild(this);
        const uiTransform = this.addComponent(UITransform);
        const rootUITransform = root.getComponent(UITransform);
        uiTransform.contentSize.set(rootUITransform.contentSize.width, rootUITransform.contentSize.height);
        // 初始无子节点，同步为隐藏
        this._syncLayerVisibility();
    }


    /** SceneLayer 被隐藏时（由 layerMgr.hideLayer 调用） */
    onHide() {
        this.active = false;
        // 父层隐藏后子节点 active 变更不会派发事件，开启轮询兜底
        if (this.children.length > 0) {
            this._startVisibilityWatch();
        }
    }

    /** SceneLayer 被显示时（由 layerMgr.showLayer 调用） */
    onShow() {
        this.active = true;
        this._stopVisibilityWatch();
    }

    /** 子节点被挂载到 SceneLayer 时（由 layerMgr.addNodeToLayer 调用） */
    onNodeAdd(node: Node) {
        if (node.parent && node.parent === this) {
            return;
        }
        this.addChild(node);
        this._bindChildVisibility(node);
        this._syncLayerVisibility();
        // onNodeAdd 与 NodeCtrl.onShow 常在同一帧内连续执行，延后一帧再同步
        this._deferSyncLayerVisibility();
    }

    private _bindChildVisibility(node: Node): void {
        if (this._boundChildren.has(node)) {
            return;
        }
        this._boundChildren.add(node);
        node.on(NodeEventType.ACTIVE_CHANGED, this._onChildVisibilityChanged, this);
        node.once(NodeEventType.NODE_DESTROYED, () => {
            this._unbindChildVisibility(node);
            this._syncLayerVisibility();
        });
    }

    private _unbindChildVisibility(node: Node): void {
        if (!this._boundChildren.has(node)) {
            return;
        }
        this._boundChildren.delete(node);
        node.off(NodeEventType.ACTIVE_CHANGED, this._onChildVisibilityChanged, this);
    }

    private _unbindAllChildren(): void {
        for (const child of this._boundChildren) {
            child.off(NodeEventType.ACTIVE_CHANGED, this._onChildVisibilityChanged, this);
        }
        this._boundChildren.clear();
    }

    private _onChildVisibilityChanged = (): void => {
        this._syncLayerVisibility();
    };

    /** 帧末再同步，覆盖「父层已隐藏时子节点 active 变更不派发事件」的情况 */
    private _deferSyncLayerVisibility(): void {
        director.once(Director.EVENT_AFTER_UPDATE, this._syncLayerVisibility, this);
    }

    private _startVisibilityWatch(): void {
        if (this._isVisibilityWatching) {
            return;
        }
        this._isVisibilityWatching = true;
        director.on(Director.EVENT_AFTER_UPDATE, this._watchChildVisibility, this);
    }

    private _stopVisibilityWatch(): void {
        if (!this._isVisibilityWatching) {
            return;
        }
        this._isVisibilityWatching = false;
        director.off(Director.EVENT_AFTER_UPDATE, this._watchChildVisibility, this);
    }

    /** 父层隐藏期间轮询子节点 active，任意子节点显示则恢复 SceneLayer */
    private _watchChildVisibility = (): void => {
        if (this.active) {
            this._stopVisibilityWatch();
            return;
        }
        if (!this._areAllChildrenHidden()) {
            this._syncLayerVisibility();
        }
    };

    /** 是否所有直接子节点都已隐藏（无子节点视为全部隐藏） */
    private _areAllChildrenHidden(): boolean {
        if (this.children.length === 0) {
            return true;
        }
        // 与 NodeCtrl.onHide/onShow 一致，以 node.active 为准
        return this.children.every((child) => !child.active);
    }

    /**
     * 根据子节点可见性，通过 layerMgr 触发 onHide / onShow。
     * 不在 onHide / onShow 内调用，避免递归。
     */
    private _syncLayerVisibility(): void {
        if (!this._layerMgr) {
            return;
        }
        const allHidden = this._areAllChildrenHidden();
        if (allHidden && this.active) {
            this._layerMgr.hideLayer(this._layerType);
        } else if (!allHidden && !this.active) {
            this._layerMgr.showLayer(this._layerType);
        }
        if (allHidden && this.children.length === 0) {
            this._stopVisibilityWatch();
        }
    }
}
