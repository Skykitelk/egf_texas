/**
 * 导入全部 View，触发 @registTypesToUiMgr 注册。
 * 由 main.ts 在 ModuleMgr 之前 import，避免循环依赖。
 * 新增 View 后在此追加 import。
 */
import "./LoginView";
