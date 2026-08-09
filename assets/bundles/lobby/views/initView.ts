import { m } from "../../../scripts/modules/ModuleMgr";
import { LobbyView } from "./LobbyView";


/**
 * 注册 lobby bundle View 到 uiMgr。
 * 须在 loadBundle("lobby") 且 bootstrap 完成后调用。
 */
export function registerLobbyViews(): void {
    m.uiMgr.regist(LobbyView, "LobbyView");
    m.logMgr?.info("[View] lobby View 已注册");
};
