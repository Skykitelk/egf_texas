import { m } from "../modules/ModuleMgr";
import { LoginView } from "./LoginView";

/**
 * 注册主包 View 到 uiMgr
 * @param uiMgr - UI管理器
 * @returns 
 */
export function registerMainViews(): void {
    const uiMgr = m.uiMgr;
    const logMgr = m.logMgr;
    if (!uiMgr) {
        logMgr?.error("[View] uiMgr 未初始化");
        return;
    };
    uiMgr.regist(LoginView, 'LoginView');
    logMgr?.info("[View] 主包 View 已注册");
};
