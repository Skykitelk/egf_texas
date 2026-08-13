# web-bundle-zipper 运行时重写设计

日期：2026-08-13  
状态：已实现  
范围：在 `extensions/web-bundle-zipper` 内保留构建壳，重写运行时

## 背景

- `Bundle Zipper`：他人实现，无 Service Worker / Cache / IndexedDB 降级。
- 现有 `web-bundle-zipper`：有降级，但存在旧缓存清理不干净、循环提示新版本更新等问题。

目标：按清晰分层重写运行时，只处理 `assets` 下各 Bundle；引擎文件不缓存、不拦截。

## 目标

1. 向业务层提供全局安装/清理与回调 API。
2. `installBundle` 下载 zip → 进度通知 → fflate 解压 → 写入缓存封装层；成功/失败走回调。
3. StorageAdapter 抹平 Cache API / IndexedDB / 临时内存差异，并处理配额超限。
4. 有 SW 用 SW 拦截；无 SW 用页面拦截；命中用缓存，未命中走网络；仅已安装 Bundle 才回写。
5. 解压使用现有 `files/fflate.min.js`。
6. 仅 Bundle 资源；启动时做版本校验；过期缓存经 Update Now 统一清理。

## 非目标

- 引擎 / 站点脚本的预缓存与拦截。
- 保留现有易导致循环的三角校验与复杂 bootstrap 状态机（改为简单、可证明不循环的更新协议）。
- 新建独立插件目录（在现有 `web-bundle-zipper` 上重构）。

## 架构

```
构建时 (hooks.ts)
  → assets/{bundle}.{md5}.zip
  → 注入 allBundles / initBundles / runtimeVersion / cdnAddress
  → 写出 sw.js + lib/*

运行时四层
  StorageAdapter     Cache → IndexedDB → Memory（会话临时）
  BundleInstaller    install / clean + 回调
  NetworkIntercept   SW 或页面；仅 assets Bundle
  Bootstrap/Update   版本比对 + Update Now + bootGame
```

## 全局 API

挂在 `window`：

| API | 签名 / 行为 |
|-----|-------------|
| `installBundle` | `(bundleName: string) => void`，同步触发；内部异步执行；同名并发合并为一次 |
| `onBundleInstallProgress` | `(bundleName: string, progress: number) => void`，`progress ∈ [0,1]` |
| `onBundleInstallSuccess` | `(bundleName: string) => void` |
| `onBundleInstallError` | `(bundleName: string, error: Error) => void` |
| `cleanBundle` | `(bundleName: string) => void`，删该 Bundle 所有版本（持久 + 临时） |
| `cleanAllBundles` | `() => void`，删插件管理的全部 Bundle 缓存 |
| `onBundlesCleanFinish` | 可选，兼容旧约定，全部清理结束后调用 |

结果不以 Promise 返回；业务只依赖 Success / Error 回调。

### installBundle 流程

1. 查 `allBundles[name]`，无版本 → `onBundleInstallError`。
2. 若已是最新 MD5 且完整 → `progress=1` + `onBundleInstallSuccess`。
3. 下载 `assets/{name}.{md5}.zip`（可选 `cdnAddress`），按字节更新 Progress。
4. fflate 解压；解压阶段可将 progress 推进到接近 1。
5. 写入 StorageAdapter；更新「已安装清单」为当前 MD5；删除该 Bundle 其它旧 MD5。
6. `onBundleInstallSuccess`；任一步失败 → `onBundleInstallError`，不把半成品标为已安装。

## StorageAdapter

优先级：Cache API → IndexedDB → 自定义会话临时内存。

职责：

- `get / put / delete / deleteBundle / keys` 等统一接口。
- Meta：已安装清单（bundle → md5）、可选访问时间（供淘汰）。

### 配额超限

当写入导致持久层配额不足时：

1. 以**整 Bundle**为单位从持久层（Cache / IDB）删除，腾出空间。
2. 被挤出的 Bundle 内容转入**本次会话临时内存缓存**，当前运行仍可命中。
3. 刷新后临时缓存丢失；需再次 `installBundle`（或符合回写条件的网络成功）才重新进入持久层。
4. 淘汰顺序建议：非 `initBundles`、最久未访问优先；尽量不挤掉当前正在使用的 Bundle。

## NetworkIntercept

**范围**：仅 `assets/` 下可归属到已知 Bundle 的资源；引擎与站点脚本不拦截。

