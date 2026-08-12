/**
 * 存储适配：CacheStorage → IndexedDB → 内存，对外提供 caches.open/has/delete/keys 形状 API
 */
(function (global) {
    const DB_NAME = 'bundle_zipper_storage_v1';
    const DB_VERSION = 1;
    const STORE = 'entries';
    const KEY_SEP = '\x1e';

    let resolvedStorage = null;

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
                        if (!entry) {
                            return undefined;
                        }
                        return entryToResponse(entry);
                    },
                    async put(request, response) {
                        bucket[requestKey(request)] = await responseToEntry(response);
                    },
                    async keys() {
                        return Object.keys(bucket);
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
        };
    }

    function openIndexedDB() {
        return new Promise(function (resolve, reject) {
            if (!global.indexedDB) {
                reject(new Error('IndexedDB unavailable'));
                return;
            }
            const req = global.indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = function () {
                reject(req.error || new Error('IndexedDB open failed'));
            };
            req.onupgradeneeded = function () {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };
            req.onsuccess = function () {
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
                const found = await idbRun(db, 'readonly', function (store, tx, resolve, reject) {
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
                return !!found;
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
        } catch {
            return null;
        }
    }

    async function probeIndexedDB() {
        try {
            const db = await openIndexedDB();
            await idbRun(db, 'readwrite', function (store, tx, resolve, reject) {
                const req = store.put({ body: new ArrayBuffer(0), headers: [], status: 200, statusText: 'OK' }, '__probe__');
                req.onsuccess = function () {
                    resolve();
                };
                req.onerror = function () {
                    reject(req.error);
                };
                tx.oncomplete = function () {
                    idbRun(db, 'readwrite', function (store2) {
                        store2.delete('__probe__');
                    }).then(resolve).catch(resolve);
                };
            });
            return createIndexedDBCachesApi(db);
        } catch {
            return null;
        }
    }

    async function resolveStorage(force) {
        if (resolvedStorage && !force) {
            return resolvedStorage;
        }
        const native = await probeNativeCaches();
        if (native) {
            resolvedStorage = native;
            return resolvedStorage;
        }
        const idb = await probeIndexedDB();
        if (idb) {
            resolvedStorage = idb;
            return resolvedStorage;
        }
        resolvedStorage = createMemoryCachesApi();
        return resolvedStorage;
    }

    function getStorageKind() {
        return resolvedStorage ? resolvedStorage.kind : '';
    }

    global.BundleZipperStorage = {
        resolveStorage: resolveStorage,
        getStorageKind: getStorageKind,
        createMemoryCachesApi: createMemoryCachesApi,
    };
})(typeof self !== 'undefined' ? self : window);
