/**
 * 页面端：注册 Service Worker、版本管理、无 SW 时页面兜底、延迟启动 Cocos
 *
 * 依赖构建时注入：initBundles, allBundles, runtimeVersion, swVersion, cdnAddress, writeJS, writeJSON, writeImport
 */

const CONTROLLER_TIMEOUT_MS = 30000;
const BOOT_TIMEOUT_MS = 120000;
const SW_MESSAGE_TIMEOUT_MS = 30000;
const RUNTIME_UPDATE_BOOTSTRAP_TIMEOUT_MS = 120000;
const UPDATE_RELOAD_TIMEOUT_MS = 15000;
const LS_RUNTIME_VERSION = 'BundleZipper.runtimeVersion';
const LS_SW_VERSION = 'BundleZipper.swVersion';
const SS_RECOVER_ATTEMPTED = 'BundleZipper.recoverAttempted';

function bzLog() {
    const core = getBundleCacheCore();
    if (core && core.Logger) {
        return core.Logger;
    }
    return {
        info: function () {
            console.info.apply(console, ['[BundleZipper]'].concat(Array.prototype.slice.call(arguments)));
        },
        warn: function () {
            console.warn.apply(console, ['[BundleZipper]'].concat(Array.prototype.slice.call(arguments)));
        },
        error: function () {
            console.error.apply(console, ['[BundleZipper]'].concat(Array.prototype.slice.call(arguments)));
        },
        debug: function () {},
    };
}

function getRuntimeVersion() {
    if (typeof runtimeVersion !== 'undefined' && runtimeVersion) {
        return runtimeVersion;
    }
    return typeof swVersion !== 'undefined' ? swVersion : '';
}

function getRuntimeUI() {
    return typeof BundleZipperRuntimeUI !== 'undefined' ? BundleZipperRuntimeUI : null;
}

function resolveBaseRoute() {
    const pathname = window.location.pathname;
    if (pathname.endsWith('/')) {
        return pathname;
    }
    const lastSlash = pathname.lastIndexOf('/');
    return pathname.substring(0, lastSlash + 1);
}

function normalizeInitBundles(list) {
    if (!list || !list.length) {
        return [];
    }
    const result = [];
    for (let i = 0; i < list.length; i++) {
        const name = String(list[i]).trim();
        if (name && result.indexOf(name) < 0) {
            result.push(name);
        }
    }
    return result;
}

const swPath = resolveBaseRoute() + 'sw.js';
const splashScreen = document.getElementById('splashScreen');
const splashProgressBar = document.getElementById('bundleLoadingProgressBar');
const splashProgressText = document.getElementById('bundleLoadingProgressText');
const initBundleList = normalizeInitBundles(initBundles);

let hasBoot = false;
let pageCacher = null;
let bootTimeoutId = null;
let runtimeVersionSynced = false;
let updateReloadTimeoutId = null;
let abortForRuntimeUpdate = false;
let runtimeUpdateInProgress = false;
let updatePromptInFlight = false;
let updateUserConfirmed = false;
let cachedMetaRuntimeVersion = null;
let cachedMetaBundles = null;
/** 页面兜底模式：注销 SW 或 controller 与 index 不一致时，不再把请求交给旧 SW */
let pageOnlyMode = false;
let swRuntimeOpsEnabled = false;
const swInstallWaiters = {};
const SW_INSTALL_TIMEOUT_MS = 300000;

function getSwScopeUrl() {
    return new URL(resolveBaseRoute(), window.location.origin).href;
}

function normalizeScriptPathname(scriptUrl) {
    if (!scriptUrl) {
        return '';
    }
    try {
        return new URL(scriptUrl, window.location.href).pathname;
    } catch {
        return '';
    }
}

function getRegistrationScriptPath(reg) {
    const worker = (reg && (reg.active || reg.waiting || reg.installing)) || null;
    return worker && worker.scriptURL ? normalizeScriptPathname(worker.scriptURL) : '';
}

function isCurrentBundleZipperRegistration(reg, keepRegisterUrl) {
    if (!reg || !keepRegisterUrl) {
        return false;
    }
    const keepUrl = new URL(keepRegisterUrl, window.location.href);
    return reg.scope === getSwScopeUrl() && getRegistrationScriptPath(reg) === keepUrl.pathname;
}

async function pruneForeignServiceWorkers(keepRegisterUrl) {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistrations) {
        return 0;
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    let removed = 0;
    for (let i = 0; i < registrations.length; i++) {
        const reg = registrations[i];
        if (isCurrentBundleZipperRegistration(reg, keepRegisterUrl)) {
            continue;
        }
        try {
            const ok = await reg.unregister();
            removed++;
            bzLog().info(
                'prune foreign SW',
                'scope=',
                reg.scope,
                'script=',
                getRegistrationScriptPath(reg) || '(unknown)',
                'ok=',
                ok,
            );
        } catch (err) {
            bzLog().warn('prune foreign SW failed', reg.scope, err);
        }
    }
    if (removed > 0) {
        bzLog().info('origin SW prune done', removed, 'removed');
    }
    return removed;
}

async function unregisterAllOriginServiceWorkers() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistrations) {
        return 0;
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    let removed = 0;
    for (let i = 0; i < registrations.length; i++) {
        try {
            const reg = registrations[i];
            const ok = await reg.unregister();
            removed++;
            bzLog().info(
                'unregistered origin SW',
                'scope=',
                reg.scope,
                'script=',
                getRegistrationScriptPath(reg) || '(unknown)',
                'ok=',
                ok,
            );
        } catch (err) {
            bzLog().warn('unregister origin SW failed', registrations[i].scope, err);
        }
    }
    return removed;
}

async function refreshCachedMeta() {
    const core = getBundleCacheCore();
    if (!core || !core.readMetaSnapshot || !window.BundleZipperStorage) {
        return;
    }
    try {
        const storage = await window.BundleZipperStorage.resolveStorage(window);
        const meta = await core.readMetaSnapshot(storage);
        cachedMetaRuntimeVersion =
            meta && (meta.runtimeVersion || meta.swVersion) ? meta.runtimeVersion || meta.swVersion : null;
        cachedMetaBundles = meta && meta.bundles ? meta.bundles : null;
        bzLog().info(
            'meta loaded',
            'storage=',
            storage.kind || window.BundleZipperStorage.getStorageKind(),
            'runtimeVersion=',
            cachedMetaRuntimeVersion || '(none)',
            'bundles=',
            cachedMetaBundles ? Object.keys(cachedMetaBundles).length : 0,
        );
    } catch {
        cachedMetaRuntimeVersion = null;
        cachedMetaBundles = null;
        bzLog().warn('meta load failed');
    }
}

