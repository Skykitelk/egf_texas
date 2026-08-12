/**
 * Bundle zip 下载、解压、CacheStorage 缓存 —— SW 与页面兜底共用核心
 */
(function (global) {
    const COMPLETE_URL = 'https://bundle-zipper.local/__complete__';
    const META_CACHE = '__bundle_zipper_meta__';
    const META_URL = 'https://bundle-zipper.local/__meta__';
    const CACHE_PREFIX = '__bundle_zipper__.';
    const LEGACY_ENGINE_CACHE_PREFIX = '__bundle_zipper_engine__.';
    const LS_DEBUG = 'BundleZipper.debug';

    function isDebugEnabled() {
        try {
            if (typeof global.location !== 'undefined' && global.location.search) {
                if (/[?&]bzdebug=1(?:&|$)/.test(global.location.search)) {
                    return true;
                }
            }
        } catch {
            // ignore
        }
        try {
            if (typeof global.localStorage !== 'undefined' && global.localStorage.getItem(LS_DEBUG) === '1') {
                return true;
            }
        } catch {
            // ignore
        }
        return false;
    }

    const Logger = {
        isDebug: isDebugEnabled,
        info: function () {
            const args = Array.prototype.slice.call(arguments);
            console.info.apply(console, ['[BundleZipper]'].concat(args));
        },
        warn: function () {
            const args = Array.prototype.slice.call(arguments);
            console.warn.apply(console, ['[BundleZipper]'].concat(args));
        },
        error: function () {
            const args = Array.prototype.slice.call(arguments);
            console.error.apply(console, ['[BundleZipper]'].concat(args));
        },
        debug: function () {
            if (!isDebugEnabled()) {
                return;
            }
            const args = Array.prototype.slice.call(arguments);
            console.debug.apply(console, ['[BundleZipper]'].concat(args));
        },
    };

    function buildCacheName(bundleName, version) {
        return CACHE_PREFIX + bundleName + '.' + version;
    }

    function isLegacyEngineCacheKey(key) {
        return !!key && key.indexOf(LEGACY_ENGINE_CACHE_PREFIX) === 0;
    }

    function isManagedCacheKey(key) {
        return key === META_CACHE || key.indexOf(CACHE_PREFIX) === 0;
    }

    function isPurgeableCacheKey(key) {
        if (!key) {
            return false;
        }
        if (isManagedCacheKey(key) || isLegacyEngineCacheKey(key)) {
            return true;
        }
        return !!parseLegacyCacheKey(key);
    }

    async function purgeLegacyEngineCaches() {
        if (!global.caches || !global.caches.keys) {
            return;
        }
        const keys = await global.caches.keys();
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!isLegacyEngineCacheKey(key)) {
                continue;
            }
            try {
                await global.caches.delete(key);
                Logger.info('legacy engine cache purged', key);
            } catch (err) {
                Logger.warn('legacy engine cache purge failed', key, err);
            }
        }
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
        const ext = fileName.substr(fileName.lastIndexOf('.') + 1);
        return MIMEMAP[ext] || 'application/octet-stream';
    }

    function joinOriginPath(origin, routePath) {
        if (!origin) {
            return routePath;
        }
        const base = origin.replace(/\/+$/, '');
        const path = routePath.replace(/^\/+/, '');
        return base + '/' + path;
    }

    function parseCacheKey(key) {
        if (key === META_CACHE) {
            return null;
        }
        let rest = key;
        if (key.indexOf(CACHE_PREFIX) === 0) {
            rest = key.substring(CACHE_PREFIX.length);
        } else {
            return null;
        }
        const lastDot = rest.lastIndexOf('.');
        if (lastDot <= 0) {
            return null;
        }
        return {
            name: rest.substring(0, lastDot),
            version: rest.substring(lastDot + 1),
        };
    }

    function parseLegacyCacheKey(key) {
        if (!key || key === META_CACHE || key.indexOf(CACHE_PREFIX) === 0) {
            return null;
        }
        if (key.indexOf('://') >= 0 || key.indexOf('/') >= 0) {
            return null;
        }
        const lastDot = key.lastIndexOf('.');
        if (lastDot <= 0) {
            return null;
        }
        return {
            name: key.substring(0, lastDot),
            version: key.substring(lastDot + 1),
        };
    }

    function normalizeRequestUrl(url, baseHref) {
        if (!url || typeof url !== 'string') {
            return '';
        }
        try {
            if (url.indexOf('://') >= 0 || url.indexOf('//') === 0) {
                return new URL(url).href;
            }
            const base = baseHref || (typeof global.location !== 'undefined' ? global.location.href : '');
            if (!base) {
                return url;
            }
            return new URL(url, base).href;
        } catch {
            return url;
        }
    }

    function isSafeZipEntry(relativePath) {
        if (!relativePath || relativePath.indexOf('\0') >= 0) {
            return false;
        }
        const normalized = relativePath.replace(/\\/g, '/');
        if (normalized.indexOf('://') >= 0 || normalized.startsWith('/')) {
            return false;
        }
        const parts = normalized.split('/');
        for (let i = 0; i < parts.length; i++) {
            if (parts[i] === '..') {
                return false;
            }
        }
        return true;
    }

    function isQuotaError(err) {
        if (!err) {
            return false;
        }
        return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED';
    }

    /** postMessage 无法克隆 Error，序列化为普通对象 */
    function serializeError(err) {
        if (!err) {
            return { message: 'unknown error', name: 'Error' };
        }
        if (typeof err === 'string') {
            return { message: err, name: 'Error' };
        }
        return {
            message: err.message || String(err),
            name: err.name || 'Error',
            stack: err.stack || '',
        };
    }

    function deserializeError(err) {
        if (err instanceof Error) {
            return err;
        }
        if (err && typeof err === 'object' && err.message) {
            const e = new Error(err.message);
            if (err.name) {
                e.name = err.name;
            }
            if (err.stack) {
                e.stack = err.stack;
            }
            return e;
        }
        return new Error(String(err));
    }

    function unzipFilesAsync(fflate, buffer) {
        return new Promise((resolve, reject) => {
            if (typeof fflate.unzip === 'function') {
                fflate.unzip(buffer, (err, files) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(files);
                    }
                });
                return;
            }
            try {
                resolve(fflate.unzipSync(buffer));
            } catch (err) {
                reject(err);
            }
        });
    }

    function createBundleCache(options) {
        const cachesApi = options.caches;
        const fflate = options.fflate;
        const getRootRoute = options.getRootRoute;
        const getFetchOrigin = options.getFetchOrigin;
        const getBaseHref = options.getBaseHref || function () {
            return typeof global.location !== 'undefined' ? global.location.href : '';
        };
        const getKnownBundles = options.getKnownBundles || function () {
            return {};
        };
        const useAsyncUnzip = !!options.useAsyncUnzip;
        const notify = options.notify || function () {};

        const cachedBundles = new Map();
        const cacheHandles = {};
        const cachePathIndex = {};

        function normalizeCacheKey(key) {
            if (!key) {
                return '';
            }
            let value = String(key).split('?')[0];
            if (value.indexOf('://') >= 0) {
                try {
                    value = new URL(value).pathname;
                } catch {
                    // keep value
                }
            }
            try {
                value = decodeURIComponent(value);
            } catch {
                // keep value
            }
            if (value.charAt(0) !== '/') {
                value = '/' + value;
            }
            return value;
        }

        function clearCacheHandle(cacheName) {
            delete cacheHandles[cacheName];
            delete cachePathIndex[cacheName];
        }

        async function refreshCachePathIndex(cacheName) {
            const cache = await openCache(cacheName);
            const keys = await cache.keys();
            const index = Object.create(null);
            for (let i = 0; i < keys.length; i++) {
                const storedKey = keys[i];
                if (storedKey === COMPLETE_URL || storedKey === META_URL) {
                    continue;
                }
                index[normalizeCacheKey(storedKey)] = storedKey;
            }
            cachePathIndex[cacheName] = index;
        }

        async function resolveStoredCacheKey(cacheName, lookupKey) {
            const index = cachePathIndex[cacheName];
            if (!index) {
                return lookupKey;
            }
            const normalized = normalizeCacheKey(lookupKey);
            return index[normalized] || lookupKey;
        }

        async function openCache(cacheName) {
            if (!cacheHandles[cacheName]) {
                cacheHandles[cacheName] = await cachesApi.open(cacheName);
            }
            return cacheHandles[cacheName];
        }

        function toAssetPathname(relativePath) {
            const rootRoute = getRootRoute();
            let path = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
            if (path.indexOf('assets/') === 0) {
                return '/' + path;
            }
            path = rootRoute + path;
            return path.charAt(0) === '/' ? path : '/' + path;
        }

        function buildCacheRequest(relativePath) {
            // 使用 pathname 作为稳定 cache key（IndexedDB 精确匹配；避免 origin/query 差异）
            return toAssetPathname(relativePath);
        }

        function cacheLookupKeys(requestUrl) {
            const normalized = normalizeRequestUrl(requestUrl, getBaseHref());
            const keys = [];
            const push = function (key) {
                if (key && keys.indexOf(key) < 0) {
                    keys.push(key);
                }
            };
            push(normalized);
            if (requestUrl && requestUrl !== normalized) {
                push(normalizeRequestUrl(requestUrl, getBaseHref()));
            }
            try {
                const pathname = new URL(normalized).pathname;
                push(pathname);
                try {
                    push(decodeURIComponent(pathname));
                } catch {
                    // keep pathname only
                }
            } catch {
                push(String(normalized).split('?')[0]);
            }
            return keys;
        }

        async function matchInCache(cache, cacheName, requestUrl) {
            const keys = cacheLookupKeys(requestUrl);
            for (let i = 0; i < keys.length; i++) {
                let cached = await cache.match(keys[i]);
                if (cached) {
                    return cached;
                }
                const storedKey = await resolveStoredCacheKey(cacheName, keys[i]);
                if (storedKey !== keys[i]) {
                    cached = await cache.match(storedKey);
                    if (cached) {
                        return cached;
                    }
                }
            }
            return null;
        }

        async function isBundleComplete(cacheName) {
            if (!(await cachesApi.has(cacheName))) {
                return false;
            }
            const cache = await openCache(cacheName);
            return !!(await cache.match(COMPLETE_URL));
        }

        async function readMeta() {
            if (!(await cachesApi.has(META_CACHE))) {
                return null;
            }
            const cache = await openCache(META_CACHE);
            const res = await cache.match(META_URL);
            if (!res) {
                return null;
            }
            try {
                return await res.json();
            } catch {
                return null;
            }
        }

        async function writeMeta(meta) {
            const cache = await openCache(META_CACHE);
            await cache.put(
                META_URL,
                new Response(JSON.stringify(meta), {
                    headers: { 'Content-Type': 'application/json' },
                }),
            );
        }

        async function unzipToCache(buffer, cache, onProgress) {
            let files;
            if (useAsyncUnzip) {
                files = await unzipFilesAsync(fflate, buffer);
            } else {
                files = fflate.unzipSync(buffer);
            }

            const names = Object.keys(files);
            if (!names.length) {
                throw new Error('zip is empty');
            }

            const safeNames = [];
            for (let i = 0; i < names.length; i++) {
                if (isSafeZipEntry(names[i])) {
                    safeNames.push(names[i]);
                } else {
                    Logger.warn('skip unsafe zip entry:', names[i]);
                }
            }

            if (!safeNames.length) {
                throw new Error('zip contains no safe entries');
            }

            const total = safeNames.length;
            for (let i = 0; i < safeNames.length; i++) {
                const relativePath = safeNames[i];
                await cache.put(
                    buildCacheRequest(relativePath),
                    new Response(files[relativePath], {
                        headers: { 'Content-Type': getFileMime(relativePath) },
                    }),
                );
                onProgress(i + 1, total);
            }
        }

        async function finalizeBundleCache(cacheName) {
            await refreshCachePathIndex(cacheName);
        }

        async function readResponseBody(response, onProgress) {
            if (!response.body || !response.body.getReader) {
                const buffer = await response.arrayBuffer();
                onProgress(0.5);
                return new Uint8Array(buffer);
            }

            const reader = response.body.getReader();
            const totalBytes = +(response.headers.get('Content-Length') || 0);
            const chunks = [];
            let received = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                chunks.push(value);
                received += value.length;
                if (totalBytes > 0) {
                    onProgress(received / totalBytes / 2);
                }
            }

            const buffer = new Uint8Array(received);
            let offset = 0;
            for (const chunk of chunks) {
                buffer.set(chunk, offset);
                offset += chunk.length;
            }
            return buffer;
        }

        async function withInstallLock(bundleName, fn) {
            const lockName = 'bundle-zipper-install-' + bundleName;
            if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
                return navigator.locks.request(lockName, fn);
            }
            return fn();
        }

        async function purgeOldVersions(bundleName, keepVersion) {
            const keys = await cachesApi.keys();
            await Promise.all(
                keys.map((key) => {
                    const parsed = parseCacheKey(key) || parseLegacyCacheKey(key);
                    if (parsed && parsed.name === bundleName && parsed.version !== keepVersion) {
                        clearCacheHandle(key);
                        cachedBundles.delete(bundleName);
                        return cachesApi.delete(key);
                    }
                    return Promise.resolve();
                }),
            );
        }

        async function purgeBundleAllVersions(bundleName) {
            const keys = await cachesApi.keys();
            await Promise.all(
                keys.map((key) => {
                    const parsed = parseCacheKey(key) || parseLegacyCacheKey(key);
                    if (parsed && parsed.name === bundleName) {
                        clearCacheHandle(key);
                        cachedBundles.delete(bundleName);
                        return cachesApi.delete(key);
                    }
                    return Promise.resolve();
                }),
            );
        }

        async function purgeStale(knownBundles) {
            Logger.info('purgeStale', knownBundles);
            const keys = await cachesApi.keys();
            await Promise.all(
                keys.map((key) => {
                    let parsed = parseCacheKey(key);
                    if (!parsed) {
                        parsed = parseLegacyCacheKey(key);
                    }
                    if (!parsed) {
                        return Promise.resolve();
                    }
                    if (knownBundles[parsed.name] === parsed.version) {
                        return Promise.resolve();
                    }
                    clearCacheHandle(key);
                    cachedBundles.delete(parsed.name);
                    return cachesApi.delete(key);
                }),
            );
        }

        async function purgeEverything() {
            Logger.info('purgeEverything');
            const keys = await cachesApi.keys();
            const toDelete = keys.filter((key) => isPurgeableCacheKey(key));
            for (let i = 0; i < toDelete.length; i++) {
                clearCacheHandle(toDelete[i]);
            }
            cachedBundles.clear();
            for (const indexKey in cachePathIndex) {
                if (Object.prototype.hasOwnProperty.call(cachePathIndex, indexKey)) {
                    delete cachePathIndex[indexKey];
                }
            }
            await Promise.all(toDelete.map((key) => cachesApi.delete(key)));
            notify('purgeComplete', {});
        }

        async function purgeAll() {
            return purgeEverything();
        }

        async function installBundleInner(bundleName, version, quotaRetried) {
            const cacheName = buildCacheName(bundleName, version);
            const rootRoute = getRootRoute();
            const fetchOrigin = getFetchOrigin();
            const zipPath = rootRoute + bundleName + '.' + version + '.zip';
            const zipUrl = joinOriginPath(fetchOrigin, zipPath);

            if (await isBundleComplete(cacheName)) {
                Logger.info('installBundle cache hit', bundleName, version);
                cachedBundles.set(bundleName, cacheName);
                await refreshCachePathIndex(cacheName);
                await purgeOldVersions(bundleName, version);
                notify('installProgress', { bundle: bundleName, version, percent: 1 });
                return;
            }

            if (await cachesApi.has(cacheName)) {
                await cachesApi.delete(cacheName);
                clearCacheHandle(cacheName);
            }

            try {
                Logger.info('installBundle downloading', bundleName, version, zipUrl);
                const response = await fetch(zipUrl);
                if (!response.ok) {
                    throw new Error('Failed to fetch bundle zip: ' + zipUrl);
                }

                const buffer = await readResponseBody(response, (percent) => {
                    notify('installProgress', { bundle: bundleName, version, percent });
                });
                notify('installProgress', { bundle: bundleName, version, percent: 0.5 });

                const cache = await openCache(cacheName);
                await unzipToCache(buffer, cache, (done, total) => {
                    const percent = 0.5 + done / total / 2;
                    if (percent < 1) {
                        notify('installProgress', { bundle: bundleName, version, percent });
                    }
                });

                await cache.put(COMPLETE_URL, new Response('1'));
                cachedBundles.set(bundleName, cacheName);
                await finalizeBundleCache(cacheName);
                await purgeOldVersions(bundleName, version);
                Logger.info('installBundle complete', bundleName, version);
                notify('installProgress', { bundle: bundleName, version, percent: 1 });
            } catch (error) {
                await cachesApi.delete(cacheName);
                clearCacheHandle(cacheName);

                if (!quotaRetried && isQuotaError(error)) {
                    Logger.warn('Cache quota exceeded, purging stale and retrying:', bundleName);
                    await purgeStale(getKnownBundles());
                    return installBundleInner(bundleName, version, true);
                }

                const wrapped = isQuotaError(error)
                    ? new Error('Cache storage full, please clear browser cache and retry')
                    : error;
                notify('installError', {
                    bundle: bundleName,
                    version,
                    error: serializeError(wrapped),
                });
                Logger.error('bundle install error', bundleName, wrapped);
                throw wrapped;
            }
        }

        async function installBundle(bundleName, version) {
            if (!bundleName || !version) {
                const err = new Error('invalid bundle name or version: ' + bundleName);
                notify('installError', {
                    bundle: bundleName,
                    version: version,
                    error: serializeError(err),
                });
                throw err;
            }
            return withInstallLock(bundleName, () => installBundleInner(bundleName, version, false));
        }

        async function ensureCachedBundlesLoaded() {
            if (cachedBundles.size > 0) {
                return;
            }
            const keys = await cachesApi.keys();
            for (const key of keys) {
                const parsed = parseCacheKey(key) || parseLegacyCacheKey(key);
                if (!parsed || !(await isBundleComplete(key))) {
                    continue;
                }
                const existing = cachedBundles.get(parsed.name);
                if (!existing || key.indexOf(CACHE_PREFIX) === 0) {
                    cachedBundles.set(parsed.name, key);
                    await refreshCachePathIndex(key);
                }
            }
        }

        function urlBelongsToBundle(requestUrl, bundleName) {
            const normalized = normalizeRequestUrl(requestUrl, getBaseHref());
            const rootRoute = getRootRoute();
            let pathname = normalized;
            try {
                pathname = new URL(normalized).pathname;
            } catch {
                // keep
            }
            const prefix = rootRoute + bundleName + '/';
            return normalized.indexOf(prefix) >= 0 || pathname.indexOf(prefix) >= 0;
        }

        function isBundleZipUrl(requestUrl) {
            const normalized = normalizeRequestUrl(requestUrl, getBaseHref());
            let pathname = normalized;
            try {
                pathname = new URL(normalized).pathname;
            } catch {
                // keep normalized
            }
            const path = (pathname || normalized).split('?')[0];
            return /\.zip$/i.test(path);
        }

        function shouldInterceptAssetUrl(requestUrl) {
            if (isBundleZipUrl(requestUrl)) {
                return false;
            }
            const rootRoute = getRootRoute();
            const normalized = normalizeRequestUrl(requestUrl, getBaseHref());
            let pathname = normalized;
            try {
                pathname = new URL(normalized).pathname;
            } catch {
                return normalized.indexOf(rootRoute) >= 0 || normalized.indexOf('/assets/') >= 0;
            }
            if (pathname.indexOf(rootRoute) >= 0) {
                return true;
            }
            if (getFetchOrigin() && pathname.indexOf('/assets/') >= 0) {
                return true;
            }
            return false;
        }

        async function matchCachedResponse(requestUrl) {
            if (!shouldInterceptAssetUrl(requestUrl)) {
                return null;
            }
            await ensureCachedBundlesLoaded();

            for (const [bundleName, cacheName] of cachedBundles) {
                if (!urlBelongsToBundle(requestUrl, bundleName)) {
                    continue;
                }
                const cache = await openCache(cacheName);
                const cached = await matchInCache(cache, cacheName, requestUrl);
                if (cached) {
                    Logger.debug('cache hit', bundleName, requestUrl);
                    return cached.clone();
                }
                Logger.debug('cache miss in bundle', bundleName, requestUrl);
            }
            return null;
        }

        function resolveCdnUrl(requestUrl) {
            const fetchOrigin = getFetchOrigin();
            if (!fetchOrigin || !shouldInterceptAssetUrl(requestUrl)) {
                return null;
            }
            const rootRoute = getRootRoute();
            const normalized = normalizeRequestUrl(requestUrl, getBaseHref());
            let pathPart = normalized;
            try {
                pathPart = new URL(normalized).pathname + new URL(normalized).search;
            } catch {
                // use normalized
            }
            const routeIndex = normalized.indexOf(rootRoute);
            const pathIndex = pathPart.indexOf(rootRoute);
            const idx = routeIndex >= 0 ? routeIndex : pathIndex;
            if (idx < 0) {
                return null;
            }
            const suffix = idx === routeIndex ? normalized.substring(idx) : pathPart.substring(pathIndex);
            return joinOriginPath(fetchOrigin, suffix);
        }

        function metaRuntimeVersion(meta) {
            if (!meta) {
                return '';
            }
            return meta.runtimeVersion || meta.swVersion || '';
        }

        async function mergeMetaOnly(runtimeVersion, knownBundles) {
            const bundles = knownBundles || {};
            const meta = (await readMeta()) || {};
            Logger.info(
                'mergeMetaOnly',
                metaRuntimeVersion(meta) || '(none)',
                '->',
                runtimeVersion || '(none)',
            );
            const rv = runtimeVersion || metaRuntimeVersion(meta);
            await writeMeta({
                runtimeVersion: rv,
                swVersion: rv,
                bundles: bundles,
                updatedAt: Date.now(),
            });
            return true;
        }

        async function mergeBundles(runtimeVersion, knownBundles) {
            return mergeMetaOnly(runtimeVersion, knownBundles);
        }

        /** @deprecated v3：更新主路径改用 purgeEverything，不再按 diff 选择性 purge */
        async function applyConfirmedBundleUpdates(changedInit, changedNonInit, removed) {
            const purgeNames = [];
            const pushUnique = function (name) {
                if (name && purgeNames.indexOf(name) < 0) {
                    purgeNames.push(name);
                }
            };
            for (let i = 0; i < (changedInit || []).length; i++) {
                pushUnique(changedInit[i]);
            }
            for (let i = 0; i < (changedNonInit || []).length; i++) {
                pushUnique(changedNonInit[i]);
            }
            for (let i = 0; i < (removed || []).length; i++) {
                pushUnique(removed[i]);
            }
            for (let i = 0; i < purgeNames.length; i++) {
                Logger.info('applyConfirmedBundleUpdates purge', purgeNames[i]);
                await purgeBundleAllVersions(purgeNames[i]);
            }
            return true;
        }

        async function syncSwVersion(version, knownBundles) {
            return mergeMetaOnly(version, knownBundles || {});
        }

        async function bootstrap(runtimeVersion, knownBundles) {
            await mergeMetaOnly(runtimeVersion, knownBundles || {});
            await purgeLegacyEngineCaches();
            return true;
        }

        return {
            META_CACHE,
            COMPLETE_URL,
            installBundle,
            bootstrap,
            purgeStale,
            purgeOldVersions,
            purgeBundleAllVersions,
            purgeAll,
            purgeEverything,
            ensureCachedBundlesLoaded,
            matchCachedResponse,
            resolveCdnUrl,
            shouldInterceptAssetUrl,
            syncSwVersion,
            mergeBundles,
            mergeMetaOnly,
            applyConfirmedBundleUpdates,
            metaRuntimeVersion,
            readMeta,
            writeMeta,
            normalizeRequestUrl,
            getCachedBundles: () => cachedBundles,
            purgeLegacyEngineCaches,
        };
    }

    async function readMetaSnapshot(cachesApi) {
        if (!cachesApi) {
            return null;
        }
        try {
            if (!(await cachesApi.has(META_CACHE))) {
                return null;
            }
            const cache = await cachesApi.open(META_CACHE);
            const res = await cache.match(META_URL);
            if (!res) {
                return null;
            }
            return await res.json();
        } catch {
            return null;
        }
    }

    async function readMetaSwVersion(cachesApi) {
        const meta = await readMetaSnapshot(cachesApi);
        if (!meta) {
            return null;
        }
        return meta.runtimeVersion || meta.swVersion || null;
    }

    function diffBundles(target, cached) {
        const changed = [];
        const removed = [];
        target = target || {};
        cached = cached || {};
        for (const name in target) {
            if (!Object.prototype.hasOwnProperty.call(target, name)) {
                continue;
            }
            if (!cached[name] || cached[name] !== target[name]) {
                changed.push(name);
            }
        }
        for (const name in cached) {
            if (!Object.prototype.hasOwnProperty.call(cached, name)) {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(target, name)) {
                removed.push(name);
            }
        }
        return { changed, removed };
    }

    global.BundleCacheCore = {
        create: createBundleCache,
        META_CACHE,
        META_URL,
        CACHE_PREFIX,
        LEGACY_ENGINE_CACHE_PREFIX,
        isLegacyEngineCacheKey,
        purgeLegacyEngineCaches,
        LS_DEBUG,
        Logger,
        buildCacheName,
        parseCacheKey,
        parseLegacyCacheKey,
        isManagedCacheKey,
        normalizeRequestUrl,
        joinOriginPath,
        isQuotaError,
        serializeError,
        deserializeError,
        readMetaSnapshot,
        readMetaSwVersion,
        diffBundles,
    };
})(typeof self !== 'undefined' ? self : window);
