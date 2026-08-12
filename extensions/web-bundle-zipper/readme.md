## H5 Bundle Zipper

### 用途

让 H5 游戏通过下载 Bundle 压缩包（zip）并缓存到本地，减少大量小文件 HTTP 请求，加快资源加载速度。

构建时把每个 Asset Bundle 打成 `assets/{bundle}.{md5}.zip`，运行时由 Service Worker（或页面兜底）下载 zip、解压到 CacheStorage，并拦截资源请求从本地返回。

---

### 前置条件

1. **构建平台**：`web-mobile`（插件仅注册此平台）
2. **MD5 Cache**：构建面板必须勾选 **MD5 Cache**
3. **启用插件**：构建面板勾选 **启用插件（ableExtension）**

> 未勾选 MD5 Cache 时无法启用插件，构建也会失败。插件依赖 MD5 生成的 Bundle 版本号来命名压缩包。

**推荐操作顺序**：先勾选 MD5 Cache → 再勾选启用插件 → 构建。

---

### 构建配置项

| 配置项 | 说明 |
|--------|------|
| 启用插件 | 勾选后才会执行 zip 压缩、SW 注入等逻辑，默认关闭 |
| 应用名称 | PWA `manifest` 名称，同时作为网页 `<title>` |
| 应用简称 | PWA `short_name` |
| 初始缓存 Bundle | 启动前必须下载并缓存完的 Bundle，逗号分隔，默认 `main,internal` |
| 压缩后删除源文件 | 生成 zip 后删除原始 Bundle 目录（`main` / `internal` / `resources` 除外） |
| 加速地址 | 可选，资源 CDN 根地址，用于站点与资源分离部署 |

**已移除「访问路由」配置**：部署路径在运行时根据页面 URL 自动解析，可部署到任意子目录，无需手动填写。

请将 `files/img/` 下的 PWA 图标替换为自己的资源。

---

### 构建生成物

| 文件 | 说明 |
|------|------|
| `assets/{bundle}.{ver}.zip` | 各 Bundle 的压缩包（zip 文件名**不含** Cache 前缀） |
| `sw.js` | Service Worker 入口 |
| `lib/zipcacher{hash}.js` | SW 业务逻辑（下载、解压、拦截） |
| `lib/runtime_update_ui.js` / `.css` | runtime 强制更新模态与 overlay |
| `lib/pwa_install.js` | PWA beforeinstallprompt 封装 |
| `manifest.webmanifest` | PWA 配置 |
| `web.zip` | ~~完整站点发布包~~ **默认不生成**（资源量大时极耗时；见 `hooks.ts` 内注释可手动开启） |
| `cdn.zip` | ~~仅含 `assets/`~~ **默认不生成**（与 `web.zip` 一同关闭） |

**发布**：直接使用 `build/web-mobile/` 目录部署即可。若需整包 zip，在 `source/hooks.ts` 末尾取消 `web.zip` 相关注释后重新 `npm run dist` 并构建。

---

### 运行时流程

```
页面加载
  → 加载 fflate / bundle_cache_core / page_cacher / runtime_update_ui / pwa_install
  → 检测 Service Worker 是否可用
      ├─ 可用：注册 sw.js?v={runtimeVersion}，SW 下载 zip → 解压 → 拦截 fetch
      └─ 不可用：页面兜底模式，同样下载 zip → 解压 → 拦截 fetch / XHR
  → mergeBootstrap：合并 meta；**版本变更的 bundle 清缓存并更新记录，不预下载**
  → bootGame（不再等待 initBundles zip）
```

### 引擎启动（bootGame）

initBundles 完成后按 Cocos 默认顺序动态加载引擎脚本：

1. `polyfills.bundle.js`
2. `system.bundle.js`
3. `import-map.json`（fetch 后内联，路径按 json 文件位置解析为绝对 URL）
4. `System.import('./index.js')`

> **注意**：不能依赖 `<script type="systemjs-importmap" src="...">` 的 `onload` 事件（浏览器通常不触发），也不能直接内联相对路径（会相对 `index.html` 解析，导致 `cc.js` 404）。

