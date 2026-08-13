# web-bundle-zipper Runtime Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `web-bundle-zipper` runtime into four clear layers per `docs/superpowers/specs/2026-08-13-web-bundle-zipper-runtime-redesign.md`, keeping the build shell.

**Architecture:** New modules `bundle_runtime.js` (shared helpers), rewrite `storage_adapter.js` (quota spill to session memory), add `bundle_installer.js` + `network_intercept.js`, simplify `zipcacher.js` + replace `sw_register.js` with `bootstrap.js`. Wire via `hooks.ts`. Remove dependence on `bundle_cache_core.js` / `page_cacher.js`.

**Tech Stack:** Cocos Creator 3.8 builder plugin, Service Worker, Cache/IDB/Memory, fflate.

## Global Constraints

- Only Bundle assets under `assets/`; no engine cache/intercept.
- `installBundle(name): void` (sync trigger; callbacks for result).
- Update Now when runtimeVersion OR initBundles OR any stale bundle cache.
- Confirm update: purge stale → reinstall changed init → write confirmed snapshot → reload (no loop).
- Quota: evict whole bundle from persistent → session memory.
- Do not auto-commit unless user asks.

---

### Task 1: Shared runtime + storage with quota spill

**Files:**
- Create/Rewrite: `extensions/web-bundle-zipper/files/bundle_runtime.js`
- Rewrite: `extensions/web-bundle-zipper/files/storage_adapter.js`

**Produces:** `BundleZipperRuntime` helpers; `BundleZipperStorage` with persistent + session layer, meta, `putWithEviction`, `deleteBundle`, `match`.

- [ ] Implement constants, URL/cache-name helpers, meta + confirmed snapshot keys
- [ ] Storage: Cache→IDB→memory probe; session Memory overlay; quota eviction moves whole bundle to session

### Task 2: BundleInstaller global API

**Files:**
- Create: `extensions/web-bundle-zipper/files/bundle_installer.js`

**Produces:** `window.installBundle` (void), progress/success/error callbacks, `cleanBundle`, `cleanAllBundles`

- [ ] Download zip with progress, fflate unzip, write storage, update installed map, purge old versions

### Task 3: Network intercept (page + SW)

**Files:**
- Create: `extensions/web-bundle-zipper/files/network_intercept.js`
- Rewrite: `extensions/web-bundle-zipper/files/zipcacher.js`

**Produces:** Page fetch/XHR intercept; SW fetch using same match/write-through rules

### Task 4: Bootstrap + Update Now

**Files:**
- Create: `extensions/web-bundle-zipper/files/bootstrap.js`
- Keep: `runtime_update_ui.js/css`, `pwa_install.js`, `fflate.min.js`

**Produces:** Startup version check, Update Now without loop, SW register or page intercept, bootGame

### Task 5: Wire hooks + cleanup docs

**Files:**
- Modify: `extensions/web-bundle-zipper/source/hooks.ts`
- Modify: `extensions/web-bundle-zipper/readme.md`
- Optional leave unused: `bundle_cache_core.js`, `page_cacher.js`, `sw_register.js` (stop injecting)

- [ ] Inject new script order; sw.js importScripts new modules
- [ ] `npm run dist`
- [ ] Update readme; mark spec status 已实现
