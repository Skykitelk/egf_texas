# web-bundle-zipper Bundle-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all engine precache/intercept from `web-bundle-zipper`; keep Bundle zip download/unzip/intercept and Bundle MD5 versioning; keep runtime forced-update based only on plugin scripts.

**Architecture:** Delete engine file collection/injection and SW engine cache path. `runtimeVersion` hashes only plugin runtime scripts. On activate/bootstrap, purge any leftover `__bundle_zipper_engine__.*` caches. Bundle APIs and `mergeBundles` stay unchanged.

**Tech Stack:** Cocos Creator 3.8 builder plugin (TypeScript), Service Worker + page fallback (JS), CacheStorage.

## Global Constraints

- Only touch `extensions/web-bundle-zipper/` (+ this plan/spec docs if needed).
- Do not narrow `shouldInterceptAssetUrl`.
- Do not change `installBundle` / `cleanBundle` / `cleanAllBundles` public API.
- Do not auto-commit unless the user asks.
- After source edits, run `npm run dist` in `extensions/web-bundle-zipper` to refresh `dist/` and `files/fflate.min.js`.

---

### Task 1: Build hooks — drop engineFiles, recompute runtimeVersion

**Files:**
- Modify: `extensions/web-bundle-zipper/source/hooks.ts`

**Interfaces:**
- Produces: index.html injects `runtimeVersion` / `swVersion` / `allBundles` / `cdnAddress` without `engineFiles`
- Produces: `sw.js` calls `BundleZipperSW.init({ cdnUrl, swVersion, knownBundles })` only

- [ ] **Step 1: Remove engine collection helpers**

Delete `collectFilesRecursive`, `shouldPrecacheEngineFile`, and `collectEngineFiles` from `hooks.ts` (they exist only for engine precache).

- [ ] **Step 2: Recompute runtimeVersion without engineFiles**

Replace:

```ts
const engineFiles = collectEngineFiles(result.dest);
log('engine precache files', engineFiles.length);
const runtimeVersion = easymd5(
    JSON.stringify(engineFiles) +
        cacherHash +
        easymd5(coreCode) +
        // ...
);
```

With hash of plugin runtime scripts only (same list as today minus `engineFiles`):

```ts
const runtimeVersion = easymd5(
    cacherHash +
        easymd5(coreCode) +
        easymd5(pageCacherCode) +
        easymd5(swRegisterCode) +
        easymd5(fflateCode) +
        easymd5(storageAdapterCode) +
        easymd5(runtimeUpdateUiCode) +
        easymd5(runtimeUpdateUiCssCode) +
        easymd5(pwaInstallCode),
);
```

- [ ] **Step 3: Stop injecting engineFiles**

In the `configjs` template, remove the line:

```ts
`var engineFiles = ${JSON.stringify(engineFiles)};\n` +
```

In `sw.js` write, change init to:

```ts
BundleZipperSW.init({ cdnUrl: ${JSON.stringify(cdnAddress)}, swVersion: "${runtimeVersion}", knownBundles: ${JSON.stringify(bundleVers)} });
```

- [ ] **Step 4: Sanity-check source**

Search `hooks.ts` for `engineFiles` / `collectEngine` — expect zero matches.

---

### Task 2: bundle_cache_core — remove ENGINE_CACHE API, add purge-all leftover helper

**Files:**
- Modify: `extensions/web-bundle-zipper/files/bundle_cache_core.js`

**Interfaces:**
- Produces: `BundleZipperCore.LEGACY_ENGINE_CACHE_PREFIX = '__bundle_zipper_engine__.'` (string only, for one-shot purge)
- Produces: `async function purgeLegacyEngineCaches()` deletes every cache whose name starts with that prefix
- Removes: `ENGINE_CACHE_PREFIX` export used for keep/precache; `isEngineCacheKey` / `engineCacheName` keep-current-version helpers

- [ ] **Step 1: Replace engine cache helpers with legacy purge**

Remove keep-version helpers. Add:

```js
const LEGACY_ENGINE_CACHE_PREFIX = '__bundle_zipper_engine__.';

async function purgeLegacyEngineCaches() {
    if (!global.caches || !global.caches.keys) {
        return;
    }
    const keys = await global.caches.keys();
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key.indexOf(LEGACY_ENGINE_CACHE_PREFIX) === 0) {
            try {
                await global.caches.delete(key);
                Logger.info('legacy engine cache purged', key);
            } catch (err) {
                Logger.warn('legacy engine cache purge failed', key, err);
            }
        }
    }
}
```

Ensure `isManagedCacheKey` / orphan purge **does not** treat engine caches as managed keep-list entries; they are only deleted via `purgeLegacyEngineCaches`.

- [ ] **Step 2: Export purge helper; drop old engine exports**

Export `purgeLegacyEngineCaches` and optionally `LEGACY_ENGINE_CACHE_PREFIX`. Remove exports of `ENGINE_CACHE_PREFIX`, `isEngineCacheKey`, `engineCacheName` if present.

