import { CustomLayer } from "../customLayers/CustomLayer";

/**
 * 层级类型枚举
 */
export enum LayerType {
    /**
     * 场景层(登录， 大厅， 游戏场景等等)
     */
    SCENE,
    /**
     * 常规 UI(背包， 商城， 个人中心，设置等等)
     */
    UI,
    /**
     * 弹窗层(活动， 礼包等等)
     */
    POP,
    /**
     * 最顶层(引导， 提示语， 公告等等)
     */
    TOP,
};

const LayerNameMap = {
    [LayerType.SCENE]: "SCENE",
    [LayerType.UI]: "UI",
    [LayerType.POP]: "POP",
    [LayerType.TOP]: "TOP",
};

/**
 * 层级类映射
 */
export const LayerClassMap: Map<string, layer.LayerClassType> = new Map(
    [
        [LayerNameMap[LayerType.SCENE], CustomLayer],
        [LayerNameMap[LayerType.UI], CustomLayer],
        [LayerNameMap[LayerType.POP], CustomLayer],
        [LayerNameMap[LayerType.TOP], CustomLayer],
    ]
);
