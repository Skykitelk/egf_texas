/**
 * Bundle Zipper 共享运行时：常量、日志、URL/版本辅助
 */
(function (global) {
    const CACHE_PREFIX = '__bundle_zipper__.';
    const META_CACHE = '__bundle_zipper_meta__';
    const META_URL = 'https://bundle-zipper.local/__meta__';
    const STABLE_ORIGIN = 'https://bundle-zipper.local';
    const LEGACY_ENGINE_PREFIX = '__bundle_zipper_engine__.';
    const LS_CONFIRMED = 'BundleZipper.confirmedSnapshot';

    /** 仅地址栏 ?bzdebug=1 开启明细日志（不再支持 localStorage） */
    function isDebugEnabled() {
        try {
            if (typeof global.location !== 'undefined' && global.location.search) {
                if (/[?&]bzdebug=1(?:&|$)/.test(global.location.search)) {
                    return true;
                }
            }
        } catch (_) {}
        return false;
    }

    const Logger = {
        info: function () {
            console.info.apply(console, ['[BundleZipper]'].concat(Array.prototype.slice.call(arguments)));
        },
        warn: function () {
            console.warn.apply(console, ['[BundleZipper]'].concat(Array.prototype.slice.call(arguments)));
        },
        error: function () {
            console.error.apply(console, ['[BundleZipper]'].concat(Array.prototype.slice.call(arguments)));
        },
        debug: function () {
            if (!isDebugEnabled()) {
                return;
            }
            // 用 log 而非 console.debug：Chrome 默认隐藏 Verbose
            console.log.apply(console, ['[BundleZipper][debug]'].concat(Array.prototype.slice.call(arguments)));
        },
        isDebugEnabled: isDebugEnabled,
    };

    function buildCacheName(bundleName, version) {
        return CACHE_PREFIX + bundleName + '.' + version;
    }

    function parseCacheKey(key) {
        if (!key || key.indexOf(CACHE_PREFIX) !== 0) {
            return null;
        }
        const rest = key.substring(CACHE_PREFIX.length);
        const dot = rest.lastIndexOf('.');
        if (dot <= 0) {
            return null;
        }
        return { name: rest.substring(0, dot), version: rest.substring(dot + 1) };
    }

    function isManagedCacheKey(key) {
        return key === META_CACHE || (key && key.indexOf(CACHE_PREFIX) === 0);
    }

    function isLegacyEngineCacheKey(key) {
        return !!key && key.indexOf(LEGACY_ENGINE_PREFIX) === 0;
    }

    function resolveBaseRoute() {
        if (typeof global.location === 'undefined') {
            return './';
        }
        const pathname = global.location.pathname || '/';
        if (pathname.endsWith('/')) {
            return pathname;
        }
        const lastSlash = pathname.lastIndexOf('/');
        return pathname.substring(0, lastSlash + 1);
    }

    function getBaseHref() {
        if (typeof global.location === 'undefined') {
            return 'https://bundle-zipper.local/';
        }
        return new URL(resolveBaseRoute(), global.location.href).href;
    }

    function normalizeRequestUrl(requestUrl, baseHref) {
        try {
            const u = new URL(requestUrl, baseHref || getBaseHref());
            u.hash = '';
            return u.href;
        } catch (_) {
            return String(requestUrl || '');
        }
    }

    function assetsRootPath() {
        return resolveBaseRoute() + 'assets/';
    }

    function isBundleZipUrl(requestUrl) {
        const normalized = normalizeRequestUrl(requestUrl);
        try {
            return /\.zip$/i.test(new URL(normalized).pathname);
        } catch (_) {
            return /\.zip$/i.test(normalized);
        }
    }

    function getBundleNames(allBundles) {
        return Object.keys(allBundles || {});
    }

    /**
     * 从 URL 推断所属 bundle（路径含 /assets/{bundle}/ 或 cache 前缀语义）
     */
    function resolveBundleFromUrl(requestUrl, allBundles) {
        const normalized = normalizeRequestUrl(requestUrl);
        let pathname = normalized;
        try {
            pathname = new URL(normalized).pathname;
        } catch (_) {}
        const marker = '/assets/';
        const idx = pathname.indexOf(marker);
        if (idx < 0) {
            return null;
        }
        const rest = pathname.substring(idx + marker.length);
        const slash = rest.indexOf('/');
        const maybeName = slash >= 0 ? rest.substring(0, slash) : rest;
        if (!maybeName || maybeName.indexOf('.') >= 0) {
            // assets/hall.abc123.zip 不是资源路径
            return null;
        }
        if (allBundles && !Object.prototype.hasOwnProperty.call(allBundles, maybeName)) {
            return null;
        }
        return maybeName;
    }

    function shouldInterceptAssetUrl(requestUrl, allBundles) {
        if (isBundleZipUrl(requestUrl)) {
            return false;
        }
        return !!resolveBundleFromUrl(requestUrl, allBundles);
    }

    function zipUrlForBundle(bundleName, version, cdnAddress) {
        const relative = 'assets/' + bundleName + '.' + version + '.zip';
        if (cdnAddress) {
            return cdnAddress.replace(/\/+$/, '') + '/' + relative;
        }
        return new URL(relative, getBaseHref()).href;
    }

    function resourceUrlInBundle(bundleName, relativePath) {
        let path = String(relativePath || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, '');
        if (!path || path.indexOf('\0') >= 0) {
            return '';
        }
        const parts = path.split('/');
        for (let i = 0; i < parts.length; i++) {
            if (!parts[i] || parts[i] === '.' || parts[i] === '..') {
                return '';
            }
        }
        return new URL('assets/' + bundleName + '/' + path, getBaseHref()).href;
    }

    /**
     * 稳定资源路径（与部署目录/域名无关）
     * 例：http://host/foo/web-mobile/assets/main/a.png → /assets/main/a.png
     */
    function toStableCachePath(requestUrl) {
        const normalized = normalizeRequestUrl(requestUrl);
        let pathname = '';
        try {
            pathname = new URL(normalized).pathname || '';
        } catch (_) {
            pathname = String(normalized || '');
        }
        pathname = pathname.replace(/\\/g, '/');
        // 兼容已是路径或带稳定 origin 的键
        if (pathname.indexOf('/assets/') === 0) {
            return pathname;
        }
        if (String(normalized).indexOf(STABLE_ORIGIN + '/assets/') === 0) {
            return String(normalized).substring(STABLE_ORIGIN.length);
        }
        const marker = '/assets/';
        const idx = pathname.indexOf(marker);
        if (idx < 0) {
            // 纯相对：assets/...
            if (pathname.indexOf('assets/') === 0) {
                return '/' + pathname;
            }
            const bare = String(normalized || '');
            if (bare.indexOf('/assets/') === 0) {
                return bare.split('?')[0].split('#')[0];
            }
            if (bare.indexOf('assets/') === 0) {
                return '/' + bare.split('?')[0].split('#')[0];
            }
            return '';
        }
        return pathname.substring(idx);
    }

    /**
     * Cache API 用的稳定 URL（必须是合法绝对 URL）
     * 例：/assets/main/a.png → https://bundle-zipper.local/assets/main/a.png
     */
    function toStableCacheUrl(requestUrl) {
        const assetPath = toStableCachePath(requestUrl);
        if (!assetPath) {
            return '';
        }
        return STABLE_ORIGIN + assetPath;
    }

    /**
     * 按存储后端选择写入键：IndexedDB/Memory 用路径；Cache API 用稳定绝对 URL
     */
    function toStorageEntryKey(requestUrl, storageKind) {
        const path = toStableCachePath(requestUrl);
        if (!path) {
            return normalizeRequestUrl(requestUrl);
        }
        if (storageKind === 'cache') {
            return STABLE_ORIGIN + path;
        }
        return path;
    }

    /** 判断某条已存 key 是否对应同一资源（兼容旧绝对 URL / 稳定 URL / 路径） */
    function cacheUrlsReferSameAsset(a, b) {
        const pa = toStableCachePath(a);
        const pb = toStableCachePath(b);
        if (pa && pb) {
            return pa === pb;
        }
        return normalizeRequestUrl(a) === normalizeRequestUrl(b);
    }

    function fingerprintBundles(bundles) {
        const keys = Object.keys(bundles || {}).sort();
        const parts = [];
        for (let i = 0; i < keys.length; i++) {
            parts.push(keys[i] + '=' + bundles[keys[i]]);
        }
        return parts.join('&');
    }

    function buildConfirmedSnapshot(runtimeVersion, initBundles, allBundles) {
        const initMap = {};
        const list = initBundles || [];
        for (let i = 0; i < list.length; i++) {
            const name = list[i];
            if (allBundles && allBundles[name]) {
                initMap[name] = allBundles[name];
            }
        }
        return {
            runtimeVersion: runtimeVersion || '',
            initBundles: initMap,
            allBundlesFp: fingerprintBundles(allBundles),
        };
    }

    function readConfirmedSnapshot() {
        try {
            if (typeof global.localStorage === 'undefined') {
                return null;
            }
            const raw = global.localStorage.getItem(LS_CONFIRMED);
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    function writeConfirmedSnapshot(snapshot) {
        try {
            if (typeof global.localStorage === 'undefined') {
                return;
            }
            global.localStorage.setItem(LS_CONFIRMED, JSON.stringify(snapshot));
        } catch (err) {
            Logger.warn('writeConfirmedSnapshot failed', err);
        }
    }

    function snapshotsEqual(a, b) {
        if (!a || !b) {
            return false;
        }
        if (a.runtimeVersion !== b.runtimeVersion) {
            return false;
        }
        if (a.allBundlesFp !== b.allBundlesFp) {
            return false;
        }
        const ai = a.initBundles || {};
        const bi = b.initBundles || {};
        const keys = Object.keys(ai);
        if (keys.length !== Object.keys(bi).length) {
            return false;
        }
        for (let i = 0; i < keys.length; i++) {
            if (ai[keys[i]] !== bi[keys[i]]) {
                return false;
            }
        }
        return true;
    }

    function isQuotaError(err) {
        if (!err) {
            return false;
        }
        const name = err.name || '';
        const msg = String(err.message || err);
        return (
            name === 'QuotaExceededError' ||
            name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            /quota/i.test(msg)
        );
    }

    const MIMEMAP = {
        json: 'application/json',
        js: 'application/javascript',
        css: 'text/css',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        html: 'text/html',
        bin: 'application/octet-stream',
        mp3: 'audio/mpeg',
        wasm: 'application/wasm',
        astc: 'application/octet-stream',
        pkm: 'application/octet-stream',
        pvr: 'application/octet-stream',
    };

    function getFileMime(fileName) {
        const ext = fileName.substr(fileName.lastIndexOf('.') + 1).toLowerCase();
        return MIMEMAP[ext] || 'application/octet-stream';
    }

    /**
     * 插件对外唯一全局根：window.WebBundleZipper（SW 下为 self.WebBundleZipper）
     * 配置、业务 API、回调均挂在此对象下，避免污染顶层全局。
     */
    function getApi() {
        if (!global.WebBundleZipper) {
            global.WebBundleZipper = {};
        }
        return global.WebBundleZipper;
    }

    // 唯一全局根：WebBundleZipper；内部模块均挂其子属性
    getApi().Runtime = {
        CACHE_PREFIX: CACHE_PREFIX,
        META_CACHE: META_CACHE,
        META_URL: META_URL,
        STABLE_ORIGIN: STABLE_ORIGIN,
        LEGACY_ENGINE_PREFIX: LEGACY_ENGINE_PREFIX,
        LS_CONFIRMED: LS_CONFIRMED,
        Logger: Logger,
        getApi: getApi,
        buildCacheName: buildCacheName,
        parseCacheKey: parseCacheKey,
        isManagedCacheKey: isManagedCacheKey,
        isLegacyEngineCacheKey: isLegacyEngineCacheKey,
        resolveBaseRoute: resolveBaseRoute,
        getBaseHref: getBaseHref,
        normalizeRequestUrl: normalizeRequestUrl,
        assetsRootPath: assetsRootPath,
        isBundleZipUrl: isBundleZipUrl,
        getBundleNames: getBundleNames,
        resolveBundleFromUrl: resolveBundleFromUrl,
        shouldInterceptAssetUrl: shouldInterceptAssetUrl,
        zipUrlForBundle: zipUrlForBundle,
        resourceUrlInBundle: resourceUrlInBundle,
        toStableCachePath: toStableCachePath,
        toStableCacheUrl: toStableCacheUrl,
        toStorageEntryKey: toStorageEntryKey,
        cacheUrlsReferSameAsset: cacheUrlsReferSameAsset,
        fingerprintBundles: fingerprintBundles,
        buildConfirmedSnapshot: buildConfirmedSnapshot,
        readConfirmedSnapshot: readConfirmedSnapshot,
        writeConfirmedSnapshot: writeConfirmedSnapshot,
        snapshotsEqual: snapshotsEqual,
        isQuotaError: isQuotaError,
        getFileMime: getFileMime,
    };
})(typeof self !== 'undefined' ? self : window);
