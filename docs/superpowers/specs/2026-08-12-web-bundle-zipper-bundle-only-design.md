# web-bundle-zipper：仅 Bundle 资源缓存设计

日期：2026-08-12  
状态：已实现  
范围：`extensions/web-bundle-zipper`

## 背景

`web-bundle-zipper` 当前除 Bundle zip 的下载/解压/拦截外，还会：

- 构建时收集并注入 `engineFiles`
- 预缓存引擎/站点脚本到 `__bundle_zipper_engine__.*`
- Service Worker 拦截引擎请求
- 强制更新流程中执行 `precacheEngine`

目标改为：**只对 Bundle 资源**做下载、解压、拦截；引擎与站点脚本一律走网络。

## 目标

1. 删除全部引擎预缓存与拦截链路。
2. 保留 Bundle 版本管理（MD5、`mergeBundles`、按版本 `installBundle`）。
3. 保留插件运行时强制更新（`runtimeVersion`），但版本号不再依赖引擎文件列表。
4. 兼容清理历史残留的 `__bundle_zipper_engine__.*` 缓存。

## 非目标

- 不收窄 `shouldInterceptAssetUrl`（仍按现有 Bundle 拦截规则）。
- 不改变 `installBundle` / `cleanBundle` / `cleanAllBundles` 对外 API。
- 不为 Bundle 变更新增强制 Update UI 或自动预下载。
- 不移除 Service Worker / 页面兜底双模式。

## 行为对照

| 能力 | 改前 | 改后 |
|------|------|------|
| Bundle zip 下载/解压 | 有 | 有 |
| Bundle 资源拦截 | 有 | 有 |
| Bundle 版本（`allBundles` MD5） | 有 | 有 |
| `mergeBundles` 清旧 Bundle cache | 有 | 有 |
| `engineFiles` 注入 | 有 | 无 |
| 引擎预缓存 | 有 | 无 |
| SW 拦截引擎请求 | 有 | 无 |
| Update 时 `precacheEngine` | 有 | 无；确认后 `skipWaiting` → reload |
| `runtimeVersion` | hash(引擎列表 + 运行时脚本) | 仅 hash 插件运行时脚本 |
| 旧 `__bundle_zipper_engine__.*` | 按版本保留/清理 | 启动/activate 时清空全部 |

## Bundle 版本管理（保持不变）

- 构建：`bundleVers` → `assets/{bundle}.{md5}.zip`，注入 `allBundles`。
- 运行：meta（CacheStorage `__bundle_zipper_meta__`）记录各 bundle 当前 MD5。
- `mergeBundles`：MD5 变化的 bundle 清除其全部旧 cache，更新清单；**不**自动预下载 zip。
- 业务侧按需 `installBundle(name)`，缓存名 `__bundle_zipper__.{bundle}.{md5}`。

## `runtimeVersion` 新含义

仅表示**插件运行时脚本**是否变更，用于 SW 注册参数与强制更新检测。

参与 hash 的内容包括（与构建写入一致）：

- `zipcacher` 内容 hash
- `bundle_cache_core` / `page_cacher` / `sw_register`
- `fflate` / `storage_adapter`
- `runtime_update_ui`（js + css）
- `pwa_install`

不再包含 `engineFiles` 列表或任何引擎/站点资源路径。

`swVersion` 继续与 `runtimeVersion` 同值（兼容旧逻辑）。

## 强制更新流程（简化）

插件 runtime 变更时：

1. 仍可提示 Update Now / overlay（现有 UI 保留）。
2. 用户确认后：`skipWaiting` → reload。
3. **不再**调用 `precacheEngine`，也不再等待引擎文件写入 Cache。

三角校验（index / controller / `sw.js` 内嵌版本）保留，用于检测插件 runtime 不一致；失败时仍可 fallback 到页面资源层。

## 旧引擎 Cache 清理

删除引擎功能后，旧客户端可能仍有 `__bundle_zipper_engine__.*`：

- SW `activate`：删除全部以此前缀命名的 cache。
- 页面 bootstrap / hygiene：同样删除该前缀 cache（一次清理即可，无需保留 keep 版本逻辑）。

清理不得误删 `__bundle_zipper__.*`（Bundle）或 `__bundle_zipper_meta__`。

## 文件改动

| 文件 | 改动 |
|------|------|
| `source/hooks.ts` | 删除 `collectFilesRecursive` / `shouldPrecacheEngineFile` / `collectEngineFiles`（若仅服务于引擎）；去掉 `engineFiles` 注入；`runtimeVersion` 只 hash 运行时脚本；`sw.js` init 不传 `engineFiles` |
| `files/zipcacher.js` | 删除引擎 normalize/set/precache/match/intercept；bootstrap 忽略 `precacheEngine`/`engineFiles`；activate 清全部引擎 cache |
| `files/bundle_cache_core.js` | 删除 `ENGINE_CACHE_PREFIX` 及 `isEngineCacheKey` 等导出；purge/managed 逻辑不再保留引擎 cache；可提供一次性 `purgeAllEngineCaches` 或内联前缀删除 |
| `files/sw_register.js` | 去掉 `engineFileList`；bootstrap 消息去掉 `engineFiles`/`precacheEngine`；Update 不再 precache；hygiene 改为清空引擎前缀 cache |
| `readme.md` | 文档与上表行为对齐 |

`dist/*` 在实现后通过 `npm run dist` / `tsc` 重新生成。

## 错误与兼容

- 旧页面若仍声明 `engineFiles` 全局变量：忽略即可，不报错。
- SW 收到带 `precacheEngine` / `engineFiles` 的旧 bootstrap 消息：忽略这些字段。
- Bundle 安装失败、网络失败：行为与现网一致（现有兜底不变）。

## 验证

1. 构建后的 `index.html` 无 `var engineFiles = ...`。
2. `sw.js` init 无 `engineFiles`。
3. DevTools Cache Storage 无新建 `__bundle_zipper_engine__.*`；有残留则启动后被清空。
4. 仅 Bundle 资源命中 zip 缓存；引擎脚本（如 `cocos-js/*`、`index.*.js`）走网络。
5. 修改某 Bundle 后重新构建：旧 MD5 cache 被 merge 清除；需 `installBundle` 才有新缓存。
6. 仅改插件运行时脚本后构建：仍出现 runtime 更新提示；确认后 reload，无引擎 precache 日志。

## 风险

- 引擎文件变更不再触发强制更新：符合本需求；依赖浏览器缓存策略或用户刷新。
- 彻底删除引擎相关代码后，若其它项目脚本依赖 `ENGINE_CACHE_PREFIX` 导出，需确认无外部引用（当前仅插件内部使用）。
