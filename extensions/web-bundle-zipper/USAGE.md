# Web Bundle Zipper — 业务层使用文档

适用版本：`1.0.41`  
适用平台：Cocos Creator 3.0.x · `web-mobile`  
插件目录：`extensions/web-bundle-zipper`

> 业务与配置统一挂在 `window.WebBundleZipper` 下（含内部模块 `Runtime` / `Storage` / `Installer` / `Network` / `UI` / `SW`），避免顶层全局污染。

---

## 1. 插件做什么

构建时把每个 Asset Bundle 打成 `assets/{bundle}.{md5}.zip`。  
运行时：

1. 启动预装配置的 **initBundles**（下载 zip → fflate 解压 → 写入本地缓存）
2. 拦截游戏对 Bundle 资源的网络请求，优先走本地缓存（对齐引擎：XHR / fetch / `Image.src` / `Script.src` / `Audio.src`；有 SW 时由 SW 拦截）
3. 业务层可随时 `installBundle` 安装其它 Bundle（如 `lobby`）

**只处理** `assets/` 下的业务 Bundle。引擎脚本（`src/`*、*`cocos-js/` 等）不缓存、不拦截。

---



## 2. 构建侧准备（策划/程序一次配置）

1. 构建平台选 **web-mobile**
2. 勾选 **MD5 Cache**（必须）
3. 构建面板启用插件 **ableExtension**
4. 配置项建议：


| 配置项                      | 建议                             | 说明           |
| ------------------------ | ------------------------------ | ------------ |
| 初始缓存 Bundle（initBundles） | 如 `main,internal`（完全按填写，不自动追加） | 启动时预装，进游戏前完成 |
| 加速地址                     | 可选 CDN 根地址                     | 资源与站点分离时填写   |


构建成功后，`index.html` 会注入（示例）：

```js
window.WebBundleZipper = window.WebBundleZipper || {};
(function (W) {
  W.initBundles = ["main","internal"];
  W.allBundles = { "internal":"9e58a", "lobby":"13877", "main":"26bdb", "resources":"e4c05" };
  W.runtimeVersion = "...";
  W.publishVersion = "...";
  // ...
})(window.WebBundleZipper);
```

业务层一般**不需要**读配置字段；按需安装时用 Bundle 名即可。访问方式：`window.WebBundleZipper.xxx`。

---



## 3. 启动流程（业务必须知道）

```
打开页面
  → 插件版本校验（必要时弹「OK」更新）
  → 显示「Loading resources」全屏进度条
  → 预装 initBundles（main / internal …）
  → bootGame（启动 Cocos 引擎）
  → 业务代码运行
  → 【业务调用】WebBundleZipper.closeInitBundlesLoading()  ← 关掉预装进度条
```

要点：

- 预装进度条**不会自动关闭**
- 引擎已启动、首场景可交互后，由业务关闭



### TypeScript 示例（推荐挂在主入口）

```typescript
// assets/scripts/main.ts 或首个常驻组件 onLoad / start

type WebBundleZipperApi = {
    closeInitBundlesLoading?: () => void;
    installBundle?: (bundleName: string) => void;
    checkBundleVersion?: (bundleName: string) => Promise<0 | 1>;
    cleanBundle?: (bundleName: string) => void;
    cleanAllBundles?: () => void;
    onBundleInstallProgress?: (bundleName: string, progress: number) => void;
    onBundleInstallSuccess?: (bundleName: string) => void;
    onBundleInstallError?: (bundleName: string, error: Error) => void;
    onBundlesCleanFinish?: () => void;
};

declare global {
    interface Window {
        WebBundleZipper?: WebBundleZipperApi;
    }
}

function bz(): WebBundleZipperApi {
    return window.WebBundleZipper || {};
}

@ccclass('main')
export class main extends Component {
    start() {
        this.scheduleOnce(() => {
            bz().closeInitBundlesLoading?.();
        }, 0);
    }
}
```

更稳妥的时机示例：

- 首个大厅场景 `onLoad` / `onEnable`
- 登录完成、可点击主界面时
- 自定义 Splash 结束回调里

