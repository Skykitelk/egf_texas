/**
 * 页面资源层：无 SW 时负责 zip 安装；任意环境下拦截 fetch / XHR，与 SW 共用 CacheStorage
 */
(function (global) {
    /** @type {ReturnType<global.BundleCacheCore.create> | null} */
    let sharedCache = null;
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

    function resolveBaseRoute() {
        const pathname = global.location.pathname;
        if (pathname.endsWith('/')) {
            return pathname;
        }
        const lastSlash = pathname.lastIndexOf('/');
        return pathname.substring(0, lastSlash + 1);
    }

    function getRootRoute() {
        return resolveBaseRoute() + 'assets/';
    }

    function getBaseHref() {
        return new URL('./', global.location.href).href;
    }

    function normalizeUrl(url) {
        return global.BundleCacheCore.normalizeRequestUrl(url, getBaseHref());
    }

    function bindSharedCache(cache) {
        sharedCache = cache;
    }

    function getSharedCache() {
        return sharedCache;
    }

    async function resolvePageStorage() {
        if (!global.BundleZipperStorage || !global.BundleZipperStorage.resolveStorage) {
            throw new Error('BundleZipperStorage unavailable');
        }
        return global.BundleZipperStorage.resolveStorage(global);
    }

    function installFetchIntercept() {
        if (!global.fetch || global.__bundleZipperFetchPatched) {
            return;
        }
        global.__bundleZipperFetchPatched = true;
        bzLog().info('page fetch intercept installed');
        const originalFetch = global.fetch.bind(global);

        global.fetch = async function (input, init) {
            const cache = getSharedCache();
            if (!cache) {
                return originalFetch(input, init);
            }

            let url = '';
            if (typeof input === 'string') {
                url = input;
            } else if (typeof URL !== 'undefined' && input instanceof URL) {
                url = input.href;
            } else if (input && input.url) {
                url = input.url;
            }

            if (url && cache.shouldInterceptAssetUrl(normalizeUrl(url))) {
                try {
                    const normalized = normalizeUrl(url);
                    const cached = await cache.matchCachedResponse(normalized);
                    if (cached) {
                        bzLog().debug('page fetch cache hit', normalized);
                        return cached;
                    }
                    const cdnUrlResolved = cache.resolveCdnUrl(normalized);
                    if (cdnUrlResolved) {
                        bzLog().debug('page fetch CDN fallback', normalized, '->', cdnUrlResolved);
                        return originalFetch(cdnUrlResolved, init);
                    }
                } catch (err) {
                    bzLog().warn('fetch intercept error', err);
                }
            }
            return originalFetch(input, init);
        };
    }

    function revokeXhrObjectUrl(xhr) {
        const objectUrl = xhr.__bzObjectUrl;
        if (!objectUrl) {
            return;
        }
        delete xhr.__bzObjectUrl;
        try {
            if (global.URL && global.URL.revokeObjectURL) {
                global.URL.revokeObjectURL(objectUrl);
            }
        } catch {
            // ignore
        }
    }

    /** 通过 blob URL + 真实 XHR 加载缓存，避免伪造 response 导致渲染进程崩溃 */
    function serveXhrFromCacheViaBlob(xhr, cached, originalSend, sendArgs, reopenXhrWithUrl) {
        cached
            .blob()
            .then(function (blob) {
                if (!global.URL || !global.URL.createObjectURL) {
                    originalSend.apply(xhr, sendArgs);
                    return;
                }
                revokeXhrObjectUrl(xhr);
                const objectUrl = global.URL.createObjectURL(blob);
                xhr.__bzObjectUrl = objectUrl;
                function onLoadEnd() {
                    xhr.removeEventListener('loadend', onLoadEnd);
                    revokeXhrObjectUrl(xhr);
                }
                xhr.addEventListener('loadend', onLoadEnd);
                reopenXhrWithUrl(xhr, objectUrl);
                originalSend.apply(xhr, sendArgs);
            })
            .catch(function () {
                originalSend.apply(xhr, sendArgs);
            });
    }

    function installXhrIntercept() {
        if (!global.XMLHttpRequest || !global.XMLHttpRequest.prototype) {
            return;
        }
        const xhrProto = global.XMLHttpRequest.prototype;
        if (xhrProto.__bundleZipperPatched) {
            return;
        }
        xhrProto.__bundleZipperPatched = true;
        bzLog().info('page XHR intercept installed');

        const originalOpen = xhrProto.open;
        const originalSend = xhrProto.send;
        const originalSetRequestHeader = xhrProto.setRequestHeader;

        function reopenXhrWithUrl(xhr, newUrl) {
            const openArgs = xhr.__bzOpenArgs
                ? Array.prototype.slice.call(xhr.__bzOpenArgs)
                : [xhr.__bzMethod || 'GET', newUrl];
            openArgs[1] = newUrl;
            originalOpen.apply(xhr, openArgs);
            const headers = xhr.__bzHeaders || {};
            for (const name in headers) {
                if (Object.prototype.hasOwnProperty.call(headers, name)) {
                    try {
                        originalSetRequestHeader.call(xhr, name, headers[name]);
                    } catch {
                        // ignore invalid header after reopen
                    }
                }
            }
        }

        xhrProto.open = function (method, url) {
            this.__bzUrl = url;
            this.__bzMethod = method;
            this.__bzOpenArgs = arguments;
            this.__bzHeaders = this.__bzHeaders || {};
            return originalOpen.apply(this, arguments);
        };

        if (originalSetRequestHeader) {
            xhrProto.setRequestHeader = function (name, value) {
                this.__bzHeaders = this.__bzHeaders || {};
                this.__bzHeaders[name] = value;
                return originalSetRequestHeader.apply(this, arguments);
            };
        }

        xhrProto.send = function (body) {
            const xhr = this;
            const url = xhr.__bzUrl;
            const sendArgs = arguments;
            const cache = getSharedCache();

            if (!cache) {
                return originalSend.apply(xhr, sendArgs);
            }

            if (!url || typeof url !== 'string' || (xhr.__bzMethod && xhr.__bzMethod.toUpperCase() !== 'GET')) {
                return originalSend.apply(xhr, sendArgs);
            }

            const normalized = normalizeUrl(url);
            if (!cache.shouldInterceptAssetUrl(normalized)) {
                return originalSend.apply(xhr, sendArgs);
            }

            cache
                .matchCachedResponse(normalized)
                .then((cached) => {
                    if (cached) {
                        bzLog().debug('page XHR cache hit', normalized);
                        serveXhrFromCacheViaBlob(xhr, cached, originalSend, sendArgs, reopenXhrWithUrl);
                        return;
                    }
                    const cdnUrlResolved = cache.resolveCdnUrl(normalized);
                    if (cdnUrlResolved && cdnUrlResolved !== normalized) {
                        bzLog().debug('page XHR CDN fallback', normalized, '->', cdnUrlResolved);
                        reopenXhrWithUrl(xhr, cdnUrlResolved);
                        originalSend.apply(xhr, sendArgs);
                        return;
                    }
                    originalSend.apply(xhr, sendArgs);
                })
                .catch(() => {
                    originalSend.apply(xhr, sendArgs);
                });
        };
    }

    function patchElementSrc(proto, label, applyCached) {
        const srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
        if (!srcDesc || !srcDesc.set) {
            return false;
        }

        const originalSrcSet = srcDesc.set;
        const originalSrcGet = srcDesc.get;

        Object.defineProperty(proto, 'src', {
            configurable: true,
            enumerable: srcDesc.enumerable,
            get: function () {
                return originalSrcGet ? originalSrcGet.call(this) : '';
            },
            set: function (value) {
                const element = this;
                const cache = getSharedCache();
                if (!cache || value == null || value === '') {
                    originalSrcSet.call(element, value);
                    return;
                }

                const rawUrl = String(value);
                const normalized = normalizeUrl(rawUrl);
                if (!cache.shouldInterceptAssetUrl(normalized)) {
                    originalSrcSet.call(element, value);
                    return;
                }

                cache
                    .matchCachedResponse(normalized)
                    .then(function (cached) {
                        if (!cached) {
                            originalSrcSet.call(element, value);
                            return;
                        }
                        bzLog().debug('page ' + label + ' cache hit', normalized);
                        return applyCached(element, cached, value, originalSrcSet);
                    })
                    .catch(function () {
                        originalSrcSet.call(element, value);
                    });
            },
        });
        return true;
    }

    function installImageIntercept() {
        if (!global.HTMLImageElement || !global.HTMLImageElement.prototype || global.__bundleZipperImagePatched) {
            return;
        }
        global.__bundleZipperImagePatched = true;
        if (
            patchElementSrc(global.HTMLImageElement.prototype, 'image', function (img, cached, fallbackUrl, originalSet) {
                cached.blob().then(function (blob) {
                    const objectUrl =
                        global.URL && global.URL.createObjectURL ? global.URL.createObjectURL(blob) : '';
                    if (objectUrl) {
                        img.__bzObjectUrl = objectUrl;
                        originalSet.call(img, objectUrl);
                        return;
                    }
                    originalSet.call(img, fallbackUrl);
                });
            })
        ) {
            bzLog().info('page image intercept installed');
        }
    }

    function installScriptIntercept() {
        if (!global.HTMLScriptElement || !global.HTMLScriptElement.prototype || global.__bundleZipperScriptPatched) {
            return;
        }
        global.__bundleZipperScriptPatched = true;
        if (
            patchElementSrc(global.HTMLScriptElement.prototype, 'script', function (script, cached, fallbackUrl, originalSet) {
                cached.blob().then(function (blob) {
                    const objectUrl =
                        global.URL && global.URL.createObjectURL
                            ? global.URL.createObjectURL(new Blob([blob], { type: 'application/javascript' }))
                            : '';
                    if (objectUrl) {
                        script.__bzObjectUrl = objectUrl;
                        originalSet.call(script, objectUrl);
                        return;
                    }
                    originalSet.call(script, fallbackUrl);
                });
            })
        ) {
            bzLog().info('page script intercept installed');
        }
    }

    function installResourceInterceptors(options) {
        options = options || {};
        if (options.deferToServiceWorker) {
            bzLog().info('page network intercept skipped (SW active)');
            return;
        }
        installFetchIntercept();
        installXhrIntercept();
        installImageIntercept();
        installScriptIntercept();
    }

    function createPageCacher(cdnUrl, swVersion, knownBundles) {
        const listeners = {
            installProgress: null,
            installError: null,
            purgeComplete: null,
        };

        let knownBundlesRef = knownBundles || {};
        let cache = null;
        let storageKind = '';

        function notifyHandler(what, payload) {
            if (what === 'installProgress' && listeners.installProgress) {
                listeners.installProgress(payload.bundle, payload.percent);
            } else if (what === 'installError' && listeners.installError) {
                listeners.installError(
                    payload.bundle,
                    global.BundleCacheCore.deserializeError(payload.error),
                );
            } else if (what === 'purgeComplete' && listeners.purgeComplete) {
                listeners.purgeComplete();
            }
        }

        async function ensureCache() {
            if (cache) {
                return cache;
            }
            const storage = await resolvePageStorage();
            storageKind = storage.kind;
            cache = global.BundleCacheCore.create({
                caches: storage,
                fflate: global.fflate,
                getRootRoute: getRootRoute,
                getFetchOrigin: () => cdnUrl || '',
                getBaseHref: getBaseHref,
                getKnownBundles: () => knownBundlesRef,
                useAsyncUnzip: true,
                notify: notifyHandler,
            });
            bindSharedCache(cache);
            return cache;
        }

        async function prepare(bundles, options) {
            options = options || {};
            knownBundlesRef = bundles || knownBundlesRef;
            await ensureCache();
            installResourceInterceptors(options);
            bzLog().info(
                'page cacher prepared',
                'storage=',
                storageKind,
                'swVersion=',
                swVersion,
                'bundles=',
                Object.keys(knownBundlesRef).length,
                'deferToServiceWorker=',
                !!options.deferToServiceWorker,
            );
        }

        async function bootstrap(bundles, options) {
            options = options || {};
            knownBundlesRef = bundles || knownBundlesRef;
            const rv = options.runtimeVersion || swVersion;
            const c = await ensureCache();
            bzLog().info('page bootstrap merge', rv, 'storage=', storageKind);
            await c.mergeMetaOnly(rv, knownBundlesRef);
        }

        return {
            get cache() {
                return cache;
            },
            getStorageKind: function () {
                return storageKind;
            },
            prepare: prepare,
            bootstrap: bootstrap,
            installBundle: async function (bundle, version) {
                const c = await ensureCache();
                return c.installBundle(bundle, version);
            },
            purgeBundle: async function (bundle) {
                const c = await ensureCache();
                return c.purgeBundleAllVersions(bundle);
            },
            purgeAll: async function () {
                const c = await ensureCache();
                return c.purgeAll();
            },
            purgeEverything: async function () {
                const c = await ensureCache();
                return c.purgeEverything();
            },
            setProgressListener: function (fn) {
                listeners.installProgress = fn;
            },
            setErrorListener: function (fn) {
                listeners.installError = fn;
            },
            setPurgeListener: function (fn) {
                listeners.purgeComplete = fn;
            },
        };
    }

    global.BundleZipperPage = {
        create: createPageCacher,
        resolvePageStorage: resolvePageStorage,
        installResourceInterceptors: installResourceInterceptors,
        bindSharedCache: bindSharedCache,
    };
})(window);
