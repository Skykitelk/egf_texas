/**
 * 页面网络拦截：无 SW 时等价于 SW fetch 拦截
 * 仅拦截已识别 Bundle 资源；回写仅当 Bundle 已安装
 */
(function (global) {
    let deferToSw = false;
    let originalFetch = null;
    let xhrOpen = null;
    let xhrSend = null;
    let xhrSetRequestHeader = null;

    function R() {
        return global.BundleZipperRuntime || {};
    }

    function S() {
        return global.BundleZipperStorage;
    }

    function log() {
        return R().Logger || console;
    }

    function getAllBundles() {
        return typeof allBundles !== 'undefined' && allBundles ? allBundles : {};
    }

    function getInitBundles() {
        return typeof initBundles !== 'undefined' && Array.isArray(initBundles) ? initBundles : [];
    }

    async function isBundleInstalled(bundleName) {
        const wanted = getAllBundles()[bundleName];
        if (!wanted || !S() || !S().hasCompleteBundle) {
            return false;
        }
        return S().hasCompleteBundle(bundleName, wanted);
    }

    async function handleRequest(url, doNetwork) {
        const bundles = getAllBundles();
        if (!R().shouldInterceptAssetUrl(url, bundles)) {
            return doNetwork();
        }
        const cached = await S().matchUrl(url);
        if (cached) {
            log().debug('page intercept cache hit', url);
            return cached;
        }
        const response = await doNetwork();
        if (!response || !response.ok) {
            return response;
        }
        const bundleName = R().resolveBundleFromUrl(url, bundles);
        if (!bundleName) {
            return response;
        }
        if (!(await isBundleInstalled(bundleName))) {
            log().debug('page intercept network (not installed)', bundleName, url);
            return response;
        }
        const version = bundles[bundleName];
        try {
            await S().putUrl(url, response.clone(), bundleName, version, {
                initBundles: getInitBundles(),
            });
            log().debug('page intercept write-through', bundleName, url);
        } catch (err) {
            log().warn('page intercept write-through failed', url, err);
        }
        return response;
    }

    function patchFetch() {
        if (!global.fetch || global.__bundleZipperFetchPatched) {
            return;
        }
        originalFetch = global.fetch.bind(global);
        global.__bundleZipperFetchPatched = true;
        global.fetch = function (input, init) {
            if (deferToSw) {
                return originalFetch(input, init);
            }
            const url =
                typeof input === 'string'
                    ? input
                    : input && input.url
                      ? input.url
                      : String(input);
            return handleRequest(url, function () {
                return originalFetch(input, init);
            });
        };
        log().info('page fetch intercept installed');
    }

    function patchXhr() {
        if (!global.XMLHttpRequest || !global.XMLHttpRequest.prototype) {
            return;
        }
        if (global.__bundleZipperXhrPatched) {
            return;
        }
        global.__bundleZipperXhrPatched = true;
        const proto = global.XMLHttpRequest.prototype;
        xhrOpen = proto.open;
        xhrSend = proto.send;
        xhrSetRequestHeader = proto.setRequestHeader;

        proto.open = function (method, url) {
            this.__bzMethod = method;
            this.__bzUrl = url;
            // 第三个参数 async，默认 true；同步 XHR 不拦截
            this.__bzAsync = arguments.length < 3 || arguments[2] !== false;
            this.__bzHeaders = null;
            return xhrOpen.apply(this, arguments);
        };

        proto.setRequestHeader = function (name, value) {
            if (!this.__bzHeaders) {
                this.__bzHeaders = {};
            }
            this.__bzHeaders[name] = value;
            return xhrSetRequestHeader.apply(this, arguments);
        };

        proto.send = function (body) {
            const xhr = this;
            if (deferToSw || String(xhr.__bzMethod || 'GET').toUpperCase() !== 'GET') {
                return xhrSend.apply(xhr, arguments);
            }
            // 同步 XHR 无法安全改写，走原生
            if (xhr.__bzAsync === false) {
                return xhrSend.apply(xhr, arguments);
            }
            const url = xhr.__bzUrl;
            const bundles = getAllBundles();
            if (!R().shouldInterceptAssetUrl(url, bundles)) {
                return xhrSend.apply(xhr, arguments);
            }

            const fetchInit = {};
            if (xhr.withCredentials) {
                fetchInit.credentials = 'include';
            }
            if (xhr.__bzHeaders) {
                fetchInit.headers = xhr.__bzHeaders;
            }

            handleRequest(url, function () {
                return originalFetch
                    ? originalFetch(url, fetchInit)
                    : fetch(url, fetchInit);
            })
                .then(function (response) {
                    return response.blob().then(function (blob) {
                        const blobUrl = URL.createObjectURL(blob);
                        const prevType = xhr.responseType;
                        const prevCred = xhr.withCredentials;
                        const prevTimeout = xhr.timeout;
                        xhr.addEventListener('loadend', function () {
                            try {
                                URL.revokeObjectURL(blobUrl);
                            } catch (_) {}
                        });
                        // open() 会重置 XHR；必须恢复 responseType，否则 Cocos arraybuffer/json 会坏
                        xhrOpen.call(xhr, 'GET', blobUrl, true);
                        try {
                            if (prevType) {
                                xhr.responseType = prevType;
                            }
                            xhr.withCredentials = prevCred;
                            if (typeof prevTimeout === 'number' && prevTimeout > 0) {
                                xhr.timeout = prevTimeout;
                            }
                        } catch (_) {}
                        xhrSend.call(xhr);
                    });
                })
                .catch(function () {
                    xhrSend.call(xhr, body);
                });
        };
        log().info('page XHR intercept installed');
    }

    function install(options) {
        options = options || {};
        deferToSw = !!options.deferToServiceWorker;
        if (deferToSw) {
            log().info('page network intercept deferred to SW');
            return;
        }
        // 允许先 defer 后再切回页面拦截（例如 SW register 失败 fallback）
        patchFetch();
        patchXhr();
    }

    function setDeferToServiceWorker(enabled) {
        deferToSw = !!enabled;
        if (!deferToSw) {
            patchFetch();
            patchXhr();
        }
    }

    global.BundleZipperNetwork = {
        install: install,
        setDeferToServiceWorker: setDeferToServiceWorker,
        handleRequest: handleRequest,
    };
})(typeof window !== 'undefined' ? window : self);