```typescript
function hideBundleLoading() {
    window.WebBundleZipper?.closeInitBundlesLoading?.();
}
```

非 Web 或未启用插件时，`window.WebBundleZipper` 可能不存在，务必用可选链或判断。

---



## 4. 全局 API 一览

全部挂在 `window.WebBundleZipper` 上（下文简称 `W`）。


| API                           | 类型                                | 说明                                 |
| ----------------------------- | --------------------------------- | ---------------------------------- |
| `W.installBundle(name)`       | `(name: string) => void`          | **同步触发**安装；结果只走回调，不返回 Promise      |
| `W.checkBundleVersion(name)`  | `(name: string) => Promise<0, 1>` | 0表示已是最新缓存版本；1表示有新版本。               |
| `W.onBundleInstallProgress`   | `(name, progress) => void`        | `progress ∈ [0,1]`                 |
| `W.onBundleInstallSuccess`    | `(name) => void`                  | 解压写入完成                             |
| `W.onBundleInstallError`      | `(name, error) => void`           | 失败                                 |
| `W.cleanBundle(name)`         | `(name: string) => void`          | 删除该 Bundle 所有版本缓存                  |
| `W.cleanAllBundles()`         | `() => void`                      | 清空插件管理的全部 Bundle 缓存                |
| `W.onBundlesCleanFinish`      | `() => void`                      | `cleanAllBundles` 结束后（成功/失败都会尽量调用） |
| `W.closeInitBundlesLoading()` | `() => void`                      | 关闭启动预装进度层                          |


---



## 5. 按需安装 Bundle（核心用法）



### 5.1 推荐顺序

```
1. checkBundleVersion('lobby')  → 0 则直接 loadBundle；1 则继续
2. 设置 onBundleInstallProgress / Success / Error（可选但建议）
3. installBundle('lobby')
4. 等 Success（或 progress === 1）
5. assetManager.loadBundle('lobby', ...)
```

**先 install 再 loadBundle**，否则首次仍会打大量零散 HTTP，缓存也写不完整。

```typescript
async function ensureBundleReady(bundleName: string): Promise<void> {
    const W = window.WebBundleZipper;
    if (typeof W?.checkBundleVersion !== 'function') return;
    const need = await W.checkBundleVersion(bundleName);
    if (need === 0) return;
    await new Promise<void>((resolve, reject) => {
        const prevOk = W.onBundleInstallSuccess;
        const prevErr = W.onBundleInstallError;
        W.onBundleInstallSuccess = (name) => {
            prevOk?.(name);
            if (name === bundleName) {
                W.onBundleInstallSuccess = prevOk;
                W.onBundleInstallError = prevErr;
                resolve();
            }
        };
        W.onBundleInstallError = (name, err) => {
            prevErr?.(name, err);
            if (name === bundleName) {
                W.onBundleInstallSuccess = prevOk;
                W.onBundleInstallError = prevErr;
                reject(err);
            }
        };
        W.installBundle?.(bundleName);
    });
}
```



### 5.2 完整示例

```typescript
import { assetManager, AssetManager } from 'cc';

function installThenLoadBundle(bundleName: string): Promise<AssetManager.Bundle> {
    return new Promise((resolve, reject) => {
        const W = window.WebBundleZipper;
        if (typeof W?.installBundle !== 'function') {
            // 非 Web / 插件未启用：直接 loadBundle
            assetManager.loadBundle(bundleName, (err, bundle) => {
                if (err || !bundle) reject(err || new Error('loadBundle failed'));
                else resolve(bundle);
            });
            return;
        }

        const prevProgress = W.onBundleInstallProgress;
        const prevSuccess = W.onBundleInstallSuccess;
        const prevError = W.onBundleInstallError;

        const restore = () => {
            W.onBundleInstallProgress = prevProgress;
            W.onBundleInstallSuccess = prevSuccess;
            W.onBundleInstallError = prevError;
        };

        W.onBundleInstallProgress = (name, progress) => {
            prevProgress?.(name, progress);
            if (name === bundleName) {
                // 更新业务自己的 UI 进度条
                // ui.setProgress(progress);
            }
        };

        W.onBundleInstallSuccess = (name) => {
            prevSuccess?.(name);
            if (name !== bundleName) return;
            restore();
            assetManager.loadBundle(bundleName, (err, bundle) => {
                if (err || !bundle) reject(err || new Error('loadBundle failed'));
                else resolve(bundle);
            });
        };

        W.onBundleInstallError = (name, error) => {
            prevError?.(name, error);
            if (name !== bundleName) return;
            restore();
            reject(error);
        };

        // 同步触发；已缓存最新版时会立刻 Success
        W.installBundle(bundleName);
    });
}

// 使用
async function enterLobby() {
    try {
        const bundle = await installThenLoadBundle('lobby');
        // bundle.load('prefab/Lobby', Prefab, ...)
    } catch (e) {
        console.error('lobby install/load failed', e);
    }
}
```



