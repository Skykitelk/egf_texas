/**
 * Service Worker：仅拦截 Bundle 资源请求
 *
 * 明细日志：页面地址带 ?bzdebug=1 时输出（与页面拦截相同风格）。
 * SW 自身 location 是 sw.js，因此还会检查受控页面 URL，并把日志 postMessage 到页面控制台。
 */
(function (global) {
    let knownBundles = {};
    let initBundleList = [];
    let swVersion = '';
    /** @type {boolean|null} */
    let debugFlagCache = null;
    let debugFlagCacheAt = 0;
    let debugFlagCacheKey = '';

    function api() {
        if (!global.WebBundleZipper) {
            global.WebBundleZipper = {};
        }
        return global.WebBundleZipper;
    }

    function R() {
        return api().Runtime || {};
    }

    function S() {
        return api().Storage;
    }

    function log() {
        return R().Logger || console;
    }

    function clientHasBzDebug1(clientUrl) {
        try {
            return /[?&]bzdebug=1(?:&|$)/.test(new URL(clientUrl).search || '');
        } catch (_) {
            return false;
        }
    }

    /**
     * 仅认「页面」地址栏 ?bzdebug=1。
     * 不要看 sw.js 自身 query：注册时若曾带 bzdebug=1 会粘住，导致页面已是 bzdebug=0 仍打 debug。
     */
    async function isSwDebugEnabled() {
        if (!global.clients || !global.clients.matchAll) {
            return false;
        }
        let list;
        try {
            list = await global.clients.matchAll({
                type: 'window',
                includeUncontrolled: true,
            });
        } catch (_) {
            return false;
        }
        let enabled = false;
        const keyParts = [];
        for (let i = 0; i < list.length; i++) {
            const u = list[i].url || '';
            keyParts.push(u);
            if (clientHasBzDebug1(u)) {
                enabled = true;
            }
        }
        const key = keyParts.join('\n');
        const now = Date.now();
        if (debugFlagCache !== null && key === debugFlagCacheKey && now - debugFlagCacheAt < 1000) {
            return debugFlagCache;
        }
        debugFlagCache = enabled;
        debugFlagCacheAt = now;
        debugFlagCacheKey = key;
        return enabled;
    }

    async function swDebugLog() {
        if (!(await isSwDebugEnabled())) {
            return;
        }
        const args = Array.prototype.slice.call(arguments);
        try {
            console.log.apply(console, ['[BundleZipper][debug]'].concat(args));
        } catch (_) {}
        // 同步打到页面控制台（用户通常只看页面 DevTools）
        try {
            if (!global.clients || !global.clients.matchAll) {
                return;
            }
            const list = await global.clients.matchAll({
                type: 'window',
                includeUncontrolled: true,
            });
            for (let i = 0; i < list.length; i++) {
                try {
                    list[i].postMessage({ what: 'bzDebugLog', args: args });
                } catch (_) {}
            }
        } catch (_) {}
    }

    async function isBundleInstalled(bundleName) {
        const wanted = knownBundles[bundleName];
        if (!wanted || !S() || !S().hasCompleteBundle) {
            return false;
        }
        return S().hasCompleteBundle(bundleName, wanted);
    }

    async function handleFetch(request) {
        const url = request.url;
        if (!R().shouldInterceptAssetUrl(url, knownBundles)) {
            return fetch(request);
        }
        const bundleName = R().resolveBundleFromUrl(url, knownBundles);
        const version = bundleName ? knownBundles[bundleName] : '';
        const cached = await S().matchUrl(url, {
            cacheName:
                bundleName && version && R().buildCacheName
                    ? R().buildCacheName(bundleName, version)
                    : null,
        });
        if (cached) {
            await swDebugLog('SW intercept cache hit', url);
            return cached;
        }
        const response = await fetch(request);
        if (!response || !response.ok) {
            return response;
        }
        if (!bundleName) {
            return response;
        }
        if (!(await isBundleInstalled(bundleName))) {
            await swDebugLog('SW intercept network (not installed)', bundleName, url);
            return response;
        }
        try {
            await S().putUrl(url, response.clone(), bundleName, version, {
                initBundles: initBundleList,
            });
            await swDebugLog('SW intercept write-through', bundleName, url);
        } catch (err) {
            log().warn('SW write-through failed', url, err);
        }
        return response;
    }

    function init(options) {
        options = options || {};
        swVersion = global.BUNDLE_ZIPPER_SW_VERSION || options.swVersion || '';
        knownBundles = options.knownBundles || {};
        initBundleList = options.initBundles || [];

        global.addEventListener('install', function (event) {
            // 更新 SW 也立即 skipWaiting，避免永久卡在 waiting
            event.waitUntil(global.skipWaiting());
        });

        global.addEventListener('activate', function (event) {
            event.waitUntil(
                (async function () {
                    await global.clients.claim();
                    await S().resolvePersistent();
                    debugFlagCache = null;
                    log().info('SW activate', swVersion);
                })(),
            );
        });

        global.addEventListener('fetch', function (event) {
            const request = event.request;
            if (request.method !== 'GET') {
                return;
            }
            if (!R().shouldInterceptAssetUrl(request.url, knownBundles)) {
                return;
            }
            event.respondWith(handleFetch(request));
        });

        global.addEventListener('message', function (event) {
            const data = event.data || {};
            const client = event.source;
            if (!client) {
                return;
            }
            event.waitUntil(
                (async function () {
                    if (data.what === 'skipWaiting') {
                        await global.skipWaiting();
                        return;
                    }
        if (data.what === 'getSwVersion') {
                        client.postMessage({ what: 'swVersion', id: data.id, version: swVersion });
                        return;
                    }
                    if (data.what === 'getKnownBundles') {
                        client.postMessage({
                            what: 'knownBundles',
                            id: data.id,
                            bundles: knownBundles,
                            fp: R().fingerprintBundles
                                ? R().fingerprintBundles(knownBundles)
                                : '',
                        });
                        return;
                    }
                    if (data.what === 'purgeStale') {
                        // 只用 SW 内嵌 knownBundles，忽略客户端传入（防 {} 清空全部缓存）
                        const purged = await S().purgeStaleVersions(knownBundles);
                        client.postMessage({ what: 'purgeStaleDone', id: data.id, purged: purged });
                    }
                })(),
            );
        });

        log().info('SW init', 'swVersion=', swVersion, 'bundles=', Object.keys(knownBundles).length);
    }

    api().SW = { init: init };
})(self);