function getBundleVersion(bundleName) {
    return allBundles[bundleName];
}

function getActiveSwController() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) {
        return null;
    }
    return navigator.serviceWorker.controller;
}

async function isControllerAligned() {
    const controller = getActiveSwController();
    if (!controller) {
        return false;
    }
    const indexRv = getRuntimeVersion();
    if (!indexRv) {
        return true;
    }
    const controllerRv = await queryControllerSwVersion(controller);
    if (!controllerRv) {
        return false;
    }
    return controllerRv === indexRv;
}

async function refreshSwRuntimeOpsFlag() {
    if (!canUseServiceWorker() || pageOnlyMode) {
        swRuntimeOpsEnabled = false;
        return false;
    }
    swRuntimeOpsEnabled = await isControllerAligned();
    return swRuntimeOpsEnabled;
}

async function shouldUseSwRuntimeOps() {
    return refreshSwRuntimeOpsFlag();
}

function getBundleCacheCore() {
    if (typeof globalThis !== 'undefined' && globalThis.BundleCacheCore) {
        return globalThis.BundleCacheCore;
    }
    if (typeof window !== 'undefined' && window.BundleCacheCore) {
        return window.BundleCacheCore;
    }
    return null;
}

function deserializeError(err) {
    const core = getBundleCacheCore();
    if (core && core.deserializeError) {
        return core.deserializeError(err);
    }
    if (err instanceof Error) {
        return err;
    }
    if (err && typeof err === 'object' && err.message) {
        return new Error(err.message);
    }
    return new Error(String(err));
}

function warnInvalidInitBundles() {
    for (let i = 0; i < initBundleList.length; i++) {
        const name = initBundleList[i];
        if (!allBundles[name]) {
            console.warn('[BundleZipper] initBundle not in allBundles, will use network fallback:', name);
        }
    }
}

function readStoredRuntimeVersion() {
    try {
        return localStorage.getItem(LS_RUNTIME_VERSION) || localStorage.getItem(LS_SW_VERSION);
    } catch {
        return null;
    }
}

function saveRuntimeVersionLocal() {
    const rv = getRuntimeVersion();
    if (!rv || !runtimeVersionSynced) {
        return;
    }
    try {
        localStorage.setItem(LS_RUNTIME_VERSION, rv);
    } catch {
        // private mode
    }
}

/** 更新流程结束时写入 LS，避免 bootstrap 失败导致反复弹更新 */
function forcePersistRuntimeVersion() {
    const rv = getRuntimeVersion();
    if (!rv) {
        return;
    }
    try {
        localStorage.setItem(LS_RUNTIME_VERSION, rv);
    } catch {
        // private mode
    }
}

function markRuntimeVersionSynced() {
    runtimeVersionSynced = true;
    cachedMetaRuntimeVersion = getRuntimeVersion() || cachedMetaRuntimeVersion;
    bzLog().info('runtimeVersion synced', getRuntimeVersion());
    saveRuntimeVersionLocal();
}

function isRuntimeVersionChanged() {
    const rv = getRuntimeVersion();
    if (!rv) {
        return false;
    }
    const stored = readStoredRuntimeVersion();
    if (stored === rv) {
        return false;
    }
    if (cachedMetaRuntimeVersion === rv) {
        return false;
    }
    return true;
}

function readRecoverAttempted() {
    try {
        return sessionStorage.getItem(SS_RECOVER_ATTEMPTED) === '1';
    } catch {
        return false;
    }
}

function markRecoverAttempted() {
    try {
        sessionStorage.setItem(SS_RECOVER_ATTEMPTED, '1');
    } catch {
        // private mode
    }
}

function clearRecoverAttempted() {
    try {
        sessionStorage.removeItem(SS_RECOVER_ATTEMPTED);
    } catch {
        // private mode
    }
}

function getLegacyEngineCachePrefix() {
    const core = getBundleCacheCore();
    return core && core.LEGACY_ENGINE_CACHE_PREFIX
        ? core.LEGACY_ENGINE_CACHE_PREFIX
        : '__bundle_zipper_engine__.';
}

async function purgeLegacyEngineCachesOnPage() {
    const core = getBundleCacheCore();
    if (core && core.purgeLegacyEngineCaches) {
        await core.purgeLegacyEngineCaches();
        return;
    }
    if (!window.caches || !window.caches.keys) {
        return;
    }
    const prefix = getLegacyEngineCachePrefix();
    const keys = await window.caches.keys();
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key.indexOf(prefix) === 0) {
            try {
                await window.caches.delete(key);
                bzLog().info('legacy engine cache purged', key);
            } catch (err) {
                bzLog().warn('legacy engine cache purge failed', key, err);
            }
        }
    }
}