启动失败时：`start()` 捕获异常仍会调用 `bootGame()` 走网络兜底；引擎脚本单文件加载失败也会继续执行 `System.import`。

### 版本管理（runtime / bundle 分离）

| 机制 | 说明 |
|------|------|
| `runtimeVersion` | 仅由插件运行时脚本 hash 生成（**不含**引擎文件、**不含** bundle MD5） |
| `allBundles` | 各 bundle 的 MD5 清单，构建时注入 `index.html` |
| `swVersion` | 与 `runtimeVersion` 同值，保留兼容旧逻辑 |
| 注册 URL | `sw.js?v={runtimeVersion}` |
| 运行时脚本 | `lib/*.js?v={runtimeVersion}` |
| `localStorage` | 键 `BundleZipper.runtimeVersion`，**仅在 runtime 更新确认后**写入 |
| 元数据缓存 | CacheStorage `__bundle_zipper_meta__` 为 bundle 清单唯一真相（`runtimeVersion` + `bundles`） |
| Bundle 缓存名 | `__bundle_zipper__.{bundle}.{md5}` |
| bootstrap | 合并 meta + `purgeStale`；清空历史 `__bundle_zipper_engine__.*`；**不**预缓存引擎 |

**插件只处理 Bundle 资源**：下载/解压/拦截仅针对 Asset Bundle zip 及其资源。引擎与站点脚本（如 `cocos-js/*`、`index.*.js`）一律走网络。

**bundle 版本变更**：`mergeBundles` / bootstrap 清除该 bundle 全部旧缓存并更新 meta 清单，**不预下载 zip**；进游戏时业务层 `installBundle` 按需下载。

**runtime 更新**：强制「Update Now」→ overlay → skipWaiting → reload（**无**引擎 precache）。

**遗留引擎 Cache**：旧版本留下的 `__bundle_zipper_engine__.*` 在 SW activate / bootstrap / 页面 hygiene 时全部删除。

**initBundles 配置项**：仍可用于构建校验；启动阶段不再预装 zip，main/internal 等资源在业务调用 `installBundle` 或走网络加载。

### PWA 安装

构建注入 `lib/pwa_install.js`，提供 `installPWA()` / `isPwaInstallAvailable()` / `PWA_AVAILABLE` 事件。

游戏侧：`HallLayer.onShow` 首次弹 `Alert_PWA`（`localStorage` 键 `Alert_PWA`）；设置页「安装」仍走外链 `install_url`，与 PWA 安装分离。

### 运行时能力降级（统一体验）

目标链路：**下载 zip → 解压到本地 → 拦截资源请求 → 返回本地资源**

| 层级 | 优先 | 降级 1 | 降级 2 |
|------|------|--------|--------|
| 网络代理 | Service Worker fetch | 页面 fetch 拦截 | 页面 XHR 拦截 |
| 本地存储 | CacheStorage | IndexedDB | 内存（刷新丢失） |

- **有 SW**：SW 负责 zip 安装与 fetch/XHR 网络拦截；**页面层不再 patch XHR/Script/Image**（避免伪造 XHR response 导致 Chrome `STATUS_ACCESS_VIOLATION` 崩溃）。页面层仍负责 `installBundle` 与 CacheStorage 读写。
- **无 SW**：页面层独立完成 zip 安装 + fetch/XHR/Script/Image 拦截；XHR 缓存命中时通过 **blob URL + 真实 XHR** 加载，不伪造 `xhr.response`。
- **无 CacheStorage**（如 `http://192.168.x.x`）：自动降级 IndexedDB；再不行用内存。

控制台可查看 `storage=cache|indexeddb|memory` 确认当前存储后端。

### 无 Service Worker 时

以下环境自动走**页面资源层**（`page_cacher.js`）：

- 浏览器不支持 Service Worker
- `file://` 协议本地打开
- 非安全上下文（如 `http://192.168.x.x`）导致 SW 不可用
- SW 注册失败

**页面资源层**能力与 SW 模式对齐：

