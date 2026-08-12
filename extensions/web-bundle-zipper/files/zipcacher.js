/**
 * Service Worker：Bundle zip 缓存 + fetch 拦截（仅 Bundle 资源）
 */
(function (global) {
    let cacheApi = null;
    let swVersion = '';
    let knownBundles = {};
    /** @type {Record<string, string[]>} bundle -> installId[] */
    const activeInstallIds = {};

    function bzLog() {
        if (global.BundleCacheCore && global.BundleCacheCore.Logger) {
            return global.BundleCacheCore.Logger;
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

    function getRootRoute() {
        const distDir = new URL('./', global.location.href).pathname;
        return distDir + 'assets/';
    }

    function getBaseHref() {
        return new URL('./', global.location.href).href;
    }

    async function purgeLegacyEngineCaches() {
        if (cacheApi && cacheApi.purgeLegacyEngineCaches) {
            await cacheApi.purgeLegacyEngineCaches();
            return;
        }
        if (global.BundleCacheCore && global.BundleCacheCore.purgeLegacyEngineCaches) {
            await global.BundleCacheCore.purgeLegacyEngineCaches();
        }
    }

    function notify(client, what, payload) {
        if (client) {
            client.postMessage(Object.assign({ what }, payload));
        }
    }

    function notifyAllClients(what, payload) {
        global.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            clients.forEach((client) => notify(client, what, payload));
        });
    }

    function notifyInstallEvent(what, payload) {
        const bundle = payload.bundle;
        const ids = bundle ? activeInstallIds[bundle] : null;
        if (ids && ids.length) {
            for (let i = 0; i < ids.length; i++) {
                notifyAllClients(what, Object.assign({}, payload, { id: ids[i] }));
            }
            return;
        }
        notifyAllClients(what, payload);
    }

    function init(options) {
        options = options || {};
        swVersion = global.BUNDLE_ZIPPER_SW_VERSION || options.swVersion || '';
        knownBundles = options.knownBundles || {};
        const fetchOrigin = options.cdnUrl || '';

        cacheApi = global.BundleCacheCore.create({
            caches: global.caches,
            fflate: global.fflate,
            getRootRoute: getRootRoute,
            getFetchOrigin: () => fetchOrigin,
            getBaseHref: getBaseHref,
            getKnownBundles: () => knownBundles,
            useAsyncUnzip: false,
            notify: function (what, payload) {
                if (what === 'installProgress' || what === 'installError') {
                    notifyInstallEvent(what, payload);
                } else {
                    notifyAllClients(what, payload);
                }
            },
        });

        global.addEventListener('install', (event) => {
            event.waitUntil(
                (async () => {
                    if (!global.registration.active) {
                        bzLog().debug('SW install: skipWaiting (no active worker)');
                        await global.skipWaiting();
                    }
                })(),
            );
        });

        global.addEventListener('activate', (event) => {
            event.waitUntil(
                (async () => {
                    await global.clients.claim();
                    bzLog().info('SW activate: clients claimed');
                    if (swVersion) {
                        const meta = await cacheApi.readMeta();
                        const prev = meta ? meta.runtimeVersion || meta.swVersion : '';
                        if (!meta || prev !== swVersion) {
                            bzLog().info(
                                'SW runtime version changed:',
                                prev || '(none)',
                                '->',
                                swVersion,
                            );
                        } else {
                            bzLog().debug('SW runtime version unchanged:', swVersion);
                        }
                        await purgeLegacyEngineCaches();
                        bzLog().debug('runtime hygiene on activate', swVersion);
                    }
                })(),
            );
        });

        global.addEventListener('message', (event) => {
            event.waitUntil(handleMessage(event, cacheApi));
        });

        global.addEventListener('fetch', (event) => {
            const request = event.request;
            if (request.method !== 'GET') {
                return;
            }
            if (!cacheApi.shouldInterceptAssetUrl(request.url)) {
                return;
            }

            event.respondWith(
                (async () => {
                    const cached = await cacheApi.matchCachedResponse(request.url);
                    if (cached) {
                        bzLog().debug('SW fetch cache hit', request.url);
                        return cached;
                    }
                    const cdnUrl = cacheApi.resolveCdnUrl(request.url);
                    if (cdnUrl) {
                        bzLog().debug('SW fetch CDN fallback', request.url, '->', cdnUrl);
                        return fetch(cdnUrl);
                    }
                    bzLog().debug('SW fetch network', request.url);
                    return fetch(request);
                })(),
            );
        });

        bzLog().info(
            'SW init',
            'swVersion=',
            swVersion,
            'bundles=',
            Object.keys(knownBundles).length,
            fetchOrigin ? 'cdn=' + fetchOrigin : 'cdn=(same origin)',
        );
    }

    function trackInstallId(bundle, installId) {
        if (!installId) {
            return;
        }
        if (!activeInstallIds[bundle]) {
            activeInstallIds[bundle] = [];
        }
        if (activeInstallIds[bundle].indexOf(installId) < 0) {
            activeInstallIds[bundle].push(installId);
        }
    }

    function untrackInstallId(bundle, installId) {
        if (!installId || !activeInstallIds[bundle]) {
            return;
        }
        activeInstallIds[bundle] = activeInstallIds[bundle].filter(function (id) {
            return id !== installId;
        });
        if (!activeInstallIds[bundle].length) {
            delete activeInstallIds[bundle];
        }
    }

    async function handleMessage(event, cache) {
        const data = event.data || {};
        const client = event.source;
        if (!client) {
            return;
        }

        switch (data.what) {
            case 'bootstrap':
                {
                    const rv = data.runtimeVersion || data.swVersion || swVersion;
                    if (rv) {
                        swVersion = rv;
                    }
                    // 忽略旧客户端可能仍发送的 engineFiles / precacheEngine
                    const bundles = data.bundles || knownBundles;
                    knownBundles = bundles;
                    bzLog().info('SW message bootstrap', rv);
                    await cache.mergeMetaOnly(rv, bundles);
                    await cache.purgeStale(bundles);
                    await purgeLegacyEngineCaches();
                    bzLog().info('runtime hygiene complete', rv);
                    notify(client, 'bootstrapComplete', { id: data.id, version: rv });
                }
                break;
            case 'installBundle':
                bzLog().info('SW message installBundle', data.bundle, data.version, 'id=', data.id);
                trackInstallId(data.bundle, data.id);
                try {
                    await cache.installBundle(data.bundle, data.version);
                } catch {
                    // installBundle 已通过 notify 上报错误
                } finally {
                    untrackInstallId(data.bundle, data.id);
                }
                break;
            case 'purgeBundle':
                bzLog().info('SW message purgeBundle', data.bundle);
                await cache.purgeBundleAllVersions(data.bundle);
                break;
            case 'purgeAll':
            case 'purgeEverything':
                bzLog().info('SW message', data.what);
                await cache.purgeEverything();
                notify(client, 'purgeComplete', { id: data.id });
                break;
            case 'skipWaiting':
                bzLog().info('SW message skipWaiting');
                global.skipWaiting();
                break;
            case 'getSwVersion':
                bzLog().debug('SW message getSwVersion', swVersion);
                notify(client, 'swVersion', { id: data.id, version: swVersion });
                break;
            case 'syncSwVersion':
                bzLog().info('SW message syncSwVersion', data.runtimeVersion || data.swVersion);
                await cache.mergeBundles(data.runtimeVersion || data.swVersion, data.bundles);
                notify(client, 'swVersionSynced', {
                    id: data.id,
                    version: data.runtimeVersion || data.swVersion,
                });
                break;
        }
    }

    global.BundleZipperSW = { init };
})(self);