async function fetchSwFileVersion(indexRv) {
    const registerUrl = indexRv ? swPath + '?v=' + encodeURIComponent(indexRv) : swPath;
    try {
        const response = await fetch(registerUrl, { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }
        const text = await response.text();
        const match = text.match(/BUNDLE_ZIPPER_SW_VERSION\s*=\s*"([^"]+)"/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

async function queryControllerSwVersion(controller) {
    if (!controller) {
        return null;
    }
    try {
        const data = await postMessageAndWait(
            controller,
            { what: 'getSwVersion' },
            'swVersion',
            SW_MESSAGE_TIMEOUT_MS,
        );
        return data.version || null;
    } catch {
        return null;
    }
}

async function verifyDeployment() {
    const indexRv = getRuntimeVersion();
    if (!indexRv) {
        return {
            aligned: true,
            indexRv: '',
            controllerRv: null,
            fetchedRv: null,
        };
    }

    const controller = getActiveSwController();
    const fetchedRv = await fetchSwFileVersion(indexRv);
    let controllerRv = null;
    if (controller) {
        controllerRv = await queryControllerSwVersion(controller);
    }

    let aligned = true;
    if (fetchedRv && fetchedRv !== indexRv) {
        aligned = false;
    } else if (controller && controllerRv && controllerRv !== indexRv) {
        aligned = false;
    }

    bzLog().info(
        'deployment verify',
        'index=',
        indexRv,
        'controller=',
        controllerRv || '(none)',
        'fetched=',
        fetchedRv || '(fail)',
        'aligned=',
        aligned,
    );

    return {
        aligned: aligned,
        indexRv: indexRv,
        controllerRv: controllerRv,
        fetchedRv: fetchedRv,
    };
}

async function purgeAllCachesOnly() {
    if (!canUsePageResourceLayer()) {
        return purgeOrphanCachesOnPage(getRuntimeVersion(), allBundles);
    }
    try {
        await ensurePageResourceInterceptors();
        const cacher = getOrCreatePageCacher();
        if (!cacher) {
            return [];
        }
        if (cacher.purgeEverything) {
            await cacher.purgeEverything();
        } else {
            await cacher.purgeAll();
        }
        const controller = swRuntimeOpsEnabled ? getActiveSwController() : null;
        if (controller) {
            try {
                await postMessageAndWait(
                    controller,
                    { what: 'purgeEverything' },
                    'purgeComplete',
                    SW_MESSAGE_TIMEOUT_MS,
                );
            } catch (err) {
                bzLog().warn('sw purgeEverything failed during cache-only purge', err);
            }
        }
        bzLog().info('purgeAllCachesOnly complete');
        return ['purgeEverything'];
    } catch (err) {
        bzLog().warn('purgeAllCachesOnly failed, fallback orphan purge', err);
        return purgeOrphanCachesOnPage(getRuntimeVersion(), allBundles);
    }
}

async function purgeOrphanCachesOnPage(indexRv, bundles) {
    if (!window.caches || !indexRv) {
        return [];
    }

    await purgeLegacyEngineCachesOnPage();

    const core = getBundleCacheCore();
    const purged = [];
    const keys = await window.caches.keys();

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (!core || !core.parseCacheKey) {
            continue;
        }

        const parsed = core.parseCacheKey(key) || core.parseLegacyCacheKey(key);
        if (!parsed) {
            continue;
        }
        if (!bundles[parsed.name] || bundles[parsed.name] !== parsed.version) {
            await window.caches.delete(key);
            purged.push(key);
        }
    }

    return purged;
}

async function fallbackToPageResourceLayer(reason) {
    const ui = getRuntimeUI();
    if (ui && ui.hideRuntimeUpdateOverlay) {
        ui.hideRuntimeUpdateOverlay();
    }
    bzLog().warn('deployment fallback to page resource layer:', reason || '(unknown)');
    clearRecoverAttempted();
    pageOnlyMode = true;
    swRuntimeOpsEnabled = false;
    await purgeAllCachesOnly();
    await unregisterServiceWorkerBeforeFallback();
    await startPageFallback();
}

async function recoverFromMismatch(verifyResult) {
    const indexRv = verifyResult.indexRv;

    if (readRecoverAttempted()) {
        await fallbackToPageResourceLayer('controller still stale after recover reload');
        return true;
    }

    const ui = getRuntimeUI();
    if (ui && ui.showRuntimeUpdateOverlay) {
        ui.showRuntimeUpdateOverlay();
    }

    const purged = await purgeAllCachesOnly();
    if (purged.length) {
        bzLog().info('recover: purged caches', purged.join(', '));
    }

    cachedMetaRuntimeVersion = null;
    cachedMetaBundles = null;

    await unregisterAllOriginServiceWorkers();

    const registerUrl = swPath + '?v=' + encodeURIComponent(indexRv);
    try {
        const registration = await navigator.serviceWorker.register(registerUrl);
        if (registration.update) {
            await registration.update();
        }
    } catch (err) {
        bzLog().warn('recover: register failed', err);
    }

    markRecoverAttempted();
    bzLog().info('recover: reloading for SW realignment');
    window.location.reload();
    return true;
}

async function ensureDeploymentAligned() {
    const result = await verifyDeployment();
    if (result.aligned) {
        clearRecoverAttempted();
        return true;
    }

    const indexRv = result.indexRv;
    const fetchedRv = result.fetchedRv;

    // index 与 CDN 上 sw.js 内嵌版本不一致（半包部署）：reload 无法自愈，直接页面模式
    if (fetchedRv && fetchedRv !== indexRv) {
        const ui = getRuntimeUI();
        if (ui && ui.showRuntimeUpdateOverlay) {
            ui.showRuntimeUpdateOverlay();
        }
        await purgeAllCachesOnly();
        await fallbackToPageResourceLayer(
            'index=' + indexRv + ' sw.js=' + fetchedRv,
        );
        return false;
    }

    // sw.js 已与 index 一致，仅 controller 仍为旧 SW：unregister + reload 一次
    await recoverFromMismatch(result);
    return false;
}

function bootGame(reason) {
    if (hasBoot || abortForRuntimeUpdate || updatePromptInFlight) {
        return;
    }
    hasBoot = true;
    if (bootTimeoutId) {
        clearTimeout(bootTimeoutId);
        bootTimeoutId = null;
    }
    if (reason) {
        bzLog().warn('bootGame:', reason);
    } else {
        bzLog().info('bootGame: starting Cocos engine');
    }
    function resolveEngineUrl(path) {
        return new URL(path, window.location.href).href;
    }

    function appendScript(src) {
        const scriptUrl = resolveEngineUrl(src);
        return new Promise(function (resolve, reject) {
            bzLog().info('engine loading script', scriptUrl);
            const timer = setTimeout(function () {
                reject(new Error('Script load timeout: ' + scriptUrl));
            }, 60000);
            const scriptEl = document.createElement('script');
            scriptEl.charset = 'utf-8';
            scriptEl.type = 'text/javascript';
            scriptEl.src = scriptUrl;
            scriptEl.onload = function () {
                clearTimeout(timer);
                bzLog().info('engine script loaded', scriptUrl);
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
        if (!writeJSON) {
            return Promise.resolve();
        }
        const mapUrl = resolveEngineUrl(writeJSON);
        const importMapEl = document.createElement('script');
        importMapEl.type = 'systemjs-importmap';
        importMapEl.charset = 'utf-8';
        importMapEl.src = mapUrl;
        document.head.appendChild(importMapEl);
        bzLog().info('engine import map registered', mapUrl);
        if (typeof System === 'undefined' || !System.prepareImport) {
            return Promise.reject(new Error('System.prepareImport is not available'));
        }
        return System.prepareImport().then(function () {
            bzLog().info('engine import map ready');
        });
    }

    function runSystemImport() {
        if (!writeImport) {
            bzLog().warn('writeImport is empty, skip engine entry');
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
        bzLog().info('engine System.import', entryUrl);
        return System.import(entryUrl).then(function () {
            bzLog().info('engine entry loaded', entryUrl);
        });
    }

    function loadEngineScripts() {
        const jsFiles = writeJS || [];
        let chain = Promise.resolve();
        chain = chain.then(function () {
            bzLog().info('engine bootstrap start');
        });
        for (let i = 0; i < jsFiles.length; i++) {
            const src = jsFiles[i];
            chain = chain.then(function () {
                return appendScript(src);
            });
        }
        chain = chain
            .then(function () {
                return registerImportMapScript();
            })
            .then(function () {
                return runSystemImport();
            })
            .catch(function (err) {
                bzLog().error('engine script load failed:', err);
                return runSystemImport().catch(function (importErr) {
                    bzLog().error('engine entry import failed:', importErr);
                });
            });
    }

    loadEngineScripts();
}

function scheduleUpdateReload() {
    if (updateReloadTimeoutId) {
        clearTimeout(updateReloadTimeoutId);
    }
    updateReloadTimeoutId = setTimeout(function () {
        updateReloadTimeoutId = null;
        if (!hasBoot) {
            console.warn('[BundleZipper] update reload timeout, forcing reload');
            window.location.reload();
        }
    }, UPDATE_RELOAD_TIMEOUT_MS);
}

function scheduleBootTimeout() {
    if (bootTimeoutId || hasBoot) {
        return;
    }
    bootTimeoutId = setTimeout(function () {
        bootGame('init bundle timeout (' + BOOT_TIMEOUT_MS + 'ms), network fallback');
    }, BOOT_TIMEOUT_MS);
}

function cancelBootTimeout() {
    if (bootTimeoutId) {
        clearTimeout(bootTimeoutId);
        bootTimeoutId = null;
    }
}

function showSplashLoading() {
    if (splashScreen) {
        splashScreen.style.display = 'flex';
    }
    updateProgress(0, initBundleList.length || 1);
}

function hideSplashLoading() {
    if (splashScreen) {
        splashScreen.style.display = 'none';
    }
}

function updateProgress(loaded, total) {
    const percent = total > 0 ? (100 * loaded) / total : 0;
    const clamped = Math.max(0, Math.min(100, percent));
    const percentText = clamped.toFixed(0) + '%';
    if (splashProgressBar) {
        splashProgressBar.style.width = clamped.toFixed(2) + '%';
    }
    if (splashProgressText) {
        splashProgressText.textContent = 'Loading ' + percentText;
    }
}

function bindTrackerToPageCacher(tracker) {
    const cacher = getOrCreatePageCacher();
    if (!cacher || !tracker) {
        return;
    }
    cacher.setProgressListener(tracker.onProgress);
    cacher.setErrorListener(tracker.onError);
    cacher.setPurgeListener(tracker.onPurgeComplete);
}

function canUseServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return false;
    }
    if (window.location.protocol === 'file:') {
        return false;
    }
    if (!window.isSecureContext) {
        return false;
    }
    try {
        if (!navigator.serviceWorker.register) {
            return false;
        }
    } catch {
        return false;
    }
    return true;
}

function canUsePageFallback() {
    return !!(
        window.fflate &&
        window.BundleCacheCore &&
        window.BundleZipperPage &&
        window.BundleZipperStorage
    );
}

function canUsePageResourceLayer() {
    return canUsePageFallback();
}

function getOrCreatePageCacher() {
    if (!canUsePageResourceLayer()) {
        return null;
    }
    if (!pageCacher) {
        pageCacher = window.BundleZipperPage.create(cdnAddress || '', getRuntimeVersion(), allBundles);
    }
    return pageCacher;
}

function installBundleViaPage(bundle, version) {
    const cacher = getOrCreatePageCacher();
    if (!cacher) {
        return Promise.reject(new Error('Page resource layer unavailable'));
    }
    return cacher.installBundle(bundle, version);
}

async function ensurePageResourceInterceptors() {
    const cacher = getOrCreatePageCacher();
    if (!cacher) {
        return false;
    }
    try {
        const deferToServiceWorker = await refreshSwRuntimeOpsFlag();
        await cacher.prepare(allBundles, { deferToServiceWorker: deferToServiceWorker });
        bzLog().info(
            'page resource interceptors ready',
            'storage=',
            cacher.getStorageKind ? cacher.getStorageKind() : window.BundleZipperStorage.getStorageKind(),
            deferToServiceWorker ? 'network=sw-only' : 'network=page-intercept',
        );
        return true;
    } catch (err) {
        bzLog().warn('page resource interceptors unavailable:', err);
        return false;
    }
}

async function runPageResourceBootstrap() {
    const cacher = getOrCreatePageCacher();
    if (!cacher) {
        throw new Error('Page resource layer unavailable');
    }
    await cacher.bootstrap(allBundles, {
        runtimeVersion: getRuntimeVersion(),
    });
    markRuntimeVersionSynced();
    cachedMetaBundles = Object.assign({}, allBundles);
    return cacher;
}

function settleSwInstallWaiter(installId, error) {
    const waiter = swInstallWaiters[installId];
    if (!waiter) {
        return;
    }
    clearTimeout(waiter.timer);
    delete swInstallWaiters[installId];
    if (error) {
        waiter.reject(error);
    } else {
        waiter.resolve();
    }
}

function waitForSwInstall(installId) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(function () {
            settleSwInstallWaiter(installId, new Error('installBundle timeout: ' + installId));
        }, SW_INSTALL_TIMEOUT_MS);
        swInstallWaiters[installId] = { resolve, reject, timer };
    });
}

