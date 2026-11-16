import { DpcMgr } from "@ailhc/dpctrl-c3d";
import { LayerType } from "./LayerConfig";

declare global {
    /**
     * 界面 Key 映射
     */
    interface IViewKeyMap {
        LoginView: "LoginView";
        LobbyView: "LobbyView";
    }
    /**
     * 初始化数据映射
     */
    interface IViewInitDataMap {
        LoginView: { playerName: string };
        LobbyView: { playerName: string };
    }
    /**
     * 显示数据映射
     */
    interface IViewShowDataMap {
        LoginView: { playerName: string };
        LobbyView: { playerName: string };
    }
    /**
     * 更新数据映射
     */
    interface IViewUpdateDataMap {
        LoginView: { playerName: string };
        LobbyView: { playerName: string };
    }
};

/**
 * 界面配置项
 */
export interface IViewConfig {
    /** 界面类型（与 IViewKeyMap 键一致） */
    name: keyof IViewKeyMap;
    /** 相对于 bundle 的 prefab 路径，不带扩展名 */
    path: string;
    /** prefab 所在 bundle */
    bundle: string;
    /** 挂载层级 */
    layer: LayerType;
};

/**
 * 全量界面配置
 * 各 bundle 的 registerXxxViews() 从此读取并校验后 regist。
 */
export const ViewConfigMap: Record<keyof IViewKeyMap, IViewConfig> = {
    LoginView: {
        name: "LoginView",
        path: "login/LoginView",
        bundle: "resources",
        layer: LayerType.UI,
    },
    LobbyView: {
        name: "LobbyView",
        path: "lobby/LobbyView",
        bundle: "lobby",
        layer: LayerType.UI,
    },
};

/**
 * 按 key 读取 View 配置
 * @param key - 界面类型（与 IViewKeyMap 键一致）
 * @returns 界面配置项
 */
export function getViewConfig(key: keyof IViewKeyMap): IViewConfig {
    return ViewConfigMap[key];
};


export {};
