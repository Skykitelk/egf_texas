/**
 * PWA 安装：beforeinstallprompt + installPWA API
 */
(function (global) {
    let deferredPrompt = null;

    global.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        global._pwaAvailable = true;
        global.dispatchEvent(new Event('PWA_AVAILABLE'));
    });

    global.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        global._pwaAvailable = false;
        global.dispatchEvent(new Event('PWA_INSTALLED'));
    });

    global.isPwaInstallAvailable = function () {
        return !!global._pwaAvailable || !!deferredPrompt;
    };

    global.installPWA = function () {
        if (!deferredPrompt) {
            return Promise.resolve({ ok: false, reason: 'unavailable' });
        }
        const prompt = deferredPrompt;
        deferredPrompt = null;
        global._pwaAvailable = false;
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
