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
}

export {};
