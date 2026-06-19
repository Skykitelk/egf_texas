import { LoginView } from "../views/LoginView";


declare global {
    /**
     * 界面 Key 映射
     */
    interface IViewKeyMap {
        LoginView: "LoginView";
    }
    /**
     * 初始化数据映射
     */
    interface IViewInitDataMap {
        LoginView: { playerName: string };
    }
    /**
     * 显示数据映射
     */
    interface IViewShowDataMap {
        LoginView: { playerName: string };
    }
    /**
     * 更新数据映射
     */
    interface IViewUpdateDataMap {
        LoginView: { playerName: string };
    }
};


/**
 * 界面控制器类映射, 用于注册界面控制器类
 */
export const ViewCtrlClassMap: displayCtrl.CtrlClassMap = {
    LoginView: LoginView,
};

