/**
 * Bundle 安装器：同步触发 installBundle，结果走回调
 * 同一 Bundle 并发安装共享同一 Promise，避免 hang / 回调互踩
 */
(function (global) {
    /** @type {Record<string, Promise<void>>} */
    const inflight = Object.create(null);

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

    function getCdnAddress() {
        return api().cdnAddress || '';
    }

    function emitProgress(name, progress) {
        try {
            if (typeof api().onBundleInstallProgress === 'function') {
                api().onBundleInstallProgress(name, progress);
            }
        } catch (err) {
            log().warn('onBundleInstallProgress error', err);
        }
    }

    function emitSuccess(name) {
        try {
            if (typeof api().onBundleInstallSuccess === 'function') {
                api().onBundleInstallSuccess(name);
            }
        } catch (err) {
            log().warn('onBundleInstallSuccess error', err);
        }
    }

    function emitError(name, error) {
        const err = error instanceof Error ? error : new Error(String(error || 'install failed'));
        try {
            if (typeof api().onBundleInstallError === 'function') {
                api().onBundleInstallError(name, err);
            }
        } catch (cbErr) {
            log().warn('onBundleInstallError error', cbErr);
        }
    }

    function emitCleanFinish() {
        try {
            if (typeof api().onBundlesCleanFinish === 'function') {
                api().onBundlesCleanFinish();
            }
        } catch (err) {
            log().warn('onBundlesCleanFinish error', err);
        }
    }

    function unzipWithFflate(buffer) {
        return new Promise(function (resolve, reject) {
            if (!global.fflate || !global.fflate.unzip) {
                reject(new Error('fflate.unzip unavailable'));
                return;
            }
            const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
            global.fflate.unzip(u8, function (err, files) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(files || {});
            });
        });
    }

    async function downloadZip(url, onProgress) {
        const timeoutMs = 120000;

        function downloadViaXhr() {
            return new Promise(function (resolve, reject) {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'arraybuffer';
                xhr.timeout = timeoutMs;
                xhr.onload = function () {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        if (onProgress) {
                            onProgress(0.85);
                        }
                        resolve(xhr.response);
                        return;
                    }
                    if (xhr.status === 404) {
                        reject(
                            new Error(
                                'zip download 404 (常见于重新部署后浏览器仍缓存了旧 index.html / 旧 Bundle 版本，请强制刷新或清站点数据): ' +
                                    xhr.status +
                                    ' ' +
                                    url,
                            ),
                        );
                        return;
                    }
                    reject(new Error('zip download failed: ' + xhr.status + ' ' + url));
                };
                xhr.onerror = function () {
                    reject(new Error('zip download network error: ' + url));
                };
                xhr.ontimeout = function () {
                    reject(new Error('zip download timeout after ' + timeoutMs + 'ms: ' + url));
                };
                xhr.onprogress = function (ev) {
                    if (!onProgress || !ev || !ev.lengthComputable || !ev.total) {
                        return;
                    }
                    onProgress(Math.min(0.85, ev.loaded / ev.total));
                };
                xhr.send();
            });
        }

        // 旧 WebView 无 AbortController / 无 stream：用 XHR.timeout 保证可失败可 Retry
        if (typeof AbortController === 'undefined' || typeof fetch === 'undefined') {
            return downloadViaXhr();
        }

        const ctrl = new AbortController();
        const timer = setTimeout(function () {
            try {
                ctrl.abort();
            } catch (_) {}
        }, timeoutMs);
        let response;
        try {
            response = await fetch(url, {
                cache: 'no-store',
                signal: ctrl.signal,
            });
        } catch (err) {
            clearTimeout(timer);
            if (err && err.name === 'AbortError') {
                throw new Error('zip download timeout after ' + timeoutMs + 'ms: ' + url);
            }
            // fetch 异常时回退 XHR（部分 WebView fetch 不稳）
            try {
                return await downloadViaXhr();
            } catch (xhrErr) {
                throw err;
            }
        }
        clearTimeout(timer);
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(
                    'zip download 404 (常见于重新部署后浏览器仍缓存了旧 index.html / 旧 Bundle 版本，请强制刷新或清站点数据): ' +
                        response.status +
                        ' ' +
                        url,
                );
            }
            throw new Error('zip download failed: ' + response.status + ' ' + url);
        }
        const total = Number(response.headers.get('content-length') || 0);
        if (!response.body || !response.body.getReader) {
            const bufPromise = response.arrayBuffer();
            const timeoutPromise = new Promise(function (_, reject) {
                setTimeout(function () {
                    reject(new Error('zip download timeout after ' + timeoutMs + 'ms: ' + url));
                }, timeoutMs);
            });
            const buf = await Promise.race([bufPromise, timeoutPromise]);
            if (onProgress) {
                onProgress(0.85);
            }
            return buf;
        }
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        const startedAt = Date.now();
        while (true) {
            if (Date.now() - startedAt > timeoutMs) {
                try {
                    reader.cancel();
                } catch (_) {}
                throw new Error('zip download timeout after ' + timeoutMs + 'ms: ' + url);
            }
            const result = await reader.read();
            if (result.done) {
                break;
            }
            chunks.push(result.value);
            received += result.value.byteLength;
            if (onProgress) {
                if (total > 0) {
                    onProgress(Math.min(0.85, received / total));
                } else {
                    onProgress(Math.min(0.7, received / (received + 512 * 1024)));
                }
            }
        }
        const out = new Uint8Array(received);
        let offset = 0;
        for (let i = 0; i < chunks.length; i++) {
            out.set(chunks[i], offset);
            offset += chunks[i].byteLength;
        }
        if (onProgress) {
            onProgress(0.85);
        }
        return out.buffer;
    }

    /**
     * @returns {Promise<{ allPersistent: boolean, fileCount: number }>}
     */
    async function writeUnzippedFiles(bundleName, version, files) {
        const names = Object.keys(files);
        const prefix = bundleName + '/';
        let allPersistent = true;
        let written = 0;
        for (let i = 0; i < names.length; i++) {
            let relative = names[i].replace(/^\/+/, '').replace(/\\/g, '/');
            if (!relative || /\/$/.test(relative)) {
                continue;
            }
            if (relative.indexOf(prefix) === 0) {
                relative = relative.substring(prefix.length);
            }
            if (!relative) {
                continue;
            }
            const segs = relative.split('/');
            let unsafe = false;
            for (let s = 0; s < segs.length; s++) {
                if (!segs[s] || segs[s] === '.' || segs[s] === '..') {
                    unsafe = true;
                    break;
                }
            }
            if (unsafe) {
                log().warn('skip unsafe zip entry', bundleName, names[i]);
                continue;
            }
            const data = files[names[i]];
            const url = R().resourceUrlInBundle(bundleName, relative);
            if (!url) {
                log().warn('skip unsafe zip entry', bundleName, names[i]);
                continue;
            }
            if (R().toStableCachePath) {
                const stable = R().toStableCachePath(url);
                const expectPrefix = '/assets/' + bundleName + '/';
                if (!stable || stable.indexOf(expectPrefix) !== 0) {
                    log().warn('skip zip-slip entry', bundleName, names[i], stable);
                    continue;
                }
            }
            const mime = R().getFileMime(relative);
            const response = new Response(data, {
                status: 200,
                headers: {
                    'Content-Type': mime,
                    'Content-Length': String(data.byteLength || data.length || 0),
                },
            });
            const where = await S().putUrl(url, response, bundleName, version, {
                initBundles: getInitBundles(),
            });
            if (where !== 'persistent') {
                allPersistent = false;
            }
            written++;
            // 尽早释放解压条目，降低低端机峰值内存
            try {
                delete files[names[i]];
            } catch (_) {}
            emitProgress(bundleName, 0.85 + (0.14 * written) / Math.max(names.length, 1));
        }
        return { allPersistent: allPersistent, fileCount: written };
    }

    async function installBundleAsync(bundleName) {
        await S().resolvePersistent();
        const bundles = getAllBundles();
        const version = bundles[bundleName];
        if (!version) {
            throw new Error('bundle not in allBundles: ' + bundleName);
        }
        if (await S().hasCompleteBundle(bundleName, version)) {
            emitProgress(bundleName, 1);
            return;
        }
        const url = R().zipUrlForBundle(bundleName, version, getCdnAddress());
        log().info('installBundle start', bundleName, version, url);
        emitProgress(bundleName, 0);
        let buffer = await downloadZip(url, function (p) {
            emitProgress(bundleName, p);
        });
        emitProgress(bundleName, 0.88);
        let files = await unzipWithFflate(buffer);
        buffer = null;
        const writeResult = await writeUnzippedFiles(bundleName, version, files);
        files = null;
        // 清掉该 bundle 其它版本
        const api = await S().resolvePersistent();
        const session = S().ensureSession();
        const keys = (await api.keys()).concat(await session.keys());
        const keep = R().buildCacheName(bundleName, version);
        for (let i = 0; i < keys.length; i++) {
            const parsed = R().parseCacheKey(keys[i]);
            if (parsed && parsed.name === bundleName && keys[i] !== keep) {
                await api.delete(keys[i]);
                await session.delete(keys[i]);
            }
        }
        if (!writeResult.allPersistent) {
            // session-only：本页可读（须走页面拦截）；仍写入 fileCounts，刷新后无 cache 会清掉 installed
            if (S().markSessionSpill) {
                S().markSessionSpill();
            }
            await S().setInstalledVersion(bundleName, version, { fileCount: writeResult.fileCount });
            log().warn(
                'installBundle session-only (quota), marked for this page',
                bundleName,
                version,
                'files=',
                writeResult.fileCount,
            );
            emitProgress(bundleName, 1);
            return;
        }
        await S().setInstalledVersion(bundleName, version, { fileCount: writeResult.fileCount });
        emitProgress(bundleName, 1);
        log().info('installBundle done', bundleName, version, 'files=', writeResult.fileCount);
    }

    /**
     * 共享安装 Promise：并发 install / AndWait 不会 hang，也不劫持全局回调
     */
    function runInstall(bundleName) {
        const name = String(bundleName || '').trim();
        if (!name) {
            const err = new Error('bundleName is empty');
            emitError('(empty)', err);
            return Promise.reject(err);
        }
        if (inflight[name]) {
            return inflight[name];
        }
        const task = Promise.resolve()
            .then(function () {
                return installBundleAsync(name);
            })
            .then(function () {
                emitSuccess(name);
            })
            .catch(function (err) {
                log().error('installBundle failed', name, err);
                emitError(name, err);
                throw err;
            })
            .then(
                function () {
                    delete inflight[name];
                },
                function (err) {
                    delete inflight[name];
                    throw err;
                },
            );
        inflight[name] = task;
        return task;
    }

    function installBundle(bundleName) {
        runInstall(bundleName).catch(function () {
            // 错误已通过 onBundleInstallError 抛出；同步 API 吞掉 rejection
        });
    }

    function cleanBundle(bundleName) {
        const name = String(bundleName || '').trim();
        Promise.resolve()
            .then(function () {
                return S().deleteBundleAllVersions(name);
            })
            .then(function () {
                log().info('cleanBundle done', name);
            })
            .catch(function (err) {
                log().warn('cleanBundle failed', name, err);
            });
    }

    function cleanAllBundles() {
        Promise.resolve()
            .then(function () {
                return S().deleteAllBundles();
            })
            .then(function () {
                log().info('cleanAllBundles done');
                emitCleanFinish();
            })
            .catch(function (err) {
                log().warn('cleanAllBundles failed', err);
                emitCleanFinish();
            });
    }

    /**
     * 检查 Bundle 是否已缓存当前构建的最新版本
     * @returns {Promise<0|1>} 0=已有最新缓存；1=需要执行 installBundle
     */
    function checkBundleVersion(bundleName) {
        const name = String(bundleName || '').trim();
        return Promise.resolve()
            .then(function () {
                if (!name) {
                    return 1;
                }
                const bundles = getAllBundles();
                const version = bundles[name];
                if (!version) {
                    log().warn('checkBundleVersion: bundle not in allBundles', name);
                    return 1;
                }
                return S()
                    .resolvePersistent()
                    .then(function () {
                        return S().hasCompleteBundle(name, version);
                    })
                    .then(function (ok) {
                        return ok ? 0 : 1;
                    });
            })
            .catch(function (err) {
                log().warn('checkBundleVersion failed', name, err);
                return 1;
            });
    }

    /**
     * 供 Update / init 预装等待完成（与 installBundle 共享同一 Promise）
     */
    function installBundleAndWait(bundleName) {
        return runInstall(bundleName);
    }

    // 全部挂到 WebBundleZipper，避免顶层全局污染
    const root = api();
    root.Installer = {
        installBundle: installBundle,
        installBundleAndWait: installBundleAndWait,
        checkBundleVersion: checkBundleVersion,
        cleanBundle: cleanBundle,
        cleanAllBundles: cleanAllBundles,
    };
    root.installBundle = installBundle;
    root.checkBundleVersion = checkBundleVersion;
    root.cleanBundle = cleanBundle;
    root.cleanAllBundles = cleanAllBundles;
})(typeof window !== 'undefined' ? window : self);