| 环境 | 实现 |
|------|------|
| 支持 Service Worker | SW `fetch` |
| 不支持 | 页面拦截 `fetch` / `XMLHttpRequest`（及 Cocos 所需的 script/img 等） |

**命中逻辑**：

1. 查 Storage（持久优先，再查会话临时）。
2. 命中 → 返回缓存。
3. 未命中 → 正常网络请求。
4. 网络成功 **且** 所属 Bundle 已在「已安装清单」→ 回写 Storage（配额策略同上）。
5. 未 install 的 Bundle → 只走网络，不写缓存。

有 SW 且已激活时：页面层默认不重复 patch 网络（避免双拦截）；无 SW 时由页面层承担同等能力。

## 版本管理与 Update Now

### 版本真相

- 构建注入：`allBundles`（各 Bundle MD5）、`initBundles`、`runtimeVersion`（仅插件运行时脚本 hash）。
- 本地：已安装清单 + 「用户已确认」快照（`runtimeVersion` + `initBundles` 相关 MD5 + 全量 `allBundles` 指纹或等价结构）。

### 启动校验

每次 `index.html` 启动：

1. 比对本地已安装 / 已确认状态与注入的 `allBundles` / `initBundles` / `runtimeVersion`。
2. 若需更新（见下）→ 弹出 Update Now；确认前不自动大批量清理/下载（避免半状态）。
3. 若已对齐 → 注册 SW 或启用页面拦截 → `bootGame`。

### Update Now 触发条件（任一）

1. 插件运行时脚本变更（`runtimeVersion` 与已确认不同）。
2. `initBundles` 集合或其 MD5 变更。
3. 任一非 init Bundle 相对 `allBundles` 过期或存在需清理的旧缓存（防止非 init 旧缓存堆积、清理不及时）。

### 确认更新后

1. 清理所有过期 Bundle 缓存（持久 + 临时中对应版本）。
2. 按需重装变更的 `initBundles`。
3. **先写入**已确认快照，再 reload。
4. reload 后若已对齐则直接进游戏，不再弹窗。

### 防循环

1. 同一次页面生命周期内，同一更新原因只弹一次。
2. 必须「先写已确认快照再 reload」，禁止依赖未持久化的内存标志作为唯一依据。
3. 无 SW 时不以复杂 SW 三角校验为准；以 index 注入版本 + 本地快照为准。
4. Update UI 失败可重试，但不得在未写快照时无限 reload。

## 构建与文件划分

**构建壳**：`source/hooks.ts` 等保留；打 zip、注入变量、写出脚本；不收集引擎文件。

**运行时（重写建议）**：

| 文件 | 职责 |
|------|------|
| `files/storage_adapter.js` | 存储降级 + 配额 |
| `files/bundle_installer.js` | zip 安装与全局 API |
| `files/network_intercept.js` | 页面网络拦截 |
| `files/zipcacher.js` | SW fetch / 消息 |
| `files/bootstrap.js`（由 `sw_register.js` 收敛） | 启动、Update、bootGame |
| `files/fflate.min.js` | 解压 |
| `files/runtime_update_ui.*` | Update Now UI |

注入：`allBundles`、`initBundles`、`runtimeVersion`、`cdnAddress`，以及引擎启动所需 `writeJS` / `writeJSON` / `writeImport`（与现网 bootGame 兼容）。

## 验收要点

1. 无 SW / 无 Cache / 无 IDB 时仍可安装与拦截（降级到可用层）。
2. `installBundle` 为同步 API；Success / Error / Progress 回调正确。
3. 仅 Bundle 资源被拦截；引擎文件始终走网络。
4. 未 install 的 Bundle 网络成功不落盘；已 install 可回写。
5. 配额满：整 Bundle 出持久、进会话临时，当前页仍可命中。
6. runtime / initBundles / 任一过期 Bundle 会弹 Update Now；确认并写快照后 reload 不再循环弹窗。
7. `cleanBundle` / `cleanAllBundles` 能清干净插件前缀缓存。

## 风险

- 页面拦截 XHR 需避免伪造 response 导致 Chromium 崩溃（沿用 blob URL + 真实 XHR 等稳妥做法）。
- Update 条件含「任一过期 Bundle」可能使发版后更易弹窗；这是刻意行为，换取旧缓存及时清理。
