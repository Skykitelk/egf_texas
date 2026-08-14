/**
 * 页面启动：版本校验、Update Now、SW/页面拦截、bootGame
 * 依赖注入：WebBundleZipper.initBundles / allBundles / runtimeVersion / cdnAddress / writeJS / writeJSON / writeImport
 */
(function (global) {
    const api = function () {
        if (!global.WebBundleZipper) {
            global.WebBundleZipper = {};
        }
        return global.WebBundleZipper;
    };
    const R = function () {
        return api().Runtime || {};
    };
    const S = function () {
        return api().Storage;
    };
    const log = function () {
        return R().Logger || console;
    };

    let hasBoot = false;
    let updatePromptShown = false;

    function getRuntimeVersion() {
        const c = api();
        if (c.runtimeVersion) {
            return c.runtimeVersion;
        }
        return c.swVersion || '';
    }

    function getAllBundles() {
        const c = api();
        return c.allBundles || {};
    }

    function getInitBundles() {
        const c = api();
        return Array.isArray(c.initBundles) ? c.initBundles.slice() : [];
    }

    function getPublishVersion() {
        const c = api();
        return c.publishVersion ? String(c.publishVersion) : '';
    }

    function getWriteJS() {
        const c = api();
        return c.writeJS || [];
    }

    function getWriteJSON() {
        const c = api();
        return c.writeJSON || '';
    }

    function getWriteImport() {
        const c = api();
        return c.writeImport || '';
    }

    function getUi() {
        return api().UI || null;
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
        // 单次 read，避免 installed/fileCounts 分两次读产生覆盖竞态
        const prev = (S().readMeta && (await S().readMeta())) || {};
        await S().writeMeta({
            installed: (prev && prev.installed) || {},
            fileCounts: (prev && prev.fileCounts) || {},
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
        const strict = !!options.strict;
        const ui = getUi();
        const initList = getInitBundles();
        const bundles = getAllBundles();
        const installer = api().Installer;
        if (!installer || !installer.installBundleAndWait) {
            log().warn('installer unavailable, skip initBundles install');
            if (strict) {
                throw new Error('installer unavailable');
            }
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
        const root = api();
        const prevProgress = root.onBundleInstallProgress;
        const failures = [];

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
                root.onBundleInstallProgress = function (bundleName, progress) {
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
                try {
                    await installer.installBundleAndWait(name);
                    if (strict && !(await S().hasCompleteBundle(name, bundles[name]))) {
                        throw new Error('install finished but bundle incomplete: ' + name);
                    }
                    reportProgress(i, name, 1);
                } catch (err) {
                    if (strict) {
                        failures.push(name + ': ' + (err && err.message ? err.message : err));
                        log().error('initBundle install failed (strict)', name, err);
                    } else {
                        // 单个 Bundle 失败不阻断启动（仍可回源 assets/ 目录）
                        log().error('initBundle install failed, continue boot', name, err);
                        reportProgress(i, name, 1);
                    }
                }
            }
            if (strict && failures.length) {
                throw new Error('initBundles failed: ' + failures.join('; '));
            }
            if (useInitLoadingUi && ui && ui.setInitBundlesProgress) {
                ui.setInitBundlesProgress(100, 'Resources ready', 'Waiting for game...');
            }
        } finally {
            root.onBundleInstallProgress = prevProgress;
        }
    }

    function canPersistConfirmedSnapshot() {
        try {
            if (typeof global.localStorage === 'undefined') {
                return false;
            }
            const k = 'BundleZipper.lsProbe';
            global.localStorage.setItem(k, '1');
            const ok = global.localStorage.getItem(k) === '1';
            global.localStorage.removeItem(k);
            return ok;
        } catch (_) {
            return false;
        }
    }

    function withTimeout(promise, ms, label) {
        return new Promise(function (resolve, reject) {
            let done = false;
            const timer = setTimeout(function () {
                if (done) {
                    return;
                }
                done = true;
                reject(new Error((label || 'operation') + ' timeout after ' + ms + 'ms'));
            }, ms);
            Promise.resolve(promise).then(
                function (value) {
                    if (done) {
                        return;
                    }
                    done = true;
                    clearTimeout(timer);
                    resolve(value);
                },
                function (err) {
                    if (done) {
                        return;
                    }
                    done = true;
                    clearTimeout(timer);
                    reject(err);
                },
            );
        });
    }

    function fetchWithTimeout(url, options, ms) {
        const timeout = typeof ms === 'number' ? ms : 5000;
        if (typeof AbortController !== 'undefined' && typeof fetch === 'function') {
            const ctrl = new AbortController();
            const opts = Object.assign({}, options || {});
            opts.signal = ctrl.signal;
            const timer = setTimeout(function () {
                try {
                    ctrl.abort();
                } catch (_) {}
            }, timeout);
            return fetch(url, opts).then(
                function (resp) {
                    clearTimeout(timer);
                    return resp;
                },
                function (err) {
                    clearTimeout(timer);
                    throw err;
                },
            );
        }
        // 旧 WebView：XHR.timeout 可真正掐断
        return new Promise(function (resolve, reject) {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.timeout = timeout;
                xhr.responseType = 'text';
                xhr.onload = function () {
                    const status = xhr.status || 0;
                    const body = xhr.responseText || '';
                    resolve(
                        new Response(body, {
                            status: status >= 200 && status < 600 ? status : 200,
                            statusText: xhr.statusText || '',
                            headers: { 'Content-Type': 'text/plain' },
                        }),
                    );
                };
                xhr.onerror = function () {
                    reject(new Error('fetchWithTimeout network error'));
                };
                xhr.ontimeout = function () {
                    reject(new Error('fetchWithTimeout timeout after ' + timeout + 'ms'));
                };
                xhr.send();
            } catch (err) {
                reject(err);
            }
        });
    }

    async function needsUpdate() {
        const desired = desiredSnapshot();
        const confirmed = R().readConfirmedSnapshot();
        if (!confirmed || !R().snapshotsEqual(confirmed, desired)) {
            // localStorage 不可用时弹 Update 也无法落确认 → 只会循环；改为静默清理后继续
            if (!canPersistConfirmedSnapshot()) {
                log().warn('localStorage unavailable; skip update modal');
                try {
                    await S().purgeStaleVersions(getAllBundles());
                } catch (_) {}
                return { needed: false, desired: desired };
            }
            if (!confirmed) {
                // 首次：若本地已有过期缓存，也需要 Update；否则可直接确认当前快照
                const stale = await S().listStaleCacheKeys(getAllBundles());
                if (stale.length) {
                    log().info('update needed: first run with stale caches', stale.length);
                    return { needed: true, reason: 'stale-on-first-run', desired: desired };
                }
                // 首次无脏缓存：直接写入确认快照，不弹窗（随后仍会预装 initBundles）
                R().writeConfirmedSnapshot(desired);
                try {
                    assertConfirmedSnapshotPersisted(desired);
                } catch (err) {
                    log().warn('first run silent confirm failed', err);
                    return { needed: false, desired: desired };
                }
                await syncMetaSnapshot(desired);
                log().info('first run: snapshot confirmed silently');
                return { needed: false, desired: desired };
            }
            log().info('update needed: snapshot mismatch');
            return { needed: true, reason: 'snapshot-mismatch', desired: desired };
        }

        // 快照已确认：残留旧 cache 只静默清理，绝不弹 Update（否则会循环弹窗）
        const stale = await S().listStaleCacheKeys(getAllBundles());
        if (stale.length) {
            log().info('silent purge stale caches (snapshot already confirmed)', stale.length);
            try {
                await S().purgeStaleVersions(getAllBundles());
            } catch (err) {
                log().warn('silent purge stale failed', err);
            }
        }
        return { needed: false, desired: desired };
    }

    function assertConfirmedSnapshotPersisted(snap) {
        const verify = R().readConfirmedSnapshot();
        if (!R().snapshotsEqual(verify, snap)) {
            throw new Error('failed to persist update confirmation (localStorage?)');
        }
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

        await ensureInitBundlesInstalled({ progressUi: ui, strict: true });

        const snap = desired || desiredSnapshot();
        R().writeConfirmedSnapshot(snap);
        assertConfirmedSnapshotPersisted(snap);
        await syncMetaSnapshot(snap);
        if (ui && ui.setRuntimeUpdateProgress) {
            ui.setRuntimeUpdateProgress(100);
        }

        // 确认已落盘：SW 步骤失败/超时不得挡住 reload（否则像卡死）
        if (canUseServiceWorker()) {
            try {
                await withTimeout(
                    (async function () {
                        const reg = await registerSw();
                        if (reg) {
                            await activateWaitingWorker(reg, 5000);
                        }
                    })(),
                    20000,
                    'SW register during update',
                );
            } catch (err) {
                log().warn('SW step after update skipped', err);
            }
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
        // Modal is OK-only; after click always enter update flow
        if (ui && ui.showRuntimeUpdateModal) {
            await ui.showRuntimeUpdateModal();
        }

        // Retry：等用户点按钮后再跑 performUpdate；失败不 throw，避免 bootGame 盖在失败层下
        while (true) {
            try {
                await performUpdate(check.desired);
                return true;
            } catch (err) {
                log().error('update failed', err);
                if (ui && ui.showRuntimeUpdateError) {
                    try {
                        await ui.showRuntimeUpdateError(
                            String(err && err.message ? err.message : err),
                        );
                        continue;
                    } catch (uiErr) {
                        log().error('update retry UI unavailable', uiErr);
                        if (ui && ui.hideRuntimeUpdateOverlay) {
                            ui.hideRuntimeUpdateOverlay();
                        }
                        updatePromptShown = false;
                        return false;
                    }
                }
                if (ui && ui.hideRuntimeUpdateOverlay) {
                    ui.hideRuntimeUpdateOverlay();
                }
                updatePromptShown = false;
                return false;
            }
        }
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
            const writeJSON = getWriteJSON();
            if (!writeJSON) {
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
            const writeImport = getWriteImport();
            if (!writeImport) {
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

        const jsFiles = getWriteJS();
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

        // 业务忘记关预装遮罩时的兜底（手机 WebView 上永久遮罩等于卡死）
        setTimeout(function () {
            try {
                const u = getUi();
                if (u && u.closeInitBundlesLoading) {
                    u.closeInitBundlesLoading();
                } else if (api().closeInitBundlesLoading) {
                    api().closeInitBundlesLoading();
                }
            } catch (_) {}
        }, 90000);
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

    /**
     * 激活 waiting SW，并尽量等到 controllerchange，避免 reload 仍由旧 SW 控制
     */
    async function activateWaitingWorker(reg, timeoutMs) {
        if (!reg) {
            return false;
        }
        const waiting = reg.waiting;
        if (!waiting) {
            return false;
        }
        const timeout = typeof timeoutMs === 'number' ? timeoutMs : 8000;
        await new Promise(function (resolve) {
            let done = false;
            function finish() {
                if (done) {
                    return;
                }
                done = true;
                try {
                    navigator.serviceWorker.removeEventListener('controllerchange', onChange);
                } catch (_) {}
                resolve();
            }
            function onChange() {
                finish();
            }
            navigator.serviceWorker.addEventListener('controllerchange', onChange);
            try {
                waiting.postMessage({ what: 'skipWaiting' });
            } catch (_) {
                finish();
                return;
            }
            setTimeout(finish, timeout);
        });
        return true;
    }

    async function registerSw() {
        // publishVersion 随 Bundle/配置变；runtimeVersion 仅脚本变。用前者避免旧 sw.js 粘住 knownBundles
        const bust = getPublishVersion() || getRuntimeVersion();
        const scopePath = R().resolveBaseRoute();
        const scopeHref = new URL(scopePath, location.origin).href;
        let swUrl = scopePath + 'sw.js?v=' + encodeURIComponent(bust);
        // debug 只看页面 ?bzdebug=1，不要写进 sw.js URL（否则关掉后仍会粘在 SW location 上）

        // 换部署路径后同 origin 可能残留多个 sw.js；只保留当前 scope
        const cleanup = await unregisterStaleServiceWorkers(scopeHref);
        if (cleanup.unregistered) {
            log().info('stale SW cleaned', cleanup.unregistered);
        }

        const reg = await withTimeout(
            navigator.serviceWorker.register(swUrl, {
                scope: scopePath,
            }),
            15000,
            'serviceWorker.register',
        );
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
        // 更新安装完成后可能停在 waiting：主动激活
        try {
            await activateWaitingWorker(reg, 5000);
        } catch (_) {}
        if (!navigator.serviceWorker.controller && reg.active) {
            log().info('SW registered, waiting for controller on next navigation');
        }

        // 若刚注销的是正在控制页面的旧 scope SW，需要 reload 一次让当前 SW 接管
        // 熔断用 URL ?_bzsw=1，避免 sessionStorage 不可用时死循环
        if (cleanup.needReload) {
            let urlObj = null;
            try {
                urlObj = new URL(location.href);
            } catch (_) {}
            if (urlObj && urlObj.searchParams.get('_bzsw') === '1') {
                try {
                    urlObj.searchParams.delete('_bzsw');
                    history.replaceState(null, '', urlObj.href);
                } catch (_) {}
                log().warn('SW scope reload already attempted; continue without second reload');
            } else {
                log().info('reloading to activate current SW scope', scopeHref);
                try {
                    if (urlObj) {
                        urlObj.searchParams.set('_bzsw', '1');
                        location.replace(urlObj.href);
                    } else {
                        location.reload();
                    }
                } catch (_) {
                    location.reload();
                }
                return null;
            }
        } else {
            try {
                const u = new URL(location.href);
                if (u.searchParams.has('_bzsw')) {
                    u.searchParams.delete('_bzsw');
                    history.replaceState(null, '', u.href);
                }
            } catch (_) {}
        }

        log().info('SW active scope=', reg.scope);
        return reg;
    }

    function askSwKnownBundlesFp(timeoutMs) {
        timeoutMs = timeoutMs || 3000;
        return new Promise(function (resolve) {
            if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
                resolve('');
                return;
            }
            const id = 'bz-fp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            let done = false;
            function finish(fp) {
                if (done) {
                    return;
                }
                done = true;
                try {
                    navigator.serviceWorker.removeEventListener('message', onMsg);
                } catch (_) {}
                resolve(fp || '');
            }
            function onMsg(event) {
                const data = event.data || {};
                if (data.what === 'knownBundles' && data.id === id) {
                    finish(data.fp || '');
                }
            }
            navigator.serviceWorker.addEventListener('message', onMsg);
            try {
                navigator.serviceWorker.controller.postMessage({ what: 'getKnownBundles', id: id });
            } catch (_) {
                finish('');
                return;
            }
            setTimeout(function () {
                finish('');
            }, timeoutMs);
        });
    }

    /** 绕过缓存拉最新 sw.js，解析其中 knownBundles 指纹 */
    async function fetchDeployedBundlesFp() {
        try {
            const scopePath = R().resolveBaseRoute ? R().resolveBaseRoute() : './';
            const swUrl = scopePath + 'sw.js?_bzfp=' + Date.now();
            const resp = await fetchWithTimeout(swUrl, { cache: 'no-store' }, 4000);
            if (!resp || !resp.ok) {
                return '';
            }
            const text = await resp.text();
            const m = text.match(/knownBundles:\s*(\{[\s\S]*?\})\s*,\s*initBundles:/);
            if (!m) {
                return '';
            }
            const bundles = JSON.parse(m[1]);
            return R().fingerprintBundles ? R().fingerprintBundles(bundles) : '';
        } catch (err) {
            log().debug && log().debug('fetchDeployedBundlesFp failed', err);
            return '';
        }
    }

    /**
     * 重新部署后若浏览器缓存了旧 index.html，页面 allBundles 会与新 sw.js 不一致，
     * 进而去拉已下线的 {bundle}.{oldMd5}.zip → 404。检测到则强制绕过缓存刷新一次。
     * 熔断用 URL ?_bzts=（不依赖 sessionStorage，兼容无痕/WebView）。
     */
    async function reloadIfPageSwBundlesMismatch() {
        const pageFp = R().fingerprintBundles ? R().fingerprintBundles(getAllBundles()) : '';
        if (!pageFp) {
            return false;
        }
        let deployFp = await fetchDeployedBundlesFp();
        if (!deployFp) {
            deployFp = await askSwKnownBundlesFp();
        }
        if (!deployFp || deployFp === pageFp) {
            return false;
        }
        let urlObj;
        try {
            urlObj = new URL(location.href);
        } catch (_) {
            return false;
        }
        if (urlObj.searchParams.has('_bzts')) {
            log().error(
                'page/deploy allBundles mismatch after reload; check deploy. pageFp=',
                pageFp,
                'deployFp=',
                deployFp,
            );
            return false;
        }
        log().warn(
            'stale index.html suspected (allBundles != deployed sw.js), reloading. pageFp=',
            pageFp,
            'deployFp=',
            deployFp,
        );
        try {
            urlObj.searchParams.set('_bzts', String(Date.now()));
            location.replace(urlObj.href);
        } catch (_) {
            location.reload();
        }
        return true;
    }

    function installSwDebugLogBridge() {
        if (!('serviceWorker' in navigator) || global.__bundleZipperSwDebugBridge) {
            return;
        }
        global.__bundleZipperSwDebugBridge = true;
        navigator.serviceWorker.addEventListener('message', function (event) {
            const data = event.data || {};
            if (data.what !== 'bzDebugLog' || !data.args) {
                return;
            }
            if (!/[?&]bzdebug=1(?:&|$)/.test(location.search || '')) {
                return;
            }
            try {
                console.log.apply(console, ['[BundleZipper][debug]'].concat(data.args));
            } catch (_) {}
        });
    }

    function syncNetworkInterceptMode(preferSw) {
        const spill = !!(S() && S().hasSessionSpill && S().hasSessionSpill());
        // memory 持久层与 SW 进程隔离：绝不能 defer 给 SW
        const memoryStore = !!(S() && S().getStorageKind && S().getStorageKind() === 'memory');
        const defer = !!preferSw && !spill && !memoryStore;
        const network = api().Network;
        if (!network) {
            return defer;
        }
        if (defer) {
            network.setDeferToServiceWorker(true);
            log().info('network intercept deferred to SW');
        } else {
            // session spill / memory / 无 controller：必须走页面拦截
            network.install({ deferToServiceWorker: false });
            network.setDeferToServiceWorker(false);
            if (spill) {
                log().info('network intercept forced to page (session spill)');
            } else if (memoryStore) {
                log().info('network intercept forced to page (memory storage)');
            }
        }
        return defer;
    }

    async function startPageMode() {
        log().info('mode: page intercept', 'storage=', S().getStorageKind());
        // 无 SW 时也尽量用线上 sw.js（若存在）或跳过；page 模式主要靠 no-cache meta
        try {
            if (await reloadIfPageSwBundlesMismatch()) {
                return;
            }
        } catch (_) {}
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
            if (await reloadIfPageSwBundlesMismatch()) {
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

    /**
     * 发布版本号刷新：
     * - 构建写入 bz-publish.json（每次部署内容变则 v 变）
     * - 启动时 no-store 拉取远程，比对 v / allBundles / URL ?bzv=
     * - 不一致则 location.replace 到 ?bzv=<新v>（保留其它 query）
     * - CDN 忽略 query 时追加一次 _bzforce 时间戳强刷
     * @returns {Promise<boolean>} true 表示已发起跳转，调用方应停止后续逻辑
     */
    async function ensurePublishVersion() {
        const embedded = getPublishVersion();
        const pageFp = R().fingerprintBundles
            ? R().fingerprintBundles(getAllBundles())
            : '';

        let remoteV = '';
        let remoteFp = '';
        let remoteData = null;
        try {
            const base = R().resolveBaseRoute ? R().resolveBaseRoute() : './';
            const url = base + 'bz-publish.json?_=' + Date.now();
            const resp = await fetchWithTimeout(url, { cache: 'no-store' }, 5000);
            if (resp && resp.ok) {
                remoteData = await resp.json();
                remoteV = remoteData && remoteData.v ? String(remoteData.v) : '';
                if (remoteData && remoteData.allBundles && R().fingerprintBundles) {
                    remoteFp = R().fingerprintBundles(remoteData.allBundles);
                }
            }
        } catch (err) {
            log().warn('fetch bz-publish.json failed', err);
        }

        const targetV = remoteV || embedded;
        if (!targetV) {
            return false;
        }

        let urlObj;
        try {
            urlObj = new URL(location.href);
        } catch (_) {
            return false;
        }
        const urlV = urlObj.searchParams.get('bzv') || '';
        const hasForce = urlObj.searchParams.has('_bzforce');

        const versionMismatch =
            urlV !== targetV ||
            (!!remoteV && !!embedded && remoteV !== embedded) ||
            (!!remoteV && !embedded);
        const bundlesMismatch = !!(remoteFp && pageFp && remoteFp !== pageFp);
        const needRedirect = versionMismatch || bundlesMismatch;
        if (!needRedirect) {
            return false;
        }

        // URL 熔断（不依赖 sessionStorage）：bzv 已对且强刷过仍不一致 → 放弃，避免无限刷新
        if (urlV === targetV && hasForce) {
            log().error(
                'publishVersion still mismatched after forced reload',
                'embedded=',
                embedded,
                'remote=',
                remoteV,
                'url=',
                urlV,
                'pageFp=',
                pageFp,
                'remoteFp=',
                remoteFp,
            );
            return false;
        }

        if (urlV === targetV && !hasForce) {
            urlObj.searchParams.set('bzv', targetV);
            urlObj.searchParams.set('_bzforce', String(Date.now()));
            urlObj.searchParams.delete('_bzts');
            log().warn('publishVersion mismatch persists, force bust with _bzforce', targetV);
            try {
                location.replace(urlObj.href);
            } catch (_) {
                location.reload();
            }
            return true;
        }

        log().info(
            'publishVersion refresh',
            'embedded=',
            embedded || '(none)',
            'remote=',
            remoteV || '(none)',
            'url bzv=',
            urlV || '(none)',
            'bundlesMismatch=',
            bundlesMismatch,
            '→',
            targetV,
        );
        try {
            urlObj.searchParams.set('bzv', targetV);
            urlObj.searchParams.delete('_bzts');
            urlObj.searchParams.delete('_bzforce');
            location.replace(urlObj.href);
        } catch (_) {
            location.reload();
        }
        return true;
    }

    async function start() {
        const ui = getUi();
        if (ui && ui.ensureDom) {
            ui.ensureDom();
        }

        // 启动全程兜底：即使卡在 storage/预装，也不让遮罩在手机上永久盖住
        setTimeout(function () {
            try {
                const u = getUi();
                if (u && u.closeInitBundlesLoading) {
                    u.closeInitBundlesLoading();
                } else if (api().closeInitBundlesLoading) {
                    api().closeInitBundlesLoading();
                }
            } catch (_) {}
        }, 90000);

        installSwDebugLogBridge();

        // 最先做发布版本校验，避免带着旧 index.html 去装已下线的 zip
        try {
            if (await ensurePublishVersion()) {
                return;
            }
        } catch (err) {
            log().warn('ensurePublishVersion failed', err);
        }

        if (!S() || !S().resolvePersistent) {
            log().error('Storage unavailable, boot without bundle cache');
            bootGame('storage unavailable');
            return;
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
            'publishVersion=',
            getPublishVersion(),
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