function createInstallId() {
    return 'bz_inst_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

function createWaitForController(registration, options) {
    options = options || {};
    const waitForNewController = !!options.waitForNewController;

    if (!waitForNewController && navigator.serviceWorker.controller) {
        return {
            promise: Promise.resolve(navigator.serviceWorker.controller),
            cleanup: function () {},
        };
    }

    let cleanup = function () {};
    const promise = new Promise((resolve) => {
        let settled = false;
        const cleanups = [];

        function doCleanup() {
            for (let i = 0; i < cleanups.length; i++) {
                cleanups[i]();
            }
        }
        cleanup = doCleanup;

        function finish() {
            if (settled) {
                return;
            }
            const controller = navigator.serviceWorker.controller;
            if (controller) {
                settled = true;
                doCleanup();
                resolve(controller);
            }
        }

        const onControllerChange = function () {
            finish();
        };
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
        cleanups.push(function () {
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        });

        if (!waitForNewController) {
            const worker = registration.installing || registration.waiting || registration.active;
            if (worker) {
                if (worker.state === 'activated') {
                    finish();
                } else {
                    const onWorkerChange = function () {
                        if (worker.state === 'activated') {
                            finish();
                        }
                    };
                    worker.addEventListener('statechange', onWorkerChange);
                    cleanups.push(function () {
                        worker.removeEventListener('statechange', onWorkerChange);
                    });
                }
            }
        }
    });

    return {
        promise: promise,
        cleanup: function () {
            cleanup();
        },
    };
}

function waitForController(registration, options) {
    const waiter = createWaitForController(registration, options);
    return Promise.race([
        waiter.promise,
        new Promise((_, reject) => {
            setTimeout(function () {
                waiter.cleanup();
                reject(new Error('Service Worker controller timeout'));
            }, CONTROLLER_TIMEOUT_MS);
        }),
    ]);
}

function postMessageAndWait(controller, message, expectWhat, timeoutMs) {
    const msgId = 'bz_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
        let timer = setTimeout(function () {
            cleanup();
            reject(new Error('SW message timeout: ' + message.what));
        }, timeoutMs || SW_MESSAGE_TIMEOUT_MS);

        function onMessage(event) {
            const data = event.data || {};
            if (data.id === msgId && data.what === expectWhat) {
                cleanup();
                resolve(data);
            }
        }

        function cleanup() {
            clearTimeout(timer);
            navigator.serviceWorker.removeEventListener('message', onMessage);
        }

        navigator.serviceWorker.addEventListener('message', onMessage);
        controller.postMessage(Object.assign({ id: msgId }, message));
    });
}