### 5.3 注意点

1. `installBundle` **不返回 Promise**
  结果只通过 `onBundleInstallSuccess` / `onBundleInstallError` 通知。上面示例用临时回调包成了 Promise，便于 `async/await`。
2. **同名并发会合并**
  多次快速调用 `installBundle('lobby')`，内部只跑一次安装；但 Success/Error 仍按回调通知。临时改写全局回调时注意与其它逻辑冲突（示例里用 `prev*` 链式调用更安全）。
3. **已是最新 MD5**
  不会重复下载，几乎立刻 `progress=1` + Success。
4. **未 install 的 Bundle**
  资源请求仍走网络，且**不会**把零散文件写入缓存；只有已安装清单里的 Bundle 才会网络回写。

---



## 6. 清理缓存

```typescript
const W = window.WebBundleZipper;

// 清某一个 Bundle 的全部版本
W?.cleanBundle?.('lobby');

// 清插件管理的全部 Bundle（最终兜底）
if (W) {
    W.onBundlesCleanFinish = () => {
        console.log('all bundle caches cleaned');
    };
    W.cleanAllBundles?.();
}
```

一般业务用不到。版本更新由插件启动时的 Update Now / 静默清理处理。  
客户端资源错乱时，可提供「清除缓存」按钮调用 `cleanAllBundles()`，再刷新页面。

---



## 7. Update（用户可见行为）

弹框**仅「OK」一键**（无取消/稍后）。以下任一情况会弹出：

1. 插件运行时脚本变更（`runtimeVersion`）
2. `initBundles` 列表或 MD5 变更
3. 相对已确认快照，构建清单整体指纹变化

用户点「OK」后：清理过期缓存 → 重装 initBundles → 写确认快照 → **reload**。  
若快照已确认但本地仍有残留旧 cache，会**静默清理**，不再弹窗（避免循环弹 Update）。  
业务层通常**不用写代码**；确保 reload 后仍会走你的 `closeInitBundlesLoading()` 即可。

### 移动端 / WebView 注意

- 发布刷新熔断依赖 URL 参数（`bzv` / `_bzforce` / `_bzts`），**不依赖** sessionStorage（兼容无痕模式）
- Cache/IDB 不可用落到 memory 时，强制走**页面拦截**（不 defer SW）
- 页面拦截的 blob URL 有 LRU 上限，降低低端机 OOM 风险
- 正式环境请用 **HTTPS**；CDN 与页面同 scheme

---



## 8. 存储与环境差异（排查用）


| 环境                           | 常见表现                                          |
| ---------------------------- | --------------------------------------------- |
| `http://127.0.0.1` / `https` | 优先 **Cache API**（Application → Cache Storage） |
| `http://192.168.x.x`         | Cache/SW 常不可用 → 降级 **IndexedDB**              |
| 都不可用                         | 会话 **内存**（刷新丢失）                               |


控制台可搜：

```
[BundleZipper] storage persistent=cache|indexeddb|memory
[BundleZipper] installBundle start ...
[BundleZipper] installBundle done ...
```

开启更细日志（拦截命中 / write-through 等，含页面拦截与 SW 模式）：

- **仅支持**地址栏加 `?bzdebug=1` 后刷新  
例如：`https://host/web-mobile/index.html?bzv=xxx&bzdebug=1`
- 开启后控制台会出现 `[BundleZipper][debug]` 前缀日志  
（页面：`page intercept cache hit`；SW：`SW intercept cache hit`）