- 下载 zip、解压到 CacheStorage（与 SW **共用同一套 CacheStorage**）
- 全局拦截 `fetch` / `XMLHttpRequest`（Cocos 资源加载走 XHR）
- `installBundle`：优先 SW 消息，失败或无 controller 时自动走页面侧安装

**SW 已激活时**页面层默认 **deferToServiceWorker**（不 patch fetch/XHR），仅保留 zip 安装与 meta；无 SW 时仍由页面资源层拦截网络请求。

> **2026-07 更新**：桌面 Chrome/Edge 在刷新后若同时启用 SW fetch 与页面伪造 XHR，可能触发渲染进程崩溃（`STATUS_ACCESS_VIOLATION`）。SW 已激活时页面层默认 **deferToServiceWorker**，仅保留 zip 安装能力。

> **2026-07 部署兜底**：启动前 **三角校验**（`index.runtimeVersion`、controller `getSwVersion`、`sw.js` 文件内嵌版本）。不一致时静默 **Updating overlay** → 清 orphan cache → 重置 SW → reload 一次；仍失败则 **fallback 页面资源层**。每次 bootstrap / SW activate 均执行 **runtime hygiene**（`purgeStale` + 清空遗留 `__bundle_zipper_engine__.*`）。

> **2026-08**：移除引擎预缓存与拦截；插件仅对 Bundle 做下载/解压/拦截。

> 页面资源层需要 **Cache API** 可用（`localhost` 或 HTTPS）。纯 HTTP 局域网 IP 上 Cache 也可能不可用，此时只能走网络。

**安装失败兜底**：initBundle 失败仍 `bootGame()` 走网络；120s 超时兜底。

**健壮性**：Cache 配额满自动 `purgeStale` 重试；同 bundle 多 Tab 用 `navigator.locks` 互斥；`cleanAllBundles` 仅清理插件前缀缓存，不影响同域其它 PWA。

---

### 游戏中缓存控制

```typescript
// 安装某个 Bundle 的 zip 缓存（SW / 页面模式均返回 Promise）
await window.installBundle('hall')

window.onBundleInstallProgress = (name, progress) => {}  // progress = 1 完成
window.onBundleInstallError = (name, error) => {}

window.cleanBundle('hall')      // 清该 bundle 全部版本
window.cleanAllBundles()       // 清插件全部缓存
window.onBundlesCleanFinish = () => {}
```

按需加载：先 `installBundle`，进度到 `1` 后再 `assetManager.loadBundle()`。

---

### 调试

1. DevTools → **Application** → **Service Workers**
2. **Cache Storage**：`__bundle_zipper__.{bundle}.{version}`
3. **Network**：zip 请求路径为 `assets/{bundle}.{ver}.zip`（不是 Cache 前缀名）
4. 勾选「压缩后删除源文件」后强依赖 SW 或页面兜底

**控制台日志**（统一前缀 `[BundleZipper]`）：

| 级别 | 默认输出 | 说明 |
|------|----------|------|
| `info` / `warn` / `error` | 始终 | 启动模式、bootstrap、zip 下载/完成、SW 消息、更新提示等 |
| `debug` | 需开启 | 单次 cache hit/miss、fetch/XHR 拦截细节 |

开启 debug 日志（任选其一）：

- URL 加参数：`?bzdebug=1`
- 控制台执行：`localStorage.setItem('BundleZipper.debug', '1')` 后刷新

关闭：`localStorage.removeItem('BundleZipper.debug')`

SW 侧日志在 **Service Worker** 控制台查看（Application → Service Workers → 对应 SW → Inspect）。

---

### 插件目录结构

```
extensions/Bundle Zipper/
├── source/           # 构建插件 TypeScript
├── files/            # 运行时脚本（构建时打入游戏）
├── dist/             # tsc 编译产物
└── demo/
```

### 开发与编译

```bash
cd extensions/Bundle\ Zipper
npm install
npm run dist
```

修改 `files/*.js` 后重新构建 **web-mobile** 即可生效。