function classifyPendingUpdate() {
    const rv = getRuntimeVersion();
    const storedRv = readStoredRuntimeVersion();
    const metaRv = cachedMetaRuntimeVersion;
    const metaBundles = cachedMetaBundles || {};

    const runtimeChanged = !!(storedRv && storedRv !== rv) || !!(metaRv && metaRv !== rv);

    const changedBundles = [];
    for (const name in allBundles) {
        if (!Object.prototype.hasOwnProperty.call(allBundles, name)) {
            continue;
        }
        if (!metaBundles[name] || metaBundles[name] !== allBundles[name]) {
            changedBundles.push(name);
        }
    }

    const removed = [];
    for (const name in metaBundles) {
        if (!Object.prototype.hasOwnProperty.call(metaBundles, name)) {
            continue;
        }
        if (!Object.prototype.hasOwnProperty.call(allBundles, name)) {
            removed.push(name);
        }
    }

    const hasPriorState = !!(storedRv || metaRv || Object.keys(metaBundles).length > 0);
    const bundleChanged = hasPriorState && (changedBundles.length > 0 || removed.length > 0);

    const changedInit = [];
    const changedNonInit = [];
    for (let i = 0; i < changedBundles.length; i++) {
        const name = changedBundles[i];
        if (initBundleList.indexOf(name) >= 0) {
            changedInit.push(name);
        } else {
            changedNonInit.push(name);
        }
    }

    return {
        needsUpdate: runtimeChanged || bundleChanged,
        runtimeChanged: runtimeChanged,
        changedBundles: changedBundles,
        changedInit: changedInit,
        changedNonInit: changedNonInit,
        removed: removed,
    };
}

async function handleUpdatePrompt() {
    if (updateUserConfirmed) {
        return classifyPendingUpdate().needsUpdate ? 'reload' : 'continue';
    }
    if (updatePromptInFlight || runtimeUpdateInProgress || abortForRuntimeUpdate) {
        return 'continue';
    }
    const pending = classifyPendingUpdate();
    if (!pending.needsUpdate) {
        return 'continue';
    }
    updatePromptInFlight = true;
    try {
        cancelBootTimeout();
        const ui = getRuntimeUI();
        if (ui && ui.showRuntimeUpdateModal) {
            ui.ensureDom();
            await ui.showRuntimeUpdateModal();
        }
        updateUserConfirmed = true;
        return 'reload';
    } finally {
        updatePromptInFlight = false;
    }
}

function clearStoredRuntimeVersion() {
    try {
        localStorage.removeItem(LS_RUNTIME_VERSION);
        localStorage.removeItem(LS_SW_VERSION);
    } catch {
        // private mode
    }
    runtimeVersionSynced = false;
    cachedMetaRuntimeVersion = null;
    cachedMetaBundles = {};
}

async function purgeEverythingUnified() {
    clearStoredRuntimeVersion();
    await ensurePageResourceInterceptors();
    const cacher = getOrCreatePageCacher();
    if (!cacher) {
        throw new Error('Page resource layer unavailable');
    }
    if (cacher.purgeEverything) {
        await cacher.purgeEverything();
    } else {
        await cacher.purgeAll();
    }
    const controller = swRuntimeOpsEnabled ? getActiveSwController() : null;
    if (controller) {
        try {
            await postMessageAndWait(
                controller,
                { what: 'purgeEverything' },
                'purgeComplete',
                SW_MESSAGE_TIMEOUT_MS,
            );
        } catch (err) {
            bzLog().warn('sw purgeEverything failed, page purge already done', err);
        }
    }
    bzLog().info('purgeEverything complete');
}

async function purgeBundleUnified(name) {
    await ensurePageResourceInterceptors();
    setupUnifiedBundleApi();
    if (typeof window.cleanBundle === 'function') {
        await window.cleanBundle(name);
    }
}

async function writeMetaUnified(controller) {
    const rv = getRuntimeVersion();
    if (controller && swRuntimeOpsEnabled) {
        await runMergeBootstrap(controller, SW_MESSAGE_TIMEOUT_MS);
    } else {
        const cacher = getOrCreatePageCacher();
        if (!cacher) {
            throw new Error('Page resource layer unavailable');
        }
        await cacher.bootstrap(allBundles, { runtimeVersion: rv });
    }
    cachedMetaRuntimeVersion = rv;
    cachedMetaBundles = Object.assign({}, allBundles);
}

