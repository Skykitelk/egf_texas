import { LayerType } from "../configs/LayerConfig";
import { registTypesToUiMgr } from "../configs/ViewRegistry";
import { BaseView } from "../components/BaseView";

@registTypesToUiMgr("LoginView", {
    prefabUrl: "login/LoginView",
    bundle: "resources",
    layer: LayerType.UI,
})
export class LoginView extends BaseView {

    onShowData: { playerName: string };

    onInit(config: displayCtrl.IInitConfig<"LoginView", IViewInitDataMap>) {
        super.onInit(config);
        this.mountPrefabView();
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
}
