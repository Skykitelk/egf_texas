# H5 Bundle Zipper（运行时重写）

## 用途

让 H5 游戏通过下载 Bundle zip、解压并缓存，减少零散 HTTP 请求。仅处理 `assets` 下各 Asset Bundle；引擎文件不缓存、不拦截。

## 前置条件

1. 构建平台：`web-mobile`
2. 勾选 **MD5 Cache**
3. 勾选 **启用插件（ableExtension）**

## 全局 API

```js
window.installBundle(bundleName) // 同步触发，内部异步
window.checkBundleVersion(bundleName) // Promise<0|1>：0=已有最新缓存，1=需 installBundle
window.onBundleInstallProgress = (name, progress) => {} // 0~1
window.onBundleInstallSuccess = (name) => {}
window.onBundleInstallError = (name, error) => {}
window.cleanBundle(bundleName)
window.cleanAllBundles()
window.onBundlesCleanFinish = () => {}

// 关闭 initBundles 预装进度层（预装结束后不会自动关，需业务在合适时机调用）
window.closeInitBundlesLoading()
```

启动时会预装 `initBundles` 并显示全屏进度条；进度到 100% 后仍保持显示，直到业务调用 `closeInitBundlesLoading()`。

资源缓存键与部署目录无关：
- IndexedDB / Memory：`/assets/{bundle}/...`
- Cache API：`https://bundle-zipper.local/assets/{bundle}/...`（API 要求合法绝对 URL）
启动时会把旧绝对 URL / 带 origin 的键迁移为上述格式。
## 分层架构

| 层 | 文件 | 说明 |
|----|------|------|
| Storage | `storage_adapter.js` | Cache → IndexedDB → Memory；配额满整 Bundle 挤到会话临时 |
| Install | `bundle_installer.js` | 下载 zip + fflate 解压 + 回调 |
| Intercept | `network_intercept.js` / `zipcacher.js` | 页面或 SW；仅已 install 的 Bundle 网络回写 |
| Bootstrap | `bootstrap.js` | 版本校验、Update Now、bootGame |

## Update Now

以下任一情况弹出：

1. 插件运行时脚本变更（`runtimeVersion`）
2. `initBundles` 变更
3. 任一 Bundle 相对 `allBundles` 过期 / 存在旧缓存

确认后：清理过期缓存 → 重装 initBundles → **写入确认快照** → reload（避免循环）。

## 构建配置

| 配置项 | 说明 |
|--------|------|
| 启用插件 | 默认关闭 |
| 应用名称 / 简称 | PWA |
| 初始缓存 Bundle | 逗号分隔，Update 时按需重装 |
| 加速地址 | 可选 CDN |

## 开发

```bash
cd extensions/web-bundle-zipper
npm install
npm run dist
```

旧文件 `bundle_cache_core.js` / `page_cacher.js` / `sw_register.js` 已不再注入，可忽略。

## 业务层文档

详细用法（启动关进度条、按需 installBundle、TypeScript 示例）：见 [USAGE.md](./USAGE.md)。
