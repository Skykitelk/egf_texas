import { instantiate } from 'cc';
import { Prefab } from 'cc';
import { m } from '../modules/ModuleMgr';
import { LayerType } from '../configs/LayerConfig';
import { BaseView } from '../components/BaseView';

export class LoginView extends BaseView {

    static typeKey = "LoginView";
    static prefabUrl = "login/LoginView";

    onShowData: { playerName: string };

    private static _ress: IViewRessItem[] = [
        { path: LoginView.prefabUrl, type: Prefab, bundle: "resources" },
    ];

    getRess() {
        return LoginView._ress;
    };

    onInit(config: displayCtrl.IInitConfig<"LoginView", IViewInitDataMap>) {
        super.onInit();
        const viewPrefab = m.assetMgr.get({
            path: LoginView.prefabUrl,
            type: Prefab,
            bundle: "resources",
        });
        if (viewPrefab) {
            this.node = instantiate(viewPrefab);
            m.layerMgr.addNodeToLayer(this.node, LayerType.UI);
            this.bindAnimNodes();
        }
        else {
            m.logMgr.error(`[LoginView] 加载 prefab 失败: ${LoginView.prefabUrl}`);
        }
    };

    onShow(config?: displayCtrl.IShowConfig<"LoginView", IViewInitDataMap, IViewShowDataMap>) {
        super.onShow(config);
    };

    onHide() {
        super.onHide();
    };

    onDestroy(destroyRes?: boolean): void {
        super.onDestroy(destroyRes);
    };
};

