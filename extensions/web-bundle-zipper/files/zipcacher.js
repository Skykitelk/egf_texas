/**
 * Service Worker：仅拦截 Bundle 资源请求
 */
(function (global) {
    let knownBundles = {};
    let initBundleList = [];
    let swVersion = '';

    function R() {
        return global.BundleZipperRuntime || {};
    }

    function S() {
        return global.BundleZipperStorage;
    }

    function log() {
        return R().Logger || console;
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
        const cached = await S().matchUrl(url);
        if (cached) {
            log().debug('SW cache hit', url);
            return cached;
        }
        const response = await fetch(request);
        if (!response || !response.ok) {
            return response;
        }
        const bundleName = R().resolveBundleFromUrl(url, knownBundles);
        if (!bundleName || !(await isBundleInstalled(bundleName))) {
            return response;
        }
        try {
            await S().putUrl(url, response.clone(), bundleName, knownBundles[bundleName], {
                initBundles: initBundleList,
            });
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
            event.waitUntil(
                (async function () {
                    if (!global.registration.active) {
                        await global.skipWaiting();
                    }
                })(),
            );
        });

        global.addEventListener('activate', function (event) {
            event.waitUntil(
                (async function () {
                    await global.clients.claim();
                    await S().resolvePersistent();
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
                    if (data.what === 'purgeStale') {
                        const purged = await S().purgeStaleVersions(data.bundles || knownBundles);
                        client.postMessage({ what: 'purgeStaleDone', id: data.id, purged: purged });
                    }
                })(),
            );
        });

        log().info('SW init', 'swVersion=', swVersion, 'bundles=', Object.keys(knownBundles).length);
    }

    global.BundleZipperSW = { init: init };
})(self);
