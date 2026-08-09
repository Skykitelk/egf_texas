import { BaseView } from "db://assets/scripts/components/BaseView";

export class LobbyView extends BaseView {

    onInit(config: displayCtrl.IInitConfig<"LobbyView", IViewInitDataMap>) {
        super.onInit(config);
    }

    onShow(config: displayCtrl.IShowConfig<"LobbyView", IViewInitDataMap, IViewShowDataMap>) {
        super.onShow(config);
        
    }

    onHide() {
        super.onHide();
    }

    onDestroy(destroyRes?: boolean): void {
        super.onDestroy(destroyRes);
    }
};