async function installInitBundles(tracker) {
    if (!initBundleList.length) {
        updateProgress(1, 1);
        return { failed: [] };
    }

    setupUnifiedBundleApi();
    if (tracker && tracker.syncInitBundleProgress) {
        tracker.syncInitBundleProgress();
    } else {
        updateProgress(0, initBundleList.length);
    }
    for (let i = 0; i < initBundleList.length; i++) {
        const name = initBundleList[i];
        try {
            await window.installBundle(name);
        } catch (err) {
            tracker.markFailed(name, err);
            bzLog().warn('init bundle install failed:', name, err);
        }
    }
    return { failed: tracker.getFailedInitBundles() };
}

async function bootAfterInitBundles(tracker) {
    const result = await installInitBundles(tracker);
    if (result.failed.length) {
        bzLog().warn('init bundles failed, boot with network fallback:', result.failed.join(', '));
    }
    bootGame();
}

async function runMergeBootstrap(controller, timeoutMs) {
    const rv = getRuntimeVersion();
    await postMessageAndWait(
        controller,
        {
            what: 'bootstrap',
            runtimeVersion: rv,
            swVersion: rv,
            bundles: allBundles,
        },
        'bootstrapComplete',
        timeoutMs,
    );
    cachedMetaRuntimeVersion = rv;
    cachedMetaBundles = Object.assign({}, allBundles);
    bzLog().info('mergeBootstrap complete');
}

async function performUnifiedUpdateSteps(pending, registration, worker, ui) {
    bzLog().info('unified update v3 started', pending);

    if (pending.runtimeChanged) {
        if (canUseServiceWorker() && registration) {
            let waitingWorker =
                worker ||
                (registration.waiting || registration.installing);
            if (!waitingWorker && registration.update) {
                try {
                    await registration.update();
                } catch (err) {
                    bzLog().warn('registration.update failed during runtime update', err);
                }
                waitingWorker = registration.waiting || registration.installing;
            }

            const hadController = !!getActiveSwController();
            const alreadyAligned = hadController && (await isControllerAligned());

            if (hadController && !alreadyAligned) {
                const controllerWaiter = createWaitForController(registration, {
                    waitForNewController: true,
                });
                if (waitingWorker && waitingWorker.postMessage) {
                    waitingWorker.postMessage({ what: 'skipWaiting' });
                }
                await Promise.race([
                    controllerWaiter.promise,
                    new Promise(function (_, reject) {
                        setTimeout(function () {
                            controllerWaiter.cleanup();
                            reject(new Error('Service Worker controller timeout'));
                        }, CONTROLLER_TIMEOUT_MS);
                    }),
                ]);
            } else {
                if (waitingWorker && waitingWorker.postMessage) {
                    waitingWorker.postMessage({ what: 'skipWaiting' });
                }
                if (!hadController) {
                    await waitForController(registration);
                } else if (alreadyAligned) {
                    bzLog().info('runtime update: controller already aligned, skip controller wait');
                }
            }
        }
    }

    setupUnifiedBundleApi();
    await ensurePageResourceInterceptors();

    if (ui && ui.setRuntimeUpdateProgress) {
        ui.setRuntimeUpdateProgress(5);
    }

    await purgeEverythingUnified();

    if (ui && ui.setRuntimeUpdateProgress) {
        ui.setRuntimeUpdateProgress(10);
    }

    if (pending.runtimeChanged && (await shouldUseSwRuntimeOps())) {
        const controller = getActiveSwController();
        if (!controller) {
            throw new Error('Service Worker controller unavailable');
        }
        await runMergeBootstrap(controller, RUNTIME_UPDATE_BOOTSTRAP_TIMEOUT_MS);
        if (ui && ui.setRuntimeUpdateProgress) {
            ui.setRuntimeUpdateProgress(30);
        }
    }

    const initNames = initBundleList.slice();
    for (let i = 0; i < initNames.length; i++) {
        const name = initNames[i];
        const version = getBundleVersion(name);
        if (!version) {
            throw new Error('init bundle not in allBundles: ' + name);
        }
        try {
            await window.installBundle(name);
        } catch (err) {
            const detail = err && err.message ? err.message : String(err);
            throw new Error('Failed to install bundle "' + name + '": ' + detail);
        }
        if (ui && ui.setRuntimeUpdateProgress) {
            const pct = 30 + Math.round(((i + 1) / Math.max(initNames.length, 1)) * 65);
            ui.setRuntimeUpdateProgress(pct);
        }
    }

    const controller = getActiveSwController();
    const rv = getRuntimeVersion();
    if (pending.runtimeChanged && controller && swRuntimeOpsEnabled) {
        cachedMetaRuntimeVersion = rv;
        cachedMetaBundles = Object.assign({}, allBundles);
    } else {
        await writeMetaUnified(controller);
    }
    markRuntimeVersionSynced();
    if (ui && ui.setRuntimeUpdateProgress) {
        ui.setRuntimeUpdateProgress(100);
    }
    bzLog().info('unified update complete');
}

function formatUnifiedUpdateError(err) {
    if (!err) {
        return 'Update failed. Please try again.';
    }
    if (err.message) {
        return err.message;
    }
    return String(err);
}

async function executeUnifiedUpdate(pending, registration, worker, tracker) {
    if (runtimeUpdateInProgress) {
        bzLog().warn('unified update already in progress, skip duplicate');
        return;
    }
    runtimeUpdateInProgress = true;
    abortForRuntimeUpdate = true;
    cancelBootTimeout();
    const lockedPending =
        pending && pending.needsUpdate ? pending : classifyPendingUpdate();
    if (!lockedPending.needsUpdate) {
        runtimeUpdateInProgress = false;
        abortForRuntimeUpdate = false;
        return;
    }

    for (;;) {
        const ui = getRuntimeUI();
        bzLog().info('unified update started', lockedPending);

        if (ui && ui.showRuntimeUpdateOverlay) {
            ui.showRuntimeUpdateOverlay();
        } else if (ui && ui.resetRuntimeUpdateOverlay) {
            ui.resetRuntimeUpdateOverlay();
        }

        try {
            await performUnifiedUpdateSteps(lockedPending, registration, worker, ui);
            runtimeUpdateInProgress = false;
            if (ui && ui.hideRuntimeUpdateOverlay) {
                ui.hideRuntimeUpdateOverlay();
            }
            bzLog().info('unified update reloading');
            window.location.reload();
            return;
        } catch (err) {
            bzLog().error('unified update failed:', err);
            if (!ui || !ui.showRuntimeUpdateError) {
                if (ui && ui.setRuntimeUpdateStatus) {
                    ui.setRuntimeUpdateStatus(formatUnifiedUpdateError(err));
                }
                runtimeUpdateInProgress = false;
                abortForRuntimeUpdate = false;
                return;
            }
            await ui.showRuntimeUpdateError(formatUnifiedUpdateError(err));
            bzLog().info('unified update retry requested');
        }
    }
}

