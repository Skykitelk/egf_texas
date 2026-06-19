import { App } from '@ailhc/egf-core';
import { _decorator, Component, Enum, Node } from 'cc';
import { m, ModuleLoader } from './modules/ModuleMgr';
const { ccclass, property } = _decorator;

/**
 * 日志级别
 */
enum ELogLevel {
    LOG = "log",
    INFO = "info",
    WARN = "warn",
    ERROR = "error",
};

/**
 * 应用环境
 */
enum EAppEnv {
    DEV = "dev",
    PROD = "prod",
};

@ccclass('main')
export class main extends Component {

    @property({
        tooltip: '是否将app.moduleMap挂载到window对象',
    })
    isMountWindow: boolean = false;

    @property({
        tooltip: '日志级别',
        type: Enum(ELogLevel),
    })
    logLevel: ELogLevel = ELogLevel.INFO;

    @property({
        tooltip: '应用环境',
        type: Enum(EAppEnv),
    })
    appEnv: EAppEnv = EAppEnv.DEV;

    onLoad() {
        this.initApp()
        .then(async () => {
            this.setupModule();
            this.runTest();
        })
        .catch(err => {
            m.logMgr.error(`[app] init failed: ${err}`);
        });
    };

    async initApp() {
        if (this.appEnv === EAppEnv.PROD) {
            this.isMountWindow = false;
        };
        const app = new App<IModuleMap>();
        await app.bootstrap([new ModuleLoader(this.node, this.isMountWindow)]);
        app.init();
        m.logMgr.info("[app] init success");
    };

    setupModule() {
        m.logMgr.setMinLevel(this.logLevel);
        m.logMgr.setProduction(this.appEnv === EAppEnv.PROD);
    };

    runTest() {
        m.uiMgr.showDpc('LoginView', {playerName: "test"});
        this.scheduleOnce(() => {
            m.uiMgr.hideDpc('LoginView');

            this.scheduleOnce(() => {
                m.uiMgr.showDpc('LoginView', {playerName: "test"});
            }, 3);
        }, 3);
    }
};