- [ ] **Step 3: Call purge from bootstrap hygiene if core owns it**

If `bootstrap` / meta merge already runs hygiene, invoke `await purgeLegacyEngineCaches()` once there so page-only mode also cleans leftovers. Do not delete `__bundle_zipper__.*` or `__bundle_zipper_meta__`.

---

### Task 3: zipcacher SW — delete engine intercept/precache

**Files:**
- Modify: `extensions/web-bundle-zipper/files/zipcacher.js`

**Interfaces:**
- Consumes: `BundleZipperCore.purgeLegacyEngineCaches` (or local equivalent using same prefix)
- Produces: `fetch` handler only uses `shouldInterceptAssetUrl` + bundle cache match (no engine branch)
- Produces: bootstrap message ignores `engineFiles` / `precacheEngine`

- [ ] **Step 1: Delete engine state and functions**

Remove: `ENGINE_CACHE_PREFIX`, `engineFiles`, `engineFileSet`, `normalizeEngineFiles`, `setEngineFiles`, `getEngineRequestFile`, `engineCacheName`, `purgeOldEngineCaches`, `precacheEngineFiles`, `matchEngineRequest`.

- [ ] **Step 2: Simplify fetch listener**

```js
global.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }
    if (!cacheApi.shouldInterceptAssetUrl(request.url)) {
        return;
    }
    event.respondWith(/* existing bundle cache / CDN / network path */);
});
```

- [ ] **Step 3: Simplify bootstrap / activate**

On activate and on bootstrap message: `await purgeLegacyEngineCaches()` (from core or local). Do not call `setEngineFiles` or `precacheEngineFiles`. Ignore `data.engineFiles` / `data.precacheEngine` if present.

- [ ] **Step 4: Simplify init logging**

Remove `engineFiles=` from init log; keep `swVersion` / bundles / cdn.

---

### Task 4: sw_register — drop engine list and precacheEngine from bootstrap/update

**Files:**
- Modify: `extensions/web-bundle-zipper/files/sw_register.js`

**Interfaces:**
- Consumes: core `purgeLegacyEngineCaches`
- Produces: `runMergeBootstrap(controller, timeoutMs)` without precacheEngine flag (or keep unused arg removed)
- Produces: Update Now path without engine precache

- [ ] **Step 1: Remove engineFileList and getEngineCachePrefix usage**

Delete `const engineFileList = ...`. Replace hygiene that kept `enginePrefix + indexRv` with `purgeLegacyEngineCaches()` (delete all legacy engine caches).

- [ ] **Step 2: Simplify runMergeBootstrap**

Stop sending `engineFiles` and `precacheEngine` in the bootstrap postMessage. Update all call sites that passed `precacheEngine` boolean.

- [ ] **Step 3: Simplify forced update**

Where Update Now currently waits for engine precache, only: show overlay → skipWaiting → reload. No precacheEngine logs/calls.

- [ ] **Step 4: Grep cleanup**

Search `sw_register.js` for `engineFiles`, `precacheEngine`, `ENGINE_CACHE`, `engineFile` — expect only comments if any, or legacy purge prefix string.

---

### Task 5: Docs + rebuild dist

**Files:**
- Modify: `extensions/web-bundle-zipper/readme.md`
- Modify: `extensions/web-bundle-zipper/dist/*` via build
- Modify: `docs/superpowers/specs/2026-08-12-web-bundle-zipper-bundle-only-design.md` status → 已实现（optional）

- [ ] **Step 1: Update readme**

Align sections:

- Remove engine precache from runtime flow diagram
- State `runtimeVersion` = plugin runtime scripts only
- State Update Now does not precache engine
- Note leftover `__bundle_zipper_engine__.*` are purged
- Keep Bundle versioning / installBundle docs

- [ ] **Step 2: Compile**

```bash
cd extensions/web-bundle-zipper
npm run dist
```

Expected: exit 0; `dist/hooks.js` has no `engineFiles` / `collectEngineFiles`.

- [ ] **Step 3: Grep whole extension**

```bash
rg -n "engineFiles|precacheEngine|ENGINE_CACHE_PREFIX|collectEngineFiles|matchEngineRequest" "extensions/web-bundle-zipper" --glob '!**/node_modules/**' --glob '!**/@types/**'
```

Expected: only `LEGACY_ENGINE_CACHE_PREFIX` / `purgeLegacyEngineCaches` / readme mentions of legacy cleanup.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Delete engineFiles injection | 1 |
| runtimeVersion without engine list | 1 |
| Delete engine precache/intercept | 3 |
| Purge leftover engine caches | 2, 3, 4 |
| Keep Bundle MD5 / mergeBundles / installBundle | no change (verify via grep/read) |
| Update without precacheEngine | 4 |
| readme sync | 5 |
| dist rebuild | 5 |
