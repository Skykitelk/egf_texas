import { Prefab } from "cc";
import { BaseView } from "../components/BaseView";

export class LoginView extends BaseView {

    onShowData: { playerName: string };

    onInit(config: displayCtrl.IInitConfig<"LoginView", IViewInitDataMap>) {
        super.onInit(config);
    }

    onShow(config?: displayCtrl.IShowConfig<"LoginView", IViewInitDataMap, IViewShowDataMap>) {
        super.onShow(config);
    }

    onHide() {
        super.onHide();
    }

    onDestroy(destroyRes?: boolean): void {
        super.onDestroy(destroyRes);
    }
};