function setupUnifiedBundleApi() {
    window.installBundle = function (bundle) {
        const version = getBundleVersion(bundle);
        if (!version) {
            console.warn('[BundleZipper] installBundle: unknown bundle', bundle);
            return Promise.reject(new Error('unknown bundle: ' + bundle));
        }
        const controller = swRuntimeOpsEnabled ? getActiveSwController() : null;
        if (controller) {
            const installId = createInstallId();
            const pending = waitForSwInstall(installId);
            controller.postMessage({
                what: 'installBundle',
                bundle: bundle,
                version: version,
                id: installId,
            });
            return pending.catch(function (err) {
                bzLog().warn('sw installBundle failed, page fallback', bundle, err);
                return installBundleViaPage(bundle, version);
            });
        }
        return installBundleViaPage(bundle, version);
    };

    window.cleanBundle = function (bundle) {
        const controller = swRuntimeOpsEnabled ? getActiveSwController() : null;
        if (controller) {
            controller.postMessage({
                what: 'purgeBundle',
                bundle: bundle,
            });
            return Promise.resolve();
        }
        const cacher = getOrCreatePageCacher();
        if (!cacher) {
            return Promise.reject(new Error('Page resource layer unavailable'));
        }
        return cacher.purgeBundle(bundle);
    };

    window.cleanAllBundles = function () {
        return purgeEverythingUnified();
    };
}

function setupSwApi() {
    setupUnifiedBundleApi();
}

function setupPageApi(cacher) {
    pageCacher = cacher || pageCacher;
    setupUnifiedBundleApi();
}

function createBundleProgressTracker() {
    const bundleProgress = {};
    const bundleFailed = {};

    function getFailedInitBundles() {
        const failed = [];
        for (let i = 0; i < initBundleList.length; i++) {
            if (bundleFailed[initBundleList[i]]) {
                failed.push(initBundleList[i]);
            }
        }
        return failed;
    }

    function syncInitBundleProgress() {
        if (!initBundleList.length) {
            return;
        }

        let loaded = 0;
        for (let i = 0; i < initBundleList.length; i++) {
            const name = initBundleList[i];
            if (bundleFailed[name]) {
                loaded += 1;
            } else {
                loaded += Math.min(1, Math.max(0, bundleProgress[name] || 0));
            }
        }
        updateProgress(loaded, initBundleList.length);
    }

    function onProgress(bundle, percent) {
        bundleProgress[bundle] = percent;
        if (window.onBundleInstallProgress) {
            window.onBundleInstallProgress(bundle, percent);
        }
        if (initBundleList.indexOf(bundle) >= 0) {
            syncInitBundleProgress();
        }
    }

    function onError(bundle, error) {
        if (window.onBundleInstallError) {
            window.onBundleInstallError(bundle, error);
        }
        if (initBundleList.indexOf(bundle) >= 0) {
            bundleFailed[bundle] = true;
            bundleProgress[bundle] = 0;
            console.warn('[BundleZipper] init bundle install failed:', bundle, error);
            syncInitBundleProgress();
        }
    }

    function onPurgeComplete() {
        if (window.onBundlesCleanFinish) {
            window.onBundlesCleanFinish();
        }
    }

    function markFailed(bundle, error) {
        bundleFailed[bundle] = true;
        if (window.onBundleInstallError) {
            window.onBundleInstallError(bundle, error || new Error('bundle install failed'));
        }
        syncInitBundleProgress();
    }

    return {
        onProgress,
        onError,
        onPurgeComplete,
        markFailed,
        getFailedInitBundles,
        syncInitBundleProgress,
    };
}

async function unregisterServiceWorkerBeforeFallback() {
    try {
        await unregisterAllOriginServiceWorkers();
    } catch (err) {
        bzLog().warn('SW unregister failed:', err);
    }
}

async function fallbackFromSwError(error) {
    bzLog().error('sw register error, fallback to page:', error);
    pageOnlyMode = true;
    swRuntimeOpsEnabled = false;
    try {
        await purgeAllCachesOnly();
    } catch (err) {
        bzLog().warn('purge before SW fallback failed', err);
    }
    await unregisterServiceWorkerBeforeFallback();
    await startPageFallback();
}

async function startPageResourceMode() {
    if (!canUsePageResourceLayer()) {
        bzLog().warn('page resource layer unavailable, direct boot');
        bootGame('page resource layer unavailable, direct boot');
        return;
    }

    pageOnlyMode = true;
    swRuntimeOpsEnabled = false;
    bzLog().info('mode: page resource layer (no SW)');

    const tracker = createBundleProgressTracker();
    pageCacher = getOrCreatePageCacher();
    bindTrackerToPageCacher(tracker);
    scheduleBootTimeout();

    try {
        const pending = classifyPendingUpdate();
        if (pending.needsUpdate) {
            const updateAction = await handleUpdatePrompt();
            bzLog().info('update prompt (page mode)', updateAction);
            if (updateAction === 'reload') {
                await executeUnifiedUpdate(pending, null, null, tracker);
                if (!abortForRuntimeUpdate) {
                    await pageCacher.prepare(allBundles);
                    setupUnifiedBundleApi();
                    await runPageResourceBootstrap();
                    await bootAfterInitBundles(tracker);
                }
                return;
            }
        }

        await pageCacher.prepare(allBundles);
        setupUnifiedBundleApi();
        await runPageResourceBootstrap();
        await bootAfterInitBundles(tracker);
    } catch (error) {
        console.error('[BundleZipper] page resource error:', error);
        bootGame('page resource error: ' + error);
    }
}

