import { BaseView } from "../components/BaseView";

export class LoginView extends BaseView {

    onInit(config: displayCtrl.IInitConfig<"LoginView", IViewInitDataMap>) {
        super.onInit(config);
    }

    onShow(config?: displayCtrl.IShowConfig<"LoginView", IViewInitDataMap, IViewShowDataMap>) {
        super.onShow(config);
        config.onShowData
    }

    onHide() {
        super.onHide();
    }

    onDestroy(destroyRes?: boolean): void {
        super.onDestroy(destroyRes);
    }
};
