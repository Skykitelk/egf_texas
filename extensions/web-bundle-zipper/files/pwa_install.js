/**
 * PWA 安装：beforeinstallprompt + installPWA API（挂到 WebBundleZipper）
 */
(function (global) {
    let deferredPrompt = null;

    function api() {
        if (!global.WebBundleZipper) {
            global.WebBundleZipper = {};
        }
        return global.WebBundleZipper;
    }

    global.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        api()._pwaAvailable = true;
        global.dispatchEvent(new Event('PWA_AVAILABLE'));
    });

    global.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        api()._pwaAvailable = false;
        global.dispatchEvent(new Event('PWA_INSTALLED'));
    });

    const root = api();
    root.isPwaInstallAvailable = function () {
        return !!root._pwaAvailable || !!deferredPrompt;
    };

    root.installPWA = function () {
        if (!deferredPrompt) {
            return Promise.resolve({ ok: false, reason: 'unavailable' });
        }
        const prompt = deferredPrompt;
        deferredPrompt = null;
        root._pwaAvailable = false;
        return prompt
            .prompt()
            .then(function () {
                return prompt.userChoice;
            })
            .then(function (choice) {
                return { ok: choice.outcome === 'accepted', outcome: choice.outcome };
            })
            .catch(function (err) {
                return { ok: false, reason: String(err) };
            });
    };
})(typeof window !== 'undefined' ? window : self);