关闭：去掉 URL 中的 `bzdebug=1` 后刷新。

说明：未开 debug 时，你只会看到 `page XXX intercept installed` 这类安装日志，看不到每次资源拦截明细。

### 发布版本号（`bzv`）

每次构建会生成：

- `index.html` 内嵌 `WebBundleZipper.publishVersion`
- 根目录 `bz-publish.json`（`{ "v": "..." }`）

启动时用 `cache: 'no-store'` 拉取 `bz-publish.json`，若与页面内嵌版本或 URL 中的 `bzv` 不一致，会自动跳转到：

`...?bzv=<新版本>`

用查询参数破坏旧 `index.html` 缓存，避免重新部署后仍去下载已下线的 `{bundle}.{旧md5}.zip`。

若 CDN **忽略 query**，首次 `bzv` 跳转后仍可能是旧页：插件会再带 `_bzforce=时间戳` 强刷一次。  
运维建议：对 `bz-publish.json`、`index.html` 配置短缓存/`no-cache`，或发版时 purge。

## 9. 推荐业务接入清单

- [ ] 首场景就绪后调用 `WebBundleZipper.closeInitBundlesLoading()`
- [ ] 远程/按需 Bundle：统一走「installBundle → Success → loadBundle」
- [ ] 给 `installBundle` 做业务进度 UI（可选，与启动全屏进度分开）
- [ ] 非 Web 平台对 `window.WebBundleZipper?.installBundle` 做存在性判断
- [ ] 正式环境用 HTTPS 或至少 `127.0.0.1` 验证 Cache/SW；局域网 IP 仅作降级联调

---



## 10. 常见问题

**Q: 进度条一直不关？**  
A: 必须业务调用 `WebBundleZipper.closeInitBundlesLoading()`，插件不会在 `bootGame` 后自动关。

**Q:** `loadBundle` **后仍大量小文件请求？**  
A: 可能没先 `installBundle`，或装的不是当前 `allBundles` 里的 MD5 版本；看 Network 是否有对应 `assets/{name}.{md5}.zip`。

**Q: 换部署路径后出现多个 Service Worker？**  
A: `1.0.20+` 启动时会注销同 origin 下、非当前 scope 的本插件 `sw.js`，只保留当前部署路径对应的 SW；若旧 SW 正在控制页面，会自动 reload 一次完成接管。

**Q: 能否** `await installBundle()`**？**  
A: 原生 API 是同步触发 + 回调。用本文第 5.2 节封装成 Promise 即可。

---



## 11. 最小接入模板（可直接拷）

```typescript
/** 关闭启动预装进度 */
export function closeInitLoading() {
    window.WebBundleZipper?.closeInitBundlesLoading?.();
}

/** 安装并加载 Bundle */
export function loadCachedBundle(bundleName: string): Promise<import('cc').AssetManager.Bundle> {
    const { assetManager } = require('cc') as typeof import('cc');
    return new Promise((resolve, reject) => {
        const finishLoad = () => {
            assetManager.loadBundle(bundleName, (err, bundle) => {
                if (err || !bundle) reject(err || new Error('loadBundle failed: ' + bundleName));
                else resolve(bundle);
            });
        };

        const W = window.WebBundleZipper;
        if (typeof W?.installBundle !== 'function') {
            finishLoad();
            return;
        }

        const prevS = W.onBundleInstallSuccess;
        const prevE = W.onBundleInstallError;
        W.onBundleInstallSuccess = (name) => {
            prevS?.(name);
            if (name !== bundleName) return;
            W.onBundleInstallSuccess = prevS;
            W.onBundleInstallError = prevE;
            finishLoad();
        };
        W.onBundleInstallError = (name, err) => {
            prevE?.(name, err);
            if (name !== bundleName) return;
            W.onBundleInstallSuccess = prevS;
            W.onBundleInstallError = prevE;
            reject(err);
        };
        W.installBundle(bundleName);
    });
}
```

使用：

```typescript
// 游戏可交互时
closeInitLoading();

// 进大厅
const lobby = await loadCachedBundle('lobby');
```

