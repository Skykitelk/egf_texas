/**
 * 页面网络拦截：无 SW 时等价于 SW fetch 拦截
 *
 * 对齐本地 Cocos Creator 3.8.5 asset-manager / pal-audio：
 * - download-file.ts      → XMLHttpRequest（json/text/bin/astc/.cconb 等）
 * - download-dom-image.ts → new Image(); img.src = url
 *   （asset-manager.allowImageBitmap 默认 false，图片主路径是 DOM Image，而非 XHR blob）
 * - download-script.ts    → script.src = url（bundle index.*.js）；先赋 src 再绑 load/error
 * - pal/audio/web/player-dom.ts → HTMLAudioElement.src
 * - pal/audio/web/player-web.ts → XMLHttpRequest
 * - allowImageBitmap=true 时图片走 XHR blob → 已由 XHR 拦截覆盖
 *
 * 仅拦截已识别 Bundle 资源；回写仅当 Bundle 已安装
 */
(function (global) {
    let deferToSw = false;
    let originalFetch = null;
    let xhrOpen = null;
    let xhrSend = null;
    let xhrSetRequestHeader = null;
    let xhrOverrideMimeType = null;

    /** @type {Record<string, Promise<Response>>} */
    const inflightByUrl = Object.create(null);
    /** 同源资源 blob: URL 复用。Image/Audio 永不 revoke（仍被引擎引用）；仅 Script 走 LRU */
    /** @type {Record<string, string>} */
    const objectUrlByAsset = Object.create(null);
    /** @type {string[]} */
    const scriptUrlOrder = [];
    const SCRIPT_URL_LIMIT = 80;

    function isScriptElement(element) {
        return !!(
            element &&
            (element.tagName === 'SCRIPT' ||
                (global.HTMLScriptElement && element instanceof global.HTMLScriptElement))
        );
    }

    function rememberObjectUrl(key, blobUrl, canRevoke) {
        if (objectUrlByAsset[key]) {
            if (canRevoke) {
                const idx = scriptUrlOrder.indexOf(key);
                if (idx >= 0) {
                    scriptUrlOrder.splice(idx, 1);
                }
                scriptUrlOrder.push(key);
            }
            return objectUrlByAsset[key];
        }
        objectUrlByAsset[key] = blobUrl;
        if (!canRevoke) {
            return blobUrl;
        }
        scriptUrlOrder.push(key);
        while (scriptUrlOrder.length > SCRIPT_URL_LIMIT) {
            const oldKey = scriptUrlOrder.shift();
            if (!oldKey || oldKey === key) {
                continue;
            }
            const oldUrl = objectUrlByAsset[oldKey];
            delete objectUrlByAsset[oldKey];
            if (oldUrl) {
                try {
                    URL.revokeObjectURL(oldUrl);
                } catch (_) {}
            }
        }
        return blobUrl;
    }

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

    function getAllBundles() {
        return api().allBundles || {};
    }

    function getInitBundles() {
        const list = api().initBundles;
        return Array.isArray(list) ? list : [];
    }

    /**
     * 规范化拦截用 URL：绝对化、去 hash、去掉引擎编辑器防缓存 _t
     *（utilities.urlAppendTimestamp 仅编辑器预览会加）
     */
    function canonicalizeUrl(url) {
        try {
            const u = new URL(String(url), global.location.href);
            u.hash = '';
            if (u.searchParams && u.searchParams.has('_t')) {
                u.searchParams.delete('_t');
            }
            // 清理空 search
            if (u.search === '?') {
                u.search = '';
            }
            return u.href;
        } catch (_) {
            return String(url || '');
        }
    }

    function assetKeyForUrl(url) {
        if (R().toStableCachePath) {
            const p = R().toStableCachePath(url);
            if (p) {
                return p;
            }
        }
        return canonicalizeUrl(url);
    }

    function shouldSkipUrl(url) {
        if (url == null || url === '') {
            return true;
        }
        const s = String(url);
        if (/^(blob:|data:|javascript:|about:)/i.test(s)) {
            return true;
        }
        return false;
    }

    async function isBundleInstalled(bundleName) {
        const wanted = getAllBundles()[bundleName];
        if (!wanted || !S() || !S().hasCompleteBundle) {
            return false;
        }
        return S().hasCompleteBundle(bundleName, wanted);
    }

    async function handleRequestInner(url, doNetwork) {
        const bundles = getAllBundles();
        if (!R().shouldInterceptAssetUrl(url, bundles)) {
            return doNetwork();
        }
        const bundleName = R().resolveBundleFromUrl(url, bundles);
        const version = bundleName ? bundles[bundleName] : '';
        const cached = await S().matchUrl(url, {
            cacheName:
                bundleName && version && R().buildCacheName
                    ? R().buildCacheName(bundleName, version)
                    : null,
        });
        if (cached) {
            log().debug('page intercept cache hit', url);
            return cached;
        }
        const response = await doNetwork();
        if (!response || !response.ok) {
            return response;
        }
        if (!bundleName) {
            return response;
        }
        if (!(await isBundleInstalled(bundleName))) {
            log().debug('page intercept network (not installed)', bundleName, url);
            return response;
        }
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

    /**
     * 同 URL 并发合并：先把 Response 固化为可多次 materialize 的快照，
     * 避免第一个消费者读 body 后其它 waiter clone 失败。
     */
    function handleRequest(url, doNetwork) {
        const key = canonicalizeUrl(url);
        if (inflightByUrl[key]) {
            return inflightByUrl[key].then(materializeResponseSnapshot);
        }

        const master = Promise.resolve()
            .then(function () {
                return handleRequestInner(key, doNetwork);
            })
            .then(function (resp) {
                return snapshotResponse(resp);
            })
            .then(
                function (snap) {
                    delete inflightByUrl[key];
                    return snap;
                },
                function (err) {
                    delete inflightByUrl[key];
                    throw err;
                },
            );

        inflightByUrl[key] = master;
        return master.then(materializeResponseSnapshot);
    }

    async function snapshotResponse(resp) {
        if (!resp) {
            return null;
        }
        const headerPairs = [];
        try {
            if (resp.headers && resp.headers.forEach) {
                resp.headers.forEach(function (value, name) {
                    headerPairs.push([name, value]);
                });
            }
        } catch (_) {}
        let body = null;
        try {
            body = await resp.arrayBuffer();
        } catch (err) {
            log().warn('snapshotResponse read body failed', err);
            throw err;
        }
        return {
            status: resp.status,
            statusText: resp.statusText || '',
            ok: !!resp.ok,
            headers: headerPairs,
            body: body,
        };
    }

    function materializeResponseSnapshot(snap) {
        if (!snap) {
            return null;
        }
        const headers = new Headers();
        const pairs = snap.headers || [];
        for (let i = 0; i < pairs.length; i++) {
            try {
                headers.append(pairs[i][0], pairs[i][1]);
            } catch (_) {}
        }
        // 每次拷贝一份 body，避免多消费者共享同一 ArrayBuffer
        const bodyCopy =
            snap.body && snap.body.byteLength >= 0
                ? snap.body.slice(0)
                : snap.body;
        // status 0（opaque/网络失败）不能用 ||200，否则会把失败变成成功
        let status = Number(snap.status);
        if (!Number.isFinite(status) || status < 200 || status > 599) {
            status = 502;
        }
        return new Response(bodyCopy, {
            status: status,
            statusText: snap.statusText || (status === 502 ? 'Bad Gateway' : ''),
            headers: headers,
        });
    }

    function networkFetch(url, init) {
        const timeoutMs = 60000;
        const fetchFn = originalFetch
            ? originalFetch
            : typeof fetch === 'function'
              ? fetch.bind(global)
              : null;
        if (!fetchFn) {
            return Promise.reject(new Error('fetch unavailable'));
        }
        if (typeof AbortController !== 'undefined') {
            const ctrl = new AbortController();
            const timer = setTimeout(function () {
                try {
                    ctrl.abort();
                } catch (_) {}
            }, timeoutMs);
            const opts = Object.assign({}, init || {}, { signal: ctrl.signal });
            return fetchFn(url, opts).then(
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
        return new Promise(function (resolve, reject) {
            let done = false;
            const timer = setTimeout(function () {
                if (done) {
                    return;
                }
                done = true;
                reject(new Error('networkFetch timeout after ' + timeoutMs + 'ms'));
            }, timeoutMs);
            fetchFn(url, init || {}).then(
                function (resp) {
                    if (done) {
                        return;
                    }
                    done = true;
                    clearTimeout(timer);
                    resolve(resp);
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

    function ensureBlobMime(blob, element) {
        if (!blob) {
            return blob;
        }
        if (!isScriptElement(element)) {
            return blob;
        }
        const type = String(blob.type || '').toLowerCase();
        if (
            type &&
            type !== 'application/octet-stream' &&
            type.indexOf('javascript') >= 0
        ) {
            return blob;
        }
        // download-script 需要可执行脚本 MIME，否则部分浏览器拒绝跑 blob: script
        return blob.arrayBuffer().then(function (buf) {
            return new Blob([buf], { type: 'text/javascript' });
        });
    }

    function objectUrlFromResponse(response, url, element) {
        const key = assetKeyForUrl(url);
        if (objectUrlByAsset[key]) {
            return Promise.resolve(objectUrlByAsset[key]);
        }
        const canRevoke = isScriptElement(element);
        return response.blob().then(function (blob) {
            return Promise.resolve(ensureBlobMime(blob, element)).then(function (finalBlob) {
                if (objectUrlByAsset[key]) {
                    return objectUrlByAsset[key];
                }
                const blobUrl = URL.createObjectURL(finalBlob);
                return rememberObjectUrl(key, blobUrl, canRevoke);
            });
        });
    }

    /**
     * 将 DOM 资源 src 改写为缓存 blob URL（Image / Script / Audio）
     * 注意：3.8.5 download-script 在绑 load 前就赋 src；我们异步改写，
     * 监听器会在真正触发 load 前注册完毕。
     */
    function rewriteDomSrc(element, url, nativeSetter) {
        if (deferToSw || shouldSkipUrl(url)) {
            nativeSetter.call(element, url);
            return;
        }
        const bundles = getAllBundles();
        if (!R().shouldInterceptAssetUrl(url, bundles)) {
            nativeSetter.call(element, url);
            return;
        }

        const absUrl = canonicalizeUrl(url);
        const key = assetKeyForUrl(absUrl);
        if (objectUrlByAsset[key]) {
            nativeSetter.call(element, objectUrlByAsset[key]);
            return;
        }

        handleRequest(absUrl, function () {
            return networkFetch(absUrl);
        })
            .then(function (response) {
                if (!response || !response.ok) {
                    throw new Error('dom src fetch failed');
                }
                return objectUrlFromResponse(response, absUrl, element);
            })
            .then(function (blobUrl) {
                nativeSetter.call(element, blobUrl);
            })
            .catch(function (err) {
                log().debug('dom src intercept fallback', url, err);
                nativeSetter.call(element, url);
            });
    }

    function findSrcAccessor(proto) {
        let p = proto;
        while (p && p !== Object.prototype) {
            const desc = Object.getOwnPropertyDescriptor(p, 'src');
            if (desc && typeof desc.set === 'function' && typeof desc.get === 'function') {
                return desc;
            }
            p = Object.getPrototypeOf(p);
        }
        return null;
    }

    function patchSrcProperty(proto, flagName, label) {
        if (!proto || global[flagName]) {
            return;
        }
        const desc = findSrcAccessor(proto);
        if (!desc) {
            log().warn('cannot patch ' + label + '.src: no accessor');
            return;
        }
        global[flagName] = true;
        Object.defineProperty(proto, 'src', {
            configurable: true,
            enumerable: desc.enumerable !== false,
            get: function () {
                return desc.get.call(this);
            },
            set: function (url) {
                rewriteDomSrc(this, url, desc.set);
            },
        });
        log().info('page ' + label + '.src intercept installed');
    }

    function patchSetAttributeSrc(proto, flagName, label) {
        if (!proto || !proto.setAttribute || global[flagName]) {
            return;
        }
        global[flagName] = true;
        const originalSetAttribute = proto.setAttribute;
        proto.setAttribute = function (name, value) {
            if (String(name).toLowerCase() === 'src') {
                const el = this;
                rewriteDomSrc(el, value, function (nextUrl) {
                    originalSetAttribute.call(el, 'src', nextUrl);
                });
                return;
            }
            return originalSetAttribute.apply(this, arguments);
        };
        log().info('page ' + label + '.setAttribute(src) intercept installed');
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
            const method = String(
                (init && init.method) ||
                    (input && typeof input === 'object' && input.method) ||
                    'GET',
            ).toUpperCase();
            if (method !== 'GET') {
                return originalFetch(input, init);
            }
            const url =
                typeof input === 'string'
                    ? input
                    : input && input.url
                      ? input.url
                      : String(input);
            return handleRequest(canonicalizeUrl(url), function () {
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
        xhrOverrideMimeType = proto.overrideMimeType;

        proto.open = function (method, url) {
            this.__bzMethod = method;
            this.__bzUrl = url;
            // download-file.ts 始终 async=true
            this.__bzAsync = arguments.length < 3 || arguments[2] !== false;
            this.__bzHeaders = null;
            this.__bzMime = null;
            return xhrOpen.apply(this, arguments);
        };

        proto.setRequestHeader = function (name, value) {
            if (!this.__bzHeaders) {
                this.__bzHeaders = {};
            }
            this.__bzHeaders[name] = value;
            return xhrSetRequestHeader.apply(this, arguments);
        };

        if (typeof xhrOverrideMimeType === 'function') {
            proto.overrideMimeType = function (mime) {
                this.__bzMime = mime;
                return xhrOverrideMimeType.apply(this, arguments);
            };
        }

        proto.send = function (body) {
            const xhr = this;
            if (deferToSw || String(xhr.__bzMethod || 'GET').toUpperCase() !== 'GET') {
                return xhrSend.apply(xhr, arguments);
            }
            if (xhr.__bzAsync === false) {
                return xhrSend.apply(xhr, arguments);
            }
            const rawUrl = xhr.__bzUrl;
            const bundles = getAllBundles();
            if (!R().shouldInterceptAssetUrl(rawUrl, bundles)) {
                return xhrSend.apply(xhr, arguments);
            }

            const url = canonicalizeUrl(rawUrl);
            const fetchInit = {};
            if (xhr.withCredentials) {
                fetchInit.credentials = 'include';
            }
            if (xhr.__bzHeaders) {
                fetchInit.headers = xhr.__bzHeaders;
            }

            handleRequest(url, function () {
                return networkFetch(url, fetchInit);
            })
                .then(function (response) {
                    if (!response || !response.ok) {
                        throw new Error('xhr intercept bad response');
                    }
                    return objectUrlFromResponse(response, url, null).then(function (blobUrl) {
                        const prevType = xhr.responseType;
                        const prevCred = xhr.withCredentials;
                        const prevTimeout = xhr.timeout;
                        const prevMime = xhr.__bzMime;
                        // open() 会重置 XHR；必须恢复 responseType / mime
                        //（download-file 依赖 xhrResponseType=json|arraybuffer|blob|text）
                        xhrOpen.call(xhr, 'GET', blobUrl, true);
                        try {
                            if (prevType) {
                                xhr.responseType = prevType;
                            }
                            xhr.withCredentials = prevCred;
                            if (typeof prevTimeout === 'number' && prevTimeout > 0) {
                                xhr.timeout = prevTimeout;
                            }
                            if (prevMime && xhr.overrideMimeType) {
                                xhr.overrideMimeType(prevMime);
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

    function patchDomLoaders() {
        // 3.8.5：allowImageBitmap 默认 false → 主路径 HTMLImageElement.src
        if (global.HTMLImageElement) {
            patchSrcProperty(
                global.HTMLImageElement.prototype,
                '__bundleZipperImageSrcPatched',
                'HTMLImageElement',
            );
            patchSetAttributeSrc(
                global.HTMLImageElement.prototype,
                '__bundleZipperImageAttrPatched',
                'HTMLImageElement',
            );
        }
        // 3.8.5：download-script → HTMLScriptElement.src（bundle index.*.js）
        if (global.HTMLScriptElement) {
            patchSrcProperty(
                global.HTMLScriptElement.prototype,
                '__bundleZipperScriptSrcPatched',
                'HTMLScriptElement',
            );
            patchSetAttributeSrc(
                global.HTMLScriptElement.prototype,
                '__bundleZipperScriptAttrPatched',
                'HTMLScriptElement',
            );
        }
        // pal/audio/web/player-dom.ts → HTMLAudioElement.src
        if (global.HTMLAudioElement) {
            patchSrcProperty(
                global.HTMLAudioElement.prototype,
                '__bundleZipperAudioSrcPatched',
                'HTMLAudioElement',
            );
            patchSetAttributeSrc(
                global.HTMLAudioElement.prototype,
                '__bundleZipperAudioAttrPatched',
                'HTMLAudioElement',
            );
        }
    }

    function install(options) {
        options = options || {};
        deferToSw = !!options.deferToServiceWorker;
        if (deferToSw) {
            log().info('page network intercept deferred to SW');
            return;
        }
        patchFetch();
        patchXhr();
        patchDomLoaders();
    }

    function setDeferToServiceWorker(enabled) {
        deferToSw = !!enabled;
        if (!deferToSw) {
            patchFetch();
            patchXhr();
            patchDomLoaders();
        }
    }

    api().Network = {
        install: install,
        setDeferToServiceWorker: setDeferToServiceWorker,
        handleRequest: handleRequest,
    };
})(typeof window !== 'undefined' ? window : self);
