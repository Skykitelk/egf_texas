/**
 * 页面启动：版本校验、Update Now、SW/页面拦截、bootGame
 * 依赖注入：initBundles, allBundles, runtimeVersion, cdnAddress, writeJS, writeJSON, writeImport
 */
(function (global) {
    const R = function () {
        return global.BundleZipperRuntime || {};
    };
    const S = function () {
        return global.BundleZipperStorage;
    };
    const log = function () {
        return R().Logger || console;
    };

    let hasBoot = false;
    let updatePromptShown = false;

    function getRuntimeVersion() {
        if (typeof runtimeVersion !== 'undefined' && runtimeVersion) {
            return runtimeVersion;
        }
        return typeof swVersion !== 'undefined' ? swVersion : '';
    }

    function getAllBundles() {
        return typeof allBundles !== 'undefined' && allBundles ? allBundles : {};
    }

    function getInitBundles() {
        return typeof initBundles !== 'undefined' && Array.isArray(initBundles) ? initBundles.slice() : [];
    }

    function getUi() {
        return global.BundleZipperRuntimeUI || null;
    }

    function canUseServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            return false;
        }
        if (!global.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            return false;
        }
        if (location.protocol === 'file:') {
            return false;
        }
        return true;
    }

    function desiredSnapshot() {
        return R().buildConfirmedSnapshot(getRuntimeVersion(), getInitBundles(), getAllBundles());
    }

    async function syncMetaSnapshot(desired) {
        const installed = await S().getInstalledMap();
        await S().writeMeta({
            installed: installed,
            runtimeVersion: (desired && desired.runtimeVersion) || getRuntimeVersion(),
            initBundles: (desired && desired.initBundles) || {},
            allBundlesFp: (desired && desired.allBundlesFp) || '',
            updatedAt: Date.now(),
        });
    }

    async function ensureInitBundlesInstalled(options) {
        options = options || {};
        const progressUi = options.progressUi || null;
        const useInitLoadingUi = !progressUi && options.useInitLoadingUi !== false;
        const ui = getUi();
        const initList = getInitBundles();
        const bundles = getAllBundles();
        const installer = global.BundleZipperInstaller;
        if (!installer || !installer.installBundleAndWait) {
            log().warn('installer unavailable, skip initBundles install');
            return;
        }
        const todo = [];
        for (let i = 0; i < initList.length; i++) {
            const name = initList[i];
            if (!bundles[name]) {
                log().warn('initBundle missing from allBundles, skip', name);
                continue;
            }
            todo.push(name);
        }
        if (!todo.length) {
            return;
        }

        if (useInitLoadingUi && ui && ui.showInitBundlesLoading) {
            ui.showInitBundlesLoading();
        }

        log().info('ensureInitBundlesInstalled', todo.join(','));
        const prevProgress = global.onBundleInstallProgress;

        function reportProgress(index, bundleName, bundleProgress) {
            const p = Math.max(0, Math.min(1, Number(bundleProgress) || 0));
            const overall01 = (index + p) / Math.max(todo.length, 1);
            const percent = Math.round(overall01 * 100);
            const status =
                'Loading ' + bundleName + ' (' + (index + 1) + '/' + todo.length + ')';
            const detail = Math.round(p * 100) + '%';
            if (useInitLoadingUi && ui && ui.setInitBundlesProgress) {
                ui.setInitBundlesProgress(percent, status, detail);
            }
            if (progressUi && progressUi.setRuntimeUpdateProgress) {
                progressUi.setRuntimeUpdateProgress(20 + Math.round(overall01 * 70));
            }
            if (progressUi && progressUi.setRuntimeUpdateStatus) {
                progressUi.setRuntimeUpdateStatus(status);
            }
        }

        try {
            for (let i = 0; i < todo.length; i++) {
                const name = todo[i];
                reportProgress(i, name, 0);
                global.onBundleInstallProgress = function (bundleName, progress) {
                    if (typeof prevProgress === 'function') {
                        prevProgress(bundleName, progress);
                    }
                    if (bundleName === name) {
                        reportProgress(i, name, progress);
                    }
                };
                if (await S().hasCompleteBundle(name, bundles[name])) {
                    log().info('initBundle already installed', name, bundles[name]);
                    reportProgress(i, name, 1);
                    continue;
                }
                await installer.installBundleAndWait(name);
                reportProgress(i, name, 1);
            }
            if (useInitLoadingUi && ui && ui.setInitBundlesProgress) {
                ui.setInitBundlesProgress(100, 'Resources ready', 'Waiting for game...');
            }
        } finally {
            global.onBundleInstallProgress = prevProgress;
        }
    }

    async function needsUpdate() {
        const desired = desiredSnapshot();
        const confirmed = R().readConfirmedSnapshot();
        if (!confirmed || !R().snapshotsEqual(confirmed, desired)) {
            if (!confirmed) {
                // 首次：若本地已有过期缓存，也需要 Update；否则可直接确认当前快照
                const stale = await S().listStaleCacheKeys(getAllBundles());
                if (stale.length) {
                    log().info('update needed: first run with stale caches', stale.length);
                    return { needed: true, reason: 'stale-on-first-run', desired: desired };
                }
                // 首次无脏缓存：直接写入确认快照，不弹窗（随后仍会预装 initBundles）
                R().writeConfirmedSnapshot(desired);
                await syncMetaSnapshot(desired);
                log().info('first run: snapshot confirmed silently');
                return { needed: false, desired: desired };
            }
            log().info('update needed: snapshot mismatch');
            return { needed: true, reason: 'snapshot-mismatch', desired: desired };
        }
        const stale = await S().listStaleCacheKeys(getAllBundles());
        if (stale.length) {
            log().info('update needed: stale caches', stale.length);
            return { needed: true, reason: 'stale-caches', desired: desired };
        }
        return { needed: false, desired: desired };
    }

    async function performUpdate(desired) {
        const ui = getUi();
        if (ui && ui.showRuntimeUpdateOverlay) {
            ui.showRuntimeUpdateOverlay();
        }
        if (ui && ui.setRuntimeUpdateProgress) {
            ui.setRuntimeUpdateProgress(5);
        }

        const purged = await S().purgeStaleVersions(getAllBundles());
        log().info('update purged', purged.length);
        if (ui && ui.setRuntimeUpdateProgress) {
            ui.setRuntimeUpdateProgress(20);
        }

        await ensureInitBundlesInstalled({ progressUi: ui });

        const snap = desired || desiredSnapshot();
        R().writeConfirmedSnapshot(snap);
        await syncMetaSnapshot(snap);
        if (ui && ui.setRuntimeUpdateProgress) {
            ui.setRuntimeUpdateProgress(100);
        }

        if (canUseServiceWorker()) {
            try {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg && reg.waiting) {
                    reg.waiting.postMessage({ what: 'skipWaiting' });
                }
            } catch (_) {}
        }

        log().info('update complete, reloading');
        location.reload();
    }

    async function promptAndUpdate(check) {
        if (updatePromptShown) {
            return false;
        }
        updatePromptShown = true;
        const ui = getUi();
        if (ui && ui.ensureDom) {
            ui.ensureDom();
        }
        let action = 'reload';
        if (ui && ui.showRuntimeUpdateModal) {
            action = await ui.showRuntimeUpdateModal();
        }
        if (action === 'reload') {
            try {
                await performUpdate(check.desired);
            } catch (err) {
                log().error('update failed', err);
                if (ui && ui.showRuntimeUpdateError) {
                    ui.showRuntimeUpdateError(String(err && err.message ? err.message : err));
                } else if (ui && ui.hideRuntimeUpdateOverlay) {
                    ui.hideRuntimeUpdateOverlay();
                }
                updatePromptShown = false;
                throw err;
            }
            return true;
        }
        return false;
    }

    function bootGame(reason) {
        if (hasBoot) {
            return;
        }
        hasBoot = true;
        if (reason) {
            log().warn('bootGame:', reason);
        } else {
            log().info('bootGame: starting Cocos engine');
        }

        function resolveEngineUrl(path) {
            return new URL(path, window.location.href).href;
        }

        function appendScript(src) {
            const scriptUrl = resolveEngineUrl(src);
            return new Promise(function (resolve, reject) {
                const timer = setTimeout(function () {
                    reject(new Error('Script load timeout: ' + scriptUrl));
                }, 60000);
                const scriptEl = document.createElement('script');
                scriptEl.charset = 'utf-8';
                scriptEl.type = 'text/javascript';
                scriptEl.src = scriptUrl;
                scriptEl.onload = function () {
                    clearTimeout(timer);
                    resolve();
                };
                scriptEl.onerror = function () {
                    clearTimeout(timer);
                    reject(new Error('Failed to load script: ' + scriptUrl));
                };
                document.head.appendChild(scriptEl);
            });
        }

        function registerImportMapScript() {
            if (typeof writeJSON === 'undefined' || !writeJSON) {
                return Promise.resolve();
            }
            const mapUrl = resolveEngineUrl(writeJSON);
            const importMapEl = document.createElement('script');
            importMapEl.type = 'systemjs-importmap';
            importMapEl.charset = 'utf-8';
            importMapEl.src = mapUrl;
            document.head.appendChild(importMapEl);
            if (typeof System === 'undefined' || !System.prepareImport) {
                return Promise.reject(new Error('System.prepareImport is not available'));
            }
            return System.prepareImport();
        }

        function runSystemImport() {
            if (typeof writeImport === 'undefined' || !writeImport) {
                return Promise.resolve();
            }
            if (typeof System === 'undefined' || !System.import) {
                return Promise.reject(new Error('System.import is not available'));
            }
            const match = writeImport.match(/System\.import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
            if (!match) {
                return Promise.reject(new Error('invalid writeImport: ' + writeImport));
            }
            const entryUrl = new URL(match[1], window.location.href).href;
            return System.import(entryUrl);
        }

        const jsFiles = typeof writeJS !== 'undefined' && writeJS ? writeJS : [];
        let chain = Promise.resolve();
        for (let i = 0; i < jsFiles.length; i++) {
            (function (src) {
                chain = chain.then(function () {
                    return appendScript(src);
                });
            })(jsFiles[i]);
        }
        chain
            .then(function () {
                return registerImportMapScript();
            })
            .then(function () {
                return runSystemImport();
            })
            .catch(function (err) {
                log().error('engine script load failed:', err);
                return runSystemImport().catch(function (importErr) {
                    log().error('engine entry import failed:', importErr);
                });
            })
            .then(function () {
                const splash = document.getElementById('splashScreen');
                if (splash) {
                    splash.style.display = 'none';
                }
            });
    }

    async function unregisterStaleServiceWorkers(keepScopeHref) {
        if (!navigator.serviceWorker.getRegistrations) {
            return { unregistered: 0, needReload: false };
        }
        const regs = await navigator.serviceWorker.getRegistrations();
        const keep = new URL(keepScopeHref, location.origin);
        let keepPath = keep.pathname;
        if (!keepPath.endsWith('/')) {
            keepPath += '/';
        }

        function scopesEqual(scopeHref) {
            try {
                const s = new URL(scopeHref, location.origin);
                let p = s.pathname;
                if (!p.endsWith('/')) {
                    p += '/';
                }
                return s.origin === keep.origin && p === keepPath;
            } catch (_) {
                return false;
            }
        }

        function isOurSw(reg) {
            const workers = [reg.active, reg.waiting, reg.installing].filter(Boolean);
            for (let i = 0; i < workers.length; i++) {
                if (/\/sw\.js(\?|$)/i.test(workers[i].scriptURL || '')) {
                    return true;
                }
            }
            return false;
        }

        const controller = navigator.serviceWorker.controller;
        let unregistered = 0;
        let needReload = false;

        for (let i = 0; i < regs.length; i++) {
            const reg = regs[i];
            if (scopesEqual(reg.scope)) {
                continue;
            }
            // 只清理本插件的 sw.js，避免误伤同域其它业务 SW
            if (!isOurSw(reg)) {
                continue;
            }
            if (
                controller &&
                reg.active &&
                controller.scriptURL === reg.active.scriptURL
            ) {
                needReload = true;
            }
            try {
                const ok = await reg.unregister();
                if (ok) {
                    unregistered++;
                    log().info('unregistered stale SW', reg.scope);
                }
            } catch (err) {
                log().warn('unregister stale SW failed', reg.scope, err);
            }
        }
        return { unregistered: unregistered, needReload: needReload };
    }

    async function registerSw() {
        const rv = getRuntimeVersion();
        const scopePath = R().resolveBaseRoute();
        const scopeHref = new URL(scopePath, location.origin).href;
        const swUrl = scopePath + 'sw.js?v=' + encodeURIComponent(rv);

        // 换部署路径后同 origin 可能残留多个 sw.js；只保留当前 scope
        const cleanup = await unregisterStaleServiceWorkers(scopeHref);
        if (cleanup.unregistered) {
            log().info('stale SW cleaned', cleanup.unregistered);
        }

        const reg = await navigator.serviceWorker.register(swUrl, {
            scope: scopePath,
        });
        if (reg.installing) {
            await new Promise(function (resolve) {
                const w = reg.installing;
                w.addEventListener('statechange', function () {
                    if (w.state === 'installed' || w.state === 'activated') {
                        resolve();
                    }
                });
                setTimeout(resolve, 10000);
            });
        }
        if (reg.active && reg.active.postMessage) {
            try {
                // 尽快接管本 scope 下的客户端
                // skipWaiting 由 SW install 侧处理；此处仅提示
            } catch (_) {}
        }
        if (!navigator.serviceWorker.controller && reg.active) {
            log().info('SW registered, waiting for controller on next navigation');
        }

        // 若刚注销的是正在控制页面的旧 scope SW，需要 reload 一次让当前 SW 接管
        const SS_SW_SCOPE_RELOAD = 'BundleZipper.swScopeReload';
        if (cleanup.needReload) {
            try {
                if (!sessionStorage.getItem(SS_SW_SCOPE_RELOAD)) {
                    sessionStorage.setItem(SS_SW_SCOPE_RELOAD, '1');
                    log().info('reloading to activate current SW scope', scopeHref);
                    location.reload();
                    // reload 异步生效前 JS 仍会继续：返回 null 让上层立刻停手
                    return null;
                }
                sessionStorage.removeItem(SS_SW_SCOPE_RELOAD);
            } catch (_) {}
        } else {
            try {
                sessionStorage.removeItem(SS_SW_SCOPE_RELOAD);
            } catch (_) {}
        }

        log().info('SW active scope=', reg.scope);
        return reg;
    }

    function syncNetworkInterceptMode(preferSw) {
        const spill = !!(S() && S().hasSessionSpill && S().hasSessionSpill());
        const defer = !!preferSw && !spill;
        if (!global.BundleZipperNetwork) {
            return defer;
        }
        if (defer) {
            global.BundleZipperNetwork.setDeferToServiceWorker(true);
            log().info('network intercept deferred to SW');
        } else {
            // session spill 或无 controller：必须走页面拦截，否则 SW 读不到页面 memory
            global.BundleZipperNetwork.install({ deferToServiceWorker: false });
            global.BundleZipperNetwork.setDeferToServiceWorker(false);
            if (spill) {
                log().info('network intercept forced to page (session spill)');
            }
        }
        return defer;
    }

    async function startPageMode() {
        log().info('mode: page intercept', 'storage=', S().getStorageKind());
        syncNetworkInterceptMode(false);
        await ensureInitBundlesInstalled({ useInitLoadingUi: true });
        syncNetworkInterceptMode(false);
        await syncMetaSnapshot(desiredSnapshot());
        bootGame();
    }

    async function startSwMode() {
        log().info('mode: service worker', 'storage=', S().getStorageKind());
        try {
            const reg = await registerSw();
            if (!reg) {
                // 已触发 scope reload，勿继续预装/boot
                return;
            }
            syncNetworkInterceptMode(!!navigator.serviceWorker.controller);
        } catch (err) {
            log().warn('SW register failed, fallback page mode', err);
            return startPageMode();
        }
        await ensureInitBundlesInstalled({ useInitLoadingUi: true });
        // init 期间可能发生 quota spill，需重新决定是否 defer SW
        syncNetworkInterceptMode(!!navigator.serviceWorker.controller);
        await syncMetaSnapshot(desiredSnapshot());
        bootGame();
    }

    async function start() {
        const ui = getUi();
        if (ui && ui.ensureDom) {
            ui.ensureDom();
        }

        await S().resolvePersistent();
        try {
            await S().migrateAbsoluteKeysToStable();
        } catch (err) {
            log().warn('migrateAbsoluteKeysToStable failed', err);
        }
        log().info(
            'startup',
            'runtimeVersion=',
            getRuntimeVersion(),
            'initBundles=',
            getInitBundles().join(',') || '(empty)',
            'storage=',
            S().getStorageKind() || '(pending)',
        );

        const check = await needsUpdate();
        if (check.needed) {
            const reloading = await promptAndUpdate(check);
            if (reloading) {
                return;
            }
        }

        if (canUseServiceWorker()) {
            await startSwMode();
        } else {
            await startPageMode();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            start().catch(function (err) {
                log().error('startup failed', err);
                bootGame('startup failed: ' + err);
            });
        });
    } else {
        start().catch(function (err) {
            log().error('startup failed', err);
            bootGame('startup failed: ' + err);
        });
    }
})(window);
