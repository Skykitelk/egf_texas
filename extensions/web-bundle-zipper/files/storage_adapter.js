/**
 * 存储适配：持久层 Cache API → IndexedDB → Memory，外加会话临时层
 * 配额满时整 Bundle 从持久挤到会话临时
 */
(function (global) {
    const DB_NAME = 'bundle_zipper_storage_v1';
    const DB_VERSION = 1;
    const STORE = 'entries';
    const KEY_SEP = '\x1e';

    let persistentApi = null;
    let sessionApi = null;
    let accessOrder = [];
    /** 本页生命周期内是否发生过持久→session 挤出（SW 看不到页面 memory） */
    let sessionSpillActive = false;

    function markSessionSpill() {
        sessionSpillActive = true;
    }

    function hasSessionSpill() {
        return sessionSpillActive;
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

    function log() {
        return R().Logger || console;
    }

    function requestKey(request) {
        if (typeof request === 'string') {
            return request;
        }
        if (request && request.url) {
            return request.url;
        }
        return String(request);
    }

    function headersToPlain(headers) {
        const out = [];
        if (!headers || !headers.forEach) {
            return out;
        }
        headers.forEach(function (value, name) {
            out.push([name, value]);
        });
        return out;
    }

    function plainToHeaders(pairs) {
        const headers = new Headers();
        if (!pairs) {
            return headers;
        }
        for (let i = 0; i < pairs.length; i++) {
            headers.append(pairs[i][0], pairs[i][1]);
        }
        return headers;
    }

    function entryToResponse(entry) {
        return new Response(entry.body, {
            status: entry.status || 200,
            statusText: entry.statusText || 'OK',
            headers: plainToHeaders(entry.headers),
        });
    }

    async function responseToEntry(response) {
        return {
            body: await response.arrayBuffer(),
            status: response.status,
            statusText: response.statusText,
            headers: headersToPlain(response.headers),
        };
    }

    function touchAccess(cacheName) {
        const idx = accessOrder.indexOf(cacheName);
        if (idx >= 0) {
            accessOrder.splice(idx, 1);
        }
        accessOrder.push(cacheName);
    }

    function createMemoryCachesApi() {
        const stores = Object.create(null);

        function getBucket(name) {
            if (!stores[name]) {
                stores[name] = Object.create(null);
            }
            return stores[name];
        }

        return {
            kind: 'memory',
            async open(name) {
                const bucket = getBucket(name);
                return {
                    async match(request) {
                        const entry = bucket[requestKey(request)];
                        return entry ? entryToResponse(entry) : undefined;
                    },
                    async put(request, response) {
                        bucket[requestKey(request)] = await responseToEntry(response);
                    },
                    async keys() {
                        return Object.keys(bucket);
                    },
                    async delete(request) {
                        delete bucket[requestKey(request)];
                        return true;
                    },
                };
            },
            async has(name) {
                const bucket = stores[name];
                return !!(bucket && Object.keys(bucket).length);
            },
            async delete(name) {
                delete stores[name];
                return true;
            },
            async keys() {
                return Object.keys(stores);
            },
            _dumpBucket(name) {
                return stores[name] || null;
            },
            _setBucket(name, bucket) {
                stores[name] = bucket || Object.create(null);
            },
        };
    }

    function openIndexedDB() {
        return new Promise(function (resolve, reject) {
            if (!global.indexedDB) {
                reject(new Error('IndexedDB unavailable'));
                return;
            }
            let settled = false;
            const timer = setTimeout(function () {
                if (settled) {
                    return;
                }
                settled = true;
                reject(new Error('IndexedDB open timeout'));
            }, 5000);
            const req = global.indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = function () {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                reject(req.error || new Error('IndexedDB open failed'));
            };
            req.onupgradeneeded = function () {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };
            req.onsuccess = function () {
                if (settled) {
                    try {
                        req.result.close();
                    } catch (_) {}
                    return;
                }
                settled = true;
                clearTimeout(timer);
                resolve(req.result);
            };
        });
    }

    function idbKey(cacheName, url) {
        return cacheName + KEY_SEP + url;
    }

    function idbRun(db, mode, fn) {
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE, mode);
            const store = tx.objectStore(STORE);
            fn(store, tx, resolve, reject);
            tx.onerror = function () {
                reject(tx.error || new Error('IndexedDB transaction failed'));
            };
        });
    }

    function createIndexedDBCachesApi(db) {
        return {
            kind: 'indexeddb',
            async open(name) {
                const cacheName = name;
                return {
                    async match(request) {
                        const key = idbKey(cacheName, requestKey(request));
                        const entry = await idbRun(db, 'readonly', function (store, tx, resolve, reject) {
                            const req = store.get(key);
                            req.onsuccess = function () {
                                resolve(req.result || null);
                            };
                            req.onerror = function () {
                                reject(req.error);
                            };
                        });
                        return entry ? entryToResponse(entry) : undefined;
                    },
                    async put(request, response) {
                        const key = idbKey(cacheName, requestKey(request));
                        const entry = await responseToEntry(response);
                        await idbRun(db, 'readwrite', function (store, tx, resolve, reject) {
                            const req = store.put(entry, key);
                            req.onsuccess = function () {
                                resolve();
                            };
                            req.onerror = function () {
                                reject(req.error);
                            };
                        });
                    },
                    async delete(request) {
                        const key = idbKey(cacheName, requestKey(request));
                        await idbRun(db, 'readwrite', function (store, tx, resolve, reject) {
                            const req = store.delete(key);
                            req.onsuccess = function () {
                                resolve(true);
                            };
                            req.onerror = function () {
                                reject(req.error);
                            };
                        });
                        return true;
                    },
                    async keys() {
                        const prefix = cacheName + KEY_SEP;
                        return idbRun(db, 'readonly', function (store, tx, resolve, reject) {
                            const keys = [];
                            const req = store.openCursor();
                            req.onsuccess = function () {
                                const cursor = req.result;
                                if (!cursor) {
                                    resolve(keys);
                                    return;
                                }
                                const fullKey = String(cursor.key);
                                if (fullKey.indexOf(prefix) === 0) {
                                    keys.push(fullKey.substring(prefix.length));
                                }
                                cursor.continue();
                            };
                            req.onerror = function () {
                                reject(req.error);
                            };
                        });
                    },
                };
            },
            async has(name) {
                const prefix = name + KEY_SEP;
                return idbRun(db, 'readonly', function (store, tx, resolve, reject) {
                    const req = store.openCursor();
                    req.onsuccess = function () {
                        const cursor = req.result;
                        if (!cursor) {
                            resolve(false);
                            return;
                        }
                        if (String(cursor.key).indexOf(prefix) === 0) {
                            resolve(true);
                            return;
                        }
                        cursor.continue();
                    };
                    req.onerror = function () {
                        reject(req.error);
                    };
                });
            },
            async delete(name) {
                const prefix = name + KEY_SEP;
                await idbRun(db, 'readwrite', function (store, tx, resolve, reject) {
                    const req = store.openCursor();
                    req.onsuccess = function () {
                        const cursor = req.result;
                        if (!cursor) {
                            resolve();
                            return;
                        }
                        if (String(cursor.key).indexOf(prefix) === 0) {
                            cursor.delete();
                        }
                        cursor.continue();
                    };
                    req.onerror = function () {
                        reject(req.error);
                    };
                    tx.oncomplete = function () {
                        resolve();
                    };
                });
                return true;
            },
            async keys() {
                const cacheNames = Object.create(null);
                await idbRun(db, 'readonly', function (store, tx, resolve, reject) {
                    const req = store.openCursor();
                    req.onsuccess = function () {
                        const cursor = req.result;
                        if (!cursor) {
                            resolve();
                            return;
                        }
                        const fullKey = String(cursor.key);
                        const sep = fullKey.indexOf(KEY_SEP);
                        if (sep > 0) {
                            cacheNames[fullKey.substring(0, sep)] = true;
                        }
                        cursor.continue();
                    };
                    req.onerror = function () {
                        reject(req.error);
                    };
                    tx.oncomplete = function () {
                        resolve();
                    };
                });
                return Object.keys(cacheNames);
            },
        };
    }

    function wrapNativeCachesApi(caches) {
        return {
            kind: 'cache',
            open: caches.open.bind(caches),
            has: caches.has.bind(caches),
            delete: caches.delete.bind(caches),
            keys: caches.keys.bind(caches),
        };
    }

    async function probeNativeCaches() {
        if (!global.caches || !global.caches.open) {
            return null;
        }
        try {
            await global.caches.open('__bundle_zipper_probe__');
            await global.caches.delete('__bundle_zipper_probe__');
            return wrapNativeCachesApi(global.caches);
        } catch (_) {
            return null;
        }
    }

    async function probeIndexedDB() {
        try {
            const db = await openIndexedDB();
            await idbRun(db, 'readwrite', function (store, tx, resolve, reject) {
                const req = store.put(
                    { body: new ArrayBuffer(0), headers: [], status: 200, statusText: 'OK' },
                    '__probe__',
                );
                req.onsuccess = function () {
                    resolve();
                };
                req.onerror = function () {
                    reject(req.error);
                };
                tx.oncomplete = function () {
                    idbRun(db, 'readwrite', function (store2) {
                        store2.delete('__probe__');
                    })
                        .then(resolve)
                        .catch(resolve);
                };
            });
            return createIndexedDBCachesApi(db);
        } catch (_) {
            return null;
        }
    }

    async function resolvePersistent(force) {
        if (persistentApi && !force) {
            return persistentApi;
        }
        const native = await probeNativeCaches();
        if (native) {
            persistentApi = native;
            log().info('storage persistent=', native.kind);
            return persistentApi;
        }
        const idb = await probeIndexedDB();
        if (idb) {
            persistentApi = idb;
            log().info('storage persistent=', idb.kind);
            return persistentApi;
        }
        persistentApi = createMemoryCachesApi();
        log().info('storage persistent=memory');
        return persistentApi;
    }

    function ensureSession() {
        if (!sessionApi) {
            sessionApi = createMemoryCachesApi();
        }
        return sessionApi;
    }

    async function readMeta() {
        const api = await resolvePersistent();
        const rt = R();
        const cache = await api.open(rt.META_CACHE || '__bundle_zipper_meta__');
        const resp = await cache.match(rt.META_URL || 'https://bundle-zipper.local/__meta__');
        if (!resp) {
            return { installed: {}, updatedAt: 0 };
        }
        try {
            return await resp.json();
        } catch (_) {
            return { installed: {}, updatedAt: 0 };
        }
    }

    async function writeMeta(meta) {
        const api = await resolvePersistent();
        const rt = R();
        const cache = await api.open(rt.META_CACHE || '__bundle_zipper_meta__');
        const body = JSON.stringify(meta || { installed: {}, updatedAt: Date.now() });
        await cache.put(
            rt.META_URL || 'https://bundle-zipper.local/__meta__',
            new Response(body, { headers: { 'Content-Type': 'application/json' } }),
        );
    }

    async function getInstalledMap() {
        const meta = await readMeta();
        return (meta && meta.installed) || {};
    }

    async function setInstalledVersion(bundleName, version, extras) {
        const meta = await readMeta();
        if (!meta.installed) {
            meta.installed = {};
        }
        if (!meta.fileCounts) {
            meta.fileCounts = {};
        }
        if (version) {
            meta.installed[bundleName] = version;
            if (extras && typeof extras.fileCount === 'number') {
                meta.fileCounts[bundleName] = extras.fileCount;
            }
        } else {
            delete meta.installed[bundleName];
            delete meta.fileCounts[bundleName];
        }
        meta.updatedAt = Date.now();
        await writeMeta(meta);
    }

    function entryKey(requestOrUrl) {
        if (typeof requestOrUrl === 'string') {
            return requestOrUrl;
        }
        if (requestOrUrl && requestOrUrl.url) {
            return requestOrUrl.url;
        }
        return String(requestOrUrl);
    }

    async function matchInSingleCache(cache, requestUrl, storageKind) {
        const preferred =
            (R().toStorageEntryKey && R().toStorageEntryKey(requestUrl, storageKind)) ||
            (R().toStableCachePath && R().toStableCachePath(requestUrl)) ||
            '';
        const pathKey = R().toStableCachePath ? R().toStableCachePath(requestUrl) : '';
        const stableUrl = R().toStableCacheUrl ? R().toStableCacheUrl(requestUrl) : '';
        const absolute = R().normalizeRequestUrl ? R().normalizeRequestUrl(requestUrl) : requestUrl;
        const tryKeys = [];
        function pushKey(k) {
            if (k && tryKeys.indexOf(k) < 0) {
                tryKeys.push(k);
            }
        }
        pushKey(preferred);
        pushKey(pathKey);
        pushKey(stableUrl);
        pushKey(absolute);

        for (let i = 0; i < tryKeys.length; i++) {
            const hit = await cache.match(tryKeys[i]);
            if (!hit) {
                continue;
            }
            if (preferred && tryKeys[i] !== preferred) {
                try {
                    await cache.put(preferred, hit.clone());
                    if (cache.delete) {
                        await cache.delete(tryKeys[i]);
                    }
                } catch (_) {}
            }
            return hit;
        }

        if (!cache.keys || !R().cacheUrlsReferSameAsset) {
            return null;
        }
        try {
            const keys = await cache.keys();
            for (let i = 0; i < keys.length; i++) {
                const keyUrl = entryKey(keys[i]);
                if (!R().cacheUrlsReferSameAsset(keyUrl, requestUrl)) {
                    continue;
                }
                const hit = await cache.match(keys[i]);
                if (!hit) {
                    continue;
                }
                if (preferred) {
                    try {
                        await cache.put(preferred, hit.clone());
                        if (cache.delete && keyUrl !== preferred) {
                            await cache.delete(keys[i]);
                        }
                    } catch (_) {}
                }
                return hit;
            }
        } catch (_) {}
        return null;
    }

    async function matchUrl(url, options) {
        options = options || {};
        const preferName = options.cacheName || null;
        const api = await resolvePersistent();
        const kind = api.kind || '';
        const session = ensureSession();

        async function matchNamed(cacheName) {
            if (!cacheName) {
                return null;
            }
            if (await api.has(cacheName)) {
                const cache = await api.open(cacheName);
                const hit = await matchInSingleCache(cache, url, kind);
                if (hit) {
                    touchAccess(cacheName);
                    return hit.clone();
                }
            }
            if (session && (await session.has(cacheName))) {
                const cache = await session.open(cacheName);
                const hit = await matchInSingleCache(cache, url, 'memory');
                if (hit) {
                    return hit.clone();
                }
            }
            return null;
        }

        // 优先只查当前构建 version，避免旧版 cache 先命中
        if (preferName) {
            return matchNamed(preferName);
        }

        const keys = await api.keys();
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (!R().isManagedCacheKey || !R().isManagedCacheKey(key)) {
                continue;
            }
            if (key === (R().META_CACHE || '__bundle_zipper_meta__')) {
                continue;
            }
            const cache = await api.open(key);
            const hit = await matchInSingleCache(cache, url, kind);
            if (hit) {
                touchAccess(key);
                return hit.clone();
            }
        }
        const sKeys = await session.keys();
        for (let j = 0; j < sKeys.length; j++) {
            const sKey = sKeys[j];
            const cache = await session.open(sKey);
            const hit = await matchInSingleCache(cache, url, 'memory');
            if (hit) {
                return hit.clone();
            }
        }
        return null;
    }

    async function copyCacheToSession(cacheName) {
        const api = await resolvePersistent();
        const session = ensureSession();
        if (!(await api.has(cacheName))) {
            return;
        }
        const src = await api.open(cacheName);
        const dst = await session.open(cacheName);
        const urls = await src.keys();
        for (let i = 0; i < urls.length; i++) {
            const u = typeof urls[i] === 'string' ? urls[i] : urls[i].url || String(urls[i]);
            const resp = await src.match(u);
            if (resp) {
                await dst.put(u, resp.clone());
            }
        }
        await api.delete(cacheName);
        markSessionSpill();
        log().info('bundle spilled to session cache', cacheName);
    }

    async function pickEvictionCandidate(protectCacheName, initBundles) {
        const api = await resolvePersistent();
        const keys = await api.keys();
        const initSet = Object.create(null);
        const list = initBundles || [];
        for (let i = 0; i < list.length; i++) {
            initSet[list[i]] = true;
        }
        const candidates = [];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (key === protectCacheName || key === (R().META_CACHE || '__bundle_zipper_meta__')) {
                continue;
            }
            if (R().isLegacyEngineCacheKey && R().isLegacyEngineCacheKey(key)) {
                candidates.push({ key: key, score: -1 });
                continue;
            }
            const parsed = R().parseCacheKey ? R().parseCacheKey(key) : null;
            if (!parsed) {
                continue;
            }
            const isInit = !!initSet[parsed.name];
            const orderIdx = accessOrder.indexOf(key);
            candidates.push({
                key: key,
                score: (isInit ? 100000 : 0) + (orderIdx >= 0 ? orderIdx : 0),
            });
        }
        if (!candidates.length) {
            return null;
        }
        candidates.sort(function (a, b) {
            return a.score - b.score;
        });
        return candidates[0].key;
    }

    async function putUrl(url, response, bundleName, version, options) {
        options = options || {};
        const api = await resolvePersistent();
        const entryKeyValue =
            (R().toStorageEntryKey && R().toStorageEntryKey(url, api.kind)) ||
            (R().toStableCachePath && R().toStableCachePath(url)) ||
            (R().normalizeRequestUrl ? R().normalizeRequestUrl(url) : url);
        const cacheName = R().buildCacheName(bundleName, version);
        const cache = await api.open(cacheName);
        try {
            await cache.put(entryKeyValue, response.clone());
            touchAccess(cacheName);
            // memory「持久层」实际仅本页可见，按 session 语义返回，驱动页面拦截
            if (api.kind === 'memory') {
                markSessionSpill();
                return 'session';
            }
            return 'persistent';
        } catch (err) {
            if (!(R().isQuotaError && R().isQuotaError(err))) {
                throw err;
            }
            log().warn('quota exceeded on put, evicting bundles');
            let attempts = 0;
            while (attempts < 8) {
                attempts++;
                const victim = await pickEvictionCandidate(cacheName, options.initBundles || []);
                if (!victim) {
                    break;
                }
                await copyCacheToSession(victim);
                try {
                    await cache.put(entryKeyValue, response.clone());
                    touchAccess(cacheName);
                    if (api.kind === 'memory') {
                        markSessionSpill();
                        return 'session';
                    }
                    return 'persistent';
                } catch (err2) {
                    if (!(R().isQuotaError && R().isQuotaError(err2))) {
                        throw err2;
                    }
                }
            }
            const session = ensureSession();
            const sessionKey =
                (R().toStorageEntryKey && R().toStorageEntryKey(url, 'memory')) || entryKeyValue;
            const sc = await session.open(cacheName);
            await sc.put(sessionKey, response.clone());
            markSessionSpill();
            log().warn('put fell back to session only', cacheName);
            return 'session';
        }
    }

    async function deleteBundleAllVersions(bundleName) {
        const api = await resolvePersistent();
        const session = ensureSession();
        const keys = (await api.keys()).concat(await session.keys());
        const seen = Object.create(null);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (seen[key]) {
                continue;
            }
            seen[key] = true;
            const parsed = R().parseCacheKey ? R().parseCacheKey(key) : null;
            if (parsed && parsed.name === bundleName) {
                await api.delete(key);
                await session.delete(key);
            }
        }
        const installed = await getInstalledMap();
        if (installed[bundleName]) {
            await setInstalledVersion(bundleName, null);
        }
    }

    async function deleteAllBundles() {
        const api = await resolvePersistent();
        const session = ensureSession();
        const keys = await api.keys();
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (R().isManagedCacheKey && R().isManagedCacheKey(key)) {
                await api.delete(key);
            } else if (R().isLegacyEngineCacheKey && R().isLegacyEngineCacheKey(key)) {
                await api.delete(key);
            }
        }
        const sKeys = await session.keys();
        for (let j = 0; j < sKeys.length; j++) {
            await session.delete(sKeys[j]);
        }
        await writeMeta({ installed: {}, fileCounts: {}, updatedAt: Date.now() });
    }

    async function purgeStaleVersions(allBundles) {
        const api = await resolvePersistent();
        const session = ensureSession();
        const wanted = allBundles || {};
        const keys = (await api.keys()).concat(await session.keys());
        const seen = Object.create(null);
        const purged = [];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (seen[key]) {
                continue;
            }
            seen[key] = true;
            if (R().isLegacyEngineCacheKey && R().isLegacyEngineCacheKey(key)) {
                await api.delete(key);
                await session.delete(key);
                purged.push(key);
                continue;
            }
            const parsed = R().parseCacheKey ? R().parseCacheKey(key) : null;
            if (!parsed) {
                continue;
            }
            if (!wanted[parsed.name] || wanted[parsed.name] !== parsed.version) {
                await api.delete(key);
                await session.delete(key);
                purged.push(key);
            }
        }
        const meta = await readMeta();
        const installed = (meta && meta.installed) || {};
        const fileCounts = (meta && meta.fileCounts) || {};
        let changed = false;
        for (const name in installed) {
            if (!Object.prototype.hasOwnProperty.call(installed, name)) {
                continue;
            }
            if (!wanted[name] || wanted[name] !== installed[name]) {
                delete installed[name];
                delete fileCounts[name];
                changed = true;
            }
        }
        if (changed) {
            meta.installed = installed;
            meta.fileCounts = fileCounts;
            meta.updatedAt = Date.now();
            await writeMeta(meta);
        }
        return purged;
    }

    async function listStaleCacheKeys(allBundles) {
        const api = await resolvePersistent();
        const session = ensureSession();
        const wanted = allBundles || {};
        const keys = (await api.keys()).concat(await session.keys());
        const seen = Object.create(null);
        const stale = [];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (seen[key]) {
                continue;
            }
            seen[key] = true;
            if (R().isLegacyEngineCacheKey && R().isLegacyEngineCacheKey(key)) {
                stale.push(key);
                continue;
            }
            const parsed = R().parseCacheKey ? R().parseCacheKey(key) : null;
            if (!parsed) {
                continue;
            }
            if (!wanted[parsed.name] || wanted[parsed.name] !== parsed.version) {
                stale.push(key);
            }
        }
        return stale;
    }

    async function hasCompleteBundle(bundleName, version) {
        if (!bundleName || !version) {
            return false;
        }
        const meta = await readMeta();
        const installed = (meta && meta.installed) || {};
        const cacheName = R().buildCacheName
            ? R().buildCacheName(bundleName, version)
            : bundleName + '@' + version;
        try {
            const api = await resolvePersistent();
            const session = ensureSession();
            const inPersistent = await api.has(cacheName);
            const inSession = !!(session && (await session.has(cacheName)));
            if (!inPersistent && !inSession) {
                if (installed[bundleName] === version) {
                    await setInstalledVersion(bundleName, null);
                }
                return false;
            }

            const cache = inPersistent
                ? await api.open(cacheName)
                : await session.open(cacheName);
            if (!cache.keys) {
                // 无法枚举：仅当已登记且有 fileCounts 时信 meta（仍无法验数量则保守 false）
                return false;
            }
            const keys = await cache.keys();
            const count = keys && keys.length ? keys.length : 0;
            if (!count) {
                if (installed[bundleName] === version) {
                    await setInstalledVersion(bundleName, null);
                }
                return false;
            }
            // 必须有 fileCounts 且数量达标，才认完整（避免中断安装留下几个文件就跳过重装）
            const expected =
                meta.fileCounts && typeof meta.fileCounts[bundleName] === 'number'
                    ? meta.fileCounts[bundleName]
                    : 0;
            if (expected <= 0 || count < expected) {
                if (expected > 0 && count < expected) {
                    log().warn(
                        'hasCompleteBundle incomplete file count',
                        bundleName,
                        count,
                        '<',
                        expected,
                    );
                }
                if (installed[bundleName] === version && inPersistent) {
                    await setInstalledVersion(bundleName, null);
                }
                return false;
            }
            // 已登记最新版，或本页 session 已有完整内容（配额 spill / session-only）
            if (installed[bundleName] === version || inSession) {
                return true;
            }
            return false;
        } catch (err) {
            log().warn('hasCompleteBundle check failed', bundleName, err);
            return false;
        }
    }

    /**
     * 将旧绝对 URL / 稳定 origin URL 迁移为当前后端偏好键
     * IndexedDB/Memory：/assets/...
     * Cache API：https://bundle-zipper.local/assets/...
     */
    async function migrateAbsoluteKeysToStable() {
        if (!R().toStorageEntryKey && !R().toStableCachePath) {
            return { migrated: 0 };
        }
        let migrated = 0;
        async function migrateApi(api, kind) {
            if (!api) {
                return;
            }
            const cacheNames = await api.keys();
            for (let i = 0; i < cacheNames.length; i++) {
                const cacheName = cacheNames[i];
                if (!R().isManagedCacheKey || !R().isManagedCacheKey(cacheName)) {
                    continue;
                }
                if (cacheName === (R().META_CACHE || '__bundle_zipper_meta__')) {
                    continue;
                }
                const cache = await api.open(cacheName);
                if (!cache.keys) {
                    continue;
                }
                const urls = await cache.keys();
                for (let j = 0; j < urls.length; j++) {
                    const oldUrl = entryKey(urls[j]);
                    const preferred =
                        (R().toStorageEntryKey && R().toStorageEntryKey(oldUrl, kind)) ||
                        (R().toStableCachePath && R().toStableCachePath(oldUrl)) ||
                        '';
                    if (!preferred || preferred === oldUrl) {
                        continue;
                    }
                    try {
                        const resp = await cache.match(urls[j]);
                        if (!resp) {
                            continue;
                        }
                        const existing = await cache.match(preferred);
                        if (!existing) {
                            await cache.put(preferred, resp.clone());
                        }
                        if (cache.delete) {
                            await cache.delete(urls[j]);
                        }
                        migrated++;
                    } catch (err) {
                        log().warn('migrate cache key failed', oldUrl, err);
                    }
                }
            }
        }
        const persistent = await resolvePersistent();
        await migrateApi(persistent, persistent.kind || 'indexeddb');
        await migrateApi(ensureSession(), 'memory');
        if (migrated) {
            log().info('migrated cache keys to stable path form', migrated);
        }
        return { migrated: migrated };
    }

    api().Storage = {
        resolvePersistent: resolvePersistent,
        ensureSession: ensureSession,
        getStorageKind: function () {
            return persistentApi ? persistentApi.kind : '';
        },
        readMeta: readMeta,
        writeMeta: writeMeta,
        getInstalledMap: getInstalledMap,
        setInstalledVersion: setInstalledVersion,
        matchUrl: matchUrl,
        putUrl: putUrl,
        deleteBundleAllVersions: deleteBundleAllVersions,
        deleteAllBundles: deleteAllBundles,
        purgeStaleVersions: purgeStaleVersions,
        listStaleCacheKeys: listStaleCacheKeys,
        hasCompleteBundle: hasCompleteBundle,
        migrateAbsoluteKeysToStable: migrateAbsoluteKeysToStable,
        createMemoryCachesApi: createMemoryCachesApi,
        hasSessionSpill: hasSessionSpill,
        markSessionSpill: markSessionSpill,
    };
})(typeof self !== 'undefined' ? self : window);