async function startPageFallback() {
    await startPageResourceMode();
}

async function resumeServiceWorkerBoot(tracker) {
    setupSwApi();
    await ensurePageResourceInterceptors();
    bindTrackerToPageCacher(tracker);

    if (!(await shouldUseSwRuntimeOps())) {
        bzLog().warn('SW controller not aligned with index, fallback to page resource layer');
        await startPageFallback();
        return;
    }

    const controller = getActiveSwController();
    if (!controller) {
        throw new Error('Service Worker controller unavailable');
    }
    await runMergeBootstrap(controller, SW_MESSAGE_TIMEOUT_MS);
    markRuntimeVersionSynced();
    await bootAfterInitBundles(tracker);
}

async function startServiceWorker() {
    pageOnlyMode = false;
    bzLog().info('mode: service worker', 'runtimeVersion=', getRuntimeVersion());
    const hadControllerOnStart = !!navigator.serviceWorker.controller;
    const tracker = createBundleProgressTracker();
    scheduleBootTimeout();

    navigator.serviceWorker.addEventListener('message', function (event) {
        const data = event.data || {};
        if (data.what === 'installProgress') {
            tracker.onProgress(data.bundle, data.percent);
            if (data.percent >= 1 && data.id) {
                bzLog().info('installBundle done (sw msg)', data.bundle);
                settleSwInstallWaiter(data.id, null);
            } else if (data.percent === 0.5) {
                bzLog().debug('installBundle unzip (sw msg)', data.bundle);
            }
        } else if (data.what === 'installError') {
            const error = deserializeError(data.error);
            tracker.onError(data.bundle, error);
            if (data.id) {
                settleSwInstallWaiter(data.id, error);
            }
        } else if (data.what === 'purgeComplete') {
            tracker.onPurgeComplete();
        } else if (data.what === 'bootstrapComplete' || data.what === 'swVersionSynced') {
            if (!runtimeUpdateInProgress) {
                markRuntimeVersionSynced();
            }
        }
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (runtimeUpdateInProgress) {
            return;
        }
        if (!hadControllerOnStart) {
            return;
        }
        if (reloading) {
            return;
        }
        if (!isRuntimeVersionChanged()) {
            return;
        }
        reloading = true;
        bzLog().info('controllerchange reload');
        if (updateReloadTimeoutId) {
            clearTimeout(updateReloadTimeoutId);
            updateReloadTimeoutId = null;
        }
        markRuntimeVersionSynced();
        window.location.reload();
    });

    const rv = getRuntimeVersion();
    const registerUrl = rv ? swPath + '?v=' + encodeURIComponent(rv) : swPath;

    try {
        await pruneForeignServiceWorkers(registerUrl);
        const registration = await navigator.serviceWorker.register(registerUrl);
        bzLog().info('sw registered', registerUrl);

        const pendingOnRegister = classifyPendingUpdate();
        if (pendingOnRegister.needsUpdate && navigator.serviceWorker.controller) {
            const updateAction = await handleUpdatePrompt();
            bzLog().info('update prompt (register)', updateAction, pendingOnRegister);
            if (updateAction === 'reload') {
                await executeUnifiedUpdate(
                    pendingOnRegister,
                    registration,
                    registration.waiting,
                    tracker,
                );
                if (!abortForRuntimeUpdate) {
                    await resumeServiceWorkerBoot(tracker);
                }
                return;
            }
        }

        registration.addEventListener('updatefound', function () {
            const worker = registration.installing;
            if (!worker) {
                return;
            }
            worker.addEventListener('statechange', function () {
                if (worker.state !== 'installed' || !navigator.serviceWorker.controller) {
                    return;
                }
                const pending = classifyPendingUpdate();
                if (!pending.needsUpdate) {
                    return;
                }
                handleUpdatePrompt().then(function (updateAction) {
                    bzLog().info('update prompt (installed)', updateAction, pending);
                    if (updateAction === 'reload') {
                        executeUnifiedUpdate(
                            pending,
                            registration,
                            registration.waiting || worker,
                            tracker,
                        ).then(function () {
                            if (!abortForRuntimeUpdate) {
                                resumeServiceWorkerBoot(tracker).catch(function (err) {
                                    bzLog().error('resume boot after update failed:', err);
                                    fallbackFromSwError(err);
                                });
                            }
                        }).catch(function (err) {
                            bzLog().error('unified update failed (updatefound):', err);
                        });
                    }
                });
            });
        });

        await waitForController(registration);
        if (abortForRuntimeUpdate) {
            return;
        }

        const pendingAfterController = classifyPendingUpdate();
        if (pendingAfterController.needsUpdate) {
            const updateAction = await handleUpdatePrompt();
            bzLog().info('update prompt (after controller)', updateAction, pendingAfterController);
            if (updateAction === 'reload') {
                await executeUnifiedUpdate(
                    pendingAfterController,
                    registration,
                    registration.waiting,
                    tracker,
                );
                if (!abortForRuntimeUpdate) {
                    await resumeServiceWorkerBoot(tracker);
                }
                return;
            }
        }

        await resumeServiceWorkerBoot(tracker);
    } catch (error) {
        await fallbackFromSwError(error);
    }
}

async function start() {
    const ui = getRuntimeUI();
    if (ui && ui.ensureDom) {
        ui.ensureDom();
    }

    bzLog().info(
        'startup',
        'runtimeVersion=',
        getRuntimeVersion(),
        'initBundles=',
        initBundleList.join(',') || '(empty)',
        'cdn=',
        typeof cdnAddress !== 'undefined' ? cdnAddress || '(same origin)' : '(same origin)',
    );
    warnInvalidInitBundles();
    await refreshCachedMeta();

    showSplashLoading();

    if (!initBundleList.length) {
        console.warn('[BundleZipper] initBundles is empty, booting directly');
    }

    if (!canUseServiceWorker()) {
        bzLog().info('SW unavailable, use page resource layer');
        await startPageResourceMode();
        return;
    }

    const deploymentAligned = await ensureDeploymentAligned();
    if (!deploymentAligned) {
        return;
    }

    await startServiceWorker();
}

start().catch(function (err) {
    bzLog().error('startup failed:', err);
    bootGame('startup error: ' + err);
});
