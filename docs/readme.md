# EGF Texas 项目说明

## 目录

- [项目概览](#项目概览)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [架构与启动](#架构与启动)
- [全局模块速查](#全局模块速查)
- [UI 开发](#ui-开发)
- [资源模块 AssetMgr](#资源模块-assetmgr)
- [层级模块 LayerMgr](#层级模块-layermgr)
- [日志模块 LogMgr](#日志模块-logmgr)
- [存储模块 StorageMgr](#存储模块-storagemgr)
- [CSV 模块 CsvMgr](#csv-模块-csvmgr)
- [HTTP 模块 HttpMgr](#http-模块-httpmgr)
- [广播模块 BroadCastMgr](#广播模块-broadcastmgr)
- [音频模块 AudioMgr](#音频模块-audiomgr)
- [原生桥接 JsbBridgeMgr](#原生桥接-jsbbridgemgr)
- [热更新模块 HotUpdateMgr](#热更新模块-hotupdatemgr)
- [协议 Protobuf](#协议-protobuf)
- [模块动态加载](#模块动态加载)
- [开发约定](#开发约定)
- [相关文档](#相关文档)

---

## 项目概览

EGF Texas 是基于 **Cocos Creator 3.8.8** 的游戏客户端项目，使用 `@ailhc/egf-core` 做应用启动与模块管理。

核心思路：

- 启动时由 `ModuleLoader` 注册全部模块，业务通过全局访问器 **`m`** 调用
- UI 基于 `@ailhc/dpctrl-c3d` 的 `DpcMgr` + `NodeCtrl` 控制器模式
- 资源、音频、存储、CSV、HTTP 等能力封装在 `assets/scripts/modules/`

入口组件：`assets/scripts/main.ts`

---

## 技术栈

| 类别 | 依赖 / 工具 |
|------|-------------|
| 引擎 | Cocos Creator 3.8.8 |
| 框架 | `@ailhc/egf-core` |
| UI | `@ailhc/dpctrl-c3d`、`@ailhc/layer` |
| 对象池 | `@ailhc/obj-pool` |
| 广播 | `@ailhc/broadcast` |
| 网络（预留） | `@ailhc/enet` |
| 协议 | `egf-protobuf` |
| 加密 | `crypto-es`（StorageMgr AES） |
| 热更新插件 | `extensions/hot-update` |

---

## 项目结构

```
egf_texas/
├── assets/
│   ├── scene/main.scene          # 主场景，挂载 main 组件
│   ├── resources/                # 默认 bundle 资源
│   └── scripts/
│       ├── main.ts               # 入口组件
│       ├── modules/              # 核心模块（通过 m.xxxMgr 访问）
│       ├── views/                # UI 控制器
│       ├── components/BaseView.ts # UI 基类（弹窗动画）
│       ├── customLayers/         # 层级实现（SceneLayer）
│       ├── configs/              # View / Layer / BroadCast 配置
│       ├── protos/               # Protobuf 生成产物
│       └── utils/                # 工具函数
├── extensions/hot-update/        # 编辑器热更新面板插件
├── protobuf/                     # Protobuf 配置
└── docs/
    ├── readme.md                 # 本文档
    └── 热更新逻辑说明.md          # 热更新详细设计
```

---

## 架构与启动

### 启动流程

1. 场景节点挂载 `main` 组件
2. `main.onLoad()` → `initApp()` 创建 `App<IModuleMap>` 并 bootstrap
3. `ModuleLoader` 注册全部模块，赋值全局 `m`
4. `app.init()` 触发各模块 `onInit()`
5. `setupModule()` 配置日志级别与环境
6. 业务代码通过 `m.xxxMgr` 访问模块

```ts
const app = new App<IModuleMap>();
await app.bootstrap([new ModuleLoader(this.node, this.isMountWindow)]);
app.init();

m.logMgr.setMinLevel(this.logLevel);
m.logMgr.setProduction(this.appEnv === EAppEnv.PROD);
```

### main 组件可配置项

| 属性 | 说明 |
|------|------|
| `isMountWindow` | 是否将 `m` 挂到 `window`，便于调试；生产环境自动关闭 |
| `logLevel` | 最低日志级别：`log` / `info` / `warn` / `error` |
| `appEnv` | 应用环境：`dev` / `prod`；prod 下过滤 log 和 info |

### 全局访问器

| 变量 | 说明 |
|------|------|
| `m` | 模块映射表，`m.uiMgr`、`m.assetMgr` 等 |
| `app` | EGF 应用实例 |

类型定义在 `assets/scripts/modules/ModuleMgr.ts` 的 `IModuleMap` 中扩展。

---

## 全局模块速查

| 模块 | 访问器 | 职责 |
|------|--------|------|
| UI 管理 | `m.uiMgr` | 界面显示 / 隐藏 / 更新 |
| 层级管理 | `m.layerMgr` | UI 分层挂载 |
| 资源管理 | `m.assetMgr` | 加载、缓存、引用计数、释放 |
| 音频管理 | `m.audioMgr` | BGM / SFX 播放与任务控制 |
| 存储管理 | `m.storageMgr` | 本地存储、domain 隔离、可选加密 |
| CSV 管理 | `m.csvMgr` | 配表加载、解析、查询 |
| HTTP 管理 | `m.httpMgr` | HTTP 请求封装 |
| 广播管理 | `m.broadCastMgr` | 事件广播实例管理 |
| 日志管理 | `m.logMgr` | 日志输出与生产环境过滤 |
| 热更新管理 | `m.hotUpdateMgr` | Bundle 级热更新实例 |
| 原生桥接 | `m.jsbBridgeMgr` | Android / iOS JSB 能力 |
| 对象池 | `m.poolMgr` | 通用对象池 |

---

## UI 开发

UI 使用 `@ailhc/dpctrl-c3d` 的 `DpcMgr` + `NodeCtrl`。新增界面四步：**定义类型 → 装饰器注册 View → 加入 views/index → show/hide 使用**。

相关文件：

| 文件 | 职责 |
|------|------|
| `configs/ViewConfig.ts` | 全局 UI 类型映射 |
| `configs/ViewRegistry.ts` | `@registTypesToUiMgr` 装饰器与注册表 |
| `views/index.ts` | 聚合 import，触发装饰器执行 |
| `components/BaseView.ts` | UI 基类（prefab 挂载、默认 getRess、弹窗动画） |
| `configs/LayerConfig.ts` | 层级枚举 |
| `views/LoginView.ts` | 示例 |

启动时 `ModuleLoader` 会调用 `validateViewRegistry()` 校验装饰器注册结果，再执行 `syncViewRegistryToUiMgr()` 同步到 `uiMgr`。

### 1. 定义 UI 类型

在 `ViewConfig.ts` 中扩展全局类型映射，使 `showDpc()` / `onInit()` / `onShow()` 获得类型提示：

```ts
declare global {
    interface IViewKeyMap {
        LoginView: "LoginView";
    }
    interface IViewInitDataMap {
        LoginView: { playerName: string };
    }
    interface IViewShowDataMap {
        LoginView: { playerName: string };
    }
    interface IViewUpdateDataMap {
        LoginView: { playerName: string };
    }
}
```

### 2. 创建控制器并注册

`@registTypesToUiMgr` 会自动：写入 `typeKey`、写入 View 注册表、配置 prefab 元数据；启动或热更后调用 `syncViewRegistryToUiMgr()` 时再同步到 `uiMgr`。

装饰器第二参数可选，传入后 `BaseView.getRess()` 和 `mountPrefabView()` 可直接使用：

```ts
import { LayerType } from "../configs/LayerConfig";
import { registTypesToUiMgr } from "../configs/ViewRegistry";
import { BaseView } from "../components/BaseView";

@registTypesToUiMgr("LoginView", {
    prefabUrl: "login/LoginView",
    bundle: "resources",       // 默认 resources
    layer: LayerType.UI,       // 默认 LayerType.UI
})
export class LoginView extends BaseView {

    onInit(config: displayCtrl.IInitConfig<"LoginView", IViewInitDataMap>) {
        super.onInit(config);
        this.mountPrefabView();  // 实例化 prefab 并挂载到层级
    }
}
```

- 无需手写 `static typeKey` 和 `ViewCtrlClassMap`
- 无需手写 `getRess()`（装饰器配置了 prefab 时由 `BaseView` 自动生成）
- 类名与 `viewName` 不一致时会在控制台警告

### 3. 加入 views/index.ts

新增 View 后必须在 `assets/scripts/views/index.ts` 中 import，否则装饰器不会执行、启动时无法注册：

```ts
import "./LoginView";
import "./ShopView"; // 新增
```

### 热更 / 延迟注册 View

`@registTypesToUiMgr` 在 **模块 import 时** 写入 `ViewCtrlRegistry`，与 `uiMgr.regist` 时机无关。热更 bundle 中的 View 可按以下流程注册：

```ts
import { syncViewRegistryToUiMgr } from "../configs/ViewRegistry";

// 1. 加载热更 View 模块（装饰器在此刻写入注册表）
await import("../views/ShopView");

// 2. 将尚未注册的控制器同步到 uiMgr（可省略 uiMgr 参数，默认读 m.uiMgr）
syncViewRegistryToUiMgr();

// 3. 正常 showDpc（资源在 show 时加载，不在 regist 时）
m.uiMgr.showDpc("ShopView", { playerName: "test" });
```

- 跨 bundle 的 prefab：装饰器传 `bundle: "game"` 即可
- `syncViewRegistryToUiMgr(uiMgr, logMgr)` 会跳过已注册的 key，可重复调用
- 启动时 `ModuleLoader` 内部同样走 `syncViewRegistryToUiMgr(uiMgr, logMgr)`

### 4. 显示 / 隐藏

```ts
m.uiMgr.showDpc(
    "LoginView",
    { playerName: "玩家1" },       // onShowData
    () => m.logMgr.info("showed"), // showedCb
    { playerName: "玩家0" },       // onInitData（首次创建）
);

m.uiMgr.hideDpc("LoginView");
```

### 资源声明规范

- 资源项必须包含 `path`、`type`、`bundle`，不要使用纯字符串路径
- UI 资源由 `ModuleMgr.releaseResHandler()` 在界面销毁时统一释放
- View 的 `onDestroy()` **不要**再手动 `releaseBatch(getRess())`，否则会重复释放

---

## 资源模块 AssetMgr

`AssetMgr` 负责资源加载、缓存、并发去重、引用计数和释放。所有对外接口首参均为完整资源项 `{ path, type, bundle }`。

- `load()` 使用缓存时增加引用计数
- `release()` 引用归零后释放引擎引用
- `useCache: false` 的资源不进入缓存，调用方自行管理生命周期

```ts
const loginPrefabRes = {
    path: "login/LoginView",
    type: Prefab,
    bundle: "resources",
} as const;

// 加载
const prefab = await m.assetMgr.load(loginPrefabRes, { useCache: true });

// 批量加载
const [prefab2] = await m.assetMgr.loadBatch([
    { path: "login/LoginView", type: Prefab, bundle: "resources" },
] as const);

// 读取缓存（不增加引用计数）
const cached = m.assetMgr.get(loginPrefabRes);
const exists = m.assetMgr.has(loginPrefabRes);

// 释放
m.assetMgr.release(loginPrefabRes);
m.assetMgr.releaseBatch([loginPrefabRes]);
m.assetMgr.releaseAll();
```

---

## 层级模块 LayerMgr

层级枚举定义在 `LayerConfig.ts`：

| 层级 | 枚举 | 用途 |
|------|------|------|
| 场景层 | `LayerType.SCENE` | 登录、大厅、游戏场景 |
| 常规 UI | `LayerType.UI` | 背包、商城、设置 |
| 弹窗层 | `LayerType.POP` | 活动、礼包 |
| 最顶层 | `LayerType.TOP` | 引导、提示、公告 |

```ts
m.layerMgr.addNodeToLayer(this.node, LayerType.UI);
```

所有层级当前使用 `SceneLayer` 实现，会根据子节点 `active` 状态自动显隐。

---

## 日志模块 LogMgr

```ts
m.logMgr.setMinLevel("warn");       // log / info / warn / error
m.logMgr.setProduction(true);       // prod 下过滤 log 和 info

m.logMgr.log("普通日志", data);
m.logMgr.info("初始化完成");
m.logMgr.warn("资源未命中", path);
m.logMgr.error("加载失败", err);
```

---

## 存储模块 StorageMgr

基于 `sys.localStorage`，支持类型封装、JSON 序列化、domain 作用域隔离、内存缓存和可选 AES 加密。

**domain 规则：**

- 不传 `domain` → 全局域
- 传入 `domain` → 指定作用域（多账号隔离）
- `null` 是合法存储值

```ts
// 配置
m.storageMgr.prefix = "texas";
m.storageMgr.encrypt = true;
m.storageMgr.setSecretKey("my-secret-key");

// 写入
m.storageMgr.setObject("settings", { music: true, sfx: true });
m.storageMgr.setNumber("coin", 1000, undefined, "player_10001");

// 读取
const coin = m.storageMgr.getNumber("coin", 0, "player_10001");
const settings = m.storageMgr.getObject<{ music: boolean }>("settings");

// 管理
m.storageMgr.has("coin");
m.storageMgr.remove("token");
m.storageMgr.keys("player_10001");
m.storageMgr.clear("player_10001");
```

> 重要数据不要只依赖客户端存储，服务端应做最终校验。

---

## CSV 模块 CsvMgr

负责 CSV 配表加载、解析、缓存和查询。缓存键为 `bundle://name`，不同 bundle 可同名。

```ts
// 加载
const table = await m.csvMgr.load(
    { name: "hero", path: "csv/hero", bundle: "resources" },
    { keyField: "id" },
);

// 查询
const row = m.csvMgr.getRow({ name: "hero", bundle: "resources" }, 1001);
const hero = table?.get(1001);
table?.forEach((row, index) => m.logMgr.info(index, row));

// 释放
m.csvMgr.release({ name: "hero", bundle: "resources" });
m.csvMgr.releaseAll();
```

---

## HTTP 模块 HttpMgr

基于 `fetch` 封装 HTTP 请求。模块只导出 `HttpMgr` 类。

**特性：**

- 全局 / 单次 `baseUrl`、默认 headers、超时、query 参数、JSON 请求体
- header 大小写不敏感覆盖
- 跨域时自动过滤默认敏感 header（`Authorization`、`Cookie`、`token` 等）
- Creator 3.8 无 `AbortController`，超时通过计时器实现，底层 `fetch` 无法主动取消
- 相对路径必须配置 `baseUrl` 或 `options.baseUrl`

### 全局配置

```ts
m.httpMgr.configure({
    baseUrl: "https://api.example.com",
    timeout: 10000,
    headers: { Authorization: "Bearer token" },
});

m.httpMgr.setHeader("X-Client", "cocos");
```

### 请求

```ts
const user = await m.httpMgr.get<{ id: number; name: string }>(
    "/user/info",
    { id: 10001 },
);

await m.httpMgr.post("/user/login", {
    account: "test",
    password: "123456",
});

// 单次配置（如 CDN 拉取）
const text = await m.httpMgr.get<string>("/notice.txt", undefined, {
    baseUrl: "https://cdn.example.com",
    responseType: "text",
    useDefaultHeaders: false,
    timeout: 3000,
});
```

### 错误识别

```ts
try {
    await m.httpMgr.post("/user/login", { account: "test" });
} catch (err) {
    if (m.httpMgr.isHttpError(err)) {
        m.logMgr.warn("login failed", err.status, err.body);
    } else if (m.httpMgr.isTimeoutError(err)) {
        m.logMgr.warn("login timeout");
    } else if (m.httpMgr.isJsonParseError(err) || m.httpMgr.isJsonSerializeError(err)) {
        m.logMgr.error("json error", err);
    }
}
```

> 写操作接口（登录、支付、领奖）不要只依赖客户端超时重试，服务端应使用 `requestId` 等幂等字段。

---

## 广播模块 BroadCastMgr

基于 `@ailhc/broadcast` 管理广播实例。消息类型在 `BroadCastConfig.ts` 中通过全局接口扩展：

```ts
// BroadCastConfig.ts
declare global {
    interface IBroadCastKey extends broadcast.IMsgKey {
        PLAYER_LOGIN: "PLAYER_LOGIN";
    }
    interface IBroadCastValueType extends broadcast.IMsgValueType {
        PLAYER_LOGIN: { uid: number };
    }
}
```

```ts
// 创建 / 获取 / 销毁
const bc = m.broadCastMgr.createBroadCast("game");
const same = m.broadCastMgr.getBroadCast("game");
m.broadCastMgr.destroyBroadCast("game");

// 使用 Broadcast API
bc.on("PLAYER_LOGIN", (data) => {
    m.logMgr.info("player login", data.uid);
});
bc.emit("PLAYER_LOGIN", { uid: 10001 });
```

模块卸载（`onStop`）时会自动 dispose 全部广播实例。

---

## 音频模块 AudioMgr

管理 BGM、SFX、音量、静音、任务状态和音频缓存。SFX 限流在通过检查时先占位，加载或播放失败会回滚。

```ts
// 播放
const bgmId = m.audioMgr.playBgm(
    { path: "audio/bgm_main", bundle: "resources" },
    { loop: true, fadeIn: 1 },
);
const sfxId = m.audioMgr.playSfx(
    { path: "audio/click", bundle: "resources" },
    { throttleMs: 100 },
);

// 异步播放（返回任务 ID；0=静音，-1=失败，-2=限流）
const id = await m.audioMgr.playBgmAsync({ path: "audio/bgm_main", bundle: "resources" });

// 任务控制
m.audioMgr.pauseTask(bgmId);
m.audioMgr.stopTask(bgmId);
m.audioMgr.stopBgm();

// 音量
m.audioMgr.setBgmVolume(0.8);
m.audioMgr.setSfxVolume(0.7);

// 预加载
await m.audioMgr.preload([
    { path: "audio/click", bundle: "resources" },
]);
```

---

## 原生桥接 JsbBridgeMgr

封装 Android / iOS 原生能力。非原生平台返回兼容结果。

```ts
if (m.jsbBridgeMgr.isNativePlatform()) {
    m.jsbBridgeMgr.shareText("hello");
}

const adjustResult = await m.jsbBridgeMgr.getAdjustId("adjust-token", 10);
const deviceId = await m.jsbBridgeMgr.getDeviceId();
```

> 同一原生事件不支持并发请求，重复调用会直接返回错误。

---

## 热更新模块 HotUpdateMgr

Bundle 级热更新管理，底层采用 Manifest + 增量 / Zip 全量下载方案。

```ts
const updater = m.hotUpdateMgr.createHotUpdater(
    "game",
    "https://cdn.example.com",
    "1.0.1",
);

updater.onUpdateProgress((progress) => {
    m.logMgr.info("update progress", progress);
});

if (updater.checkUpdate()) {
    const ok = await updater.startUpdate();
}

updater.stopUpdate();
m.hotUpdateMgr.destroyHotUpdater("game");
```

详细设计（Staging 机制、并发控制、断点续传、服务端目录规范等）见 **[热更新逻辑说明](./热更新逻辑说明.md)**。

编辑器侧打包上传使用 `extensions/hot-update` 插件。

---

## 协议 Protobuf

项目使用 `egf-protobuf` 管理协议代码生成。

| 路径 | 说明 |
|------|------|
| `protobuf/` | 协议源文件与 `epbconfig.js` 配置 |
| `assets/scripts/protos/dts/` | 生成的 TypeScript 类型 |
| `assets/scripts/protos/js/` | 生成的 JS 运行时 |

```bash
npm run egf-pb
```

网络层依赖 `@ailhc/enet` 已引入，可按业务需要封装连接模块。

---

## 模块动态加载

`ModuleMgr.ts` 提供运行时模块加载与卸载：

```ts
import { loadModule, unloadModule } from "./modules/ModuleMgr";

loadModule(customModule, "customModule" as keyof IModuleMap);
unloadModule("audioMgr");
```

卸载会触发模块 `onStop()`，不要卸载正在使用的模块。

---

## 开发约定

### UI

- 新 UI 必须在 `ViewConfig.ts` 扩展类型映射，并使用 `@registTypesToUiMgr` 装饰器
- 新 UI 必须在 `views/index.ts` 中 import 一次（或热更后 `dynamic import` + `syncViewRegistryToUiMgr()`）
- 启动日志会输出 `[ViewRegistry] 已注册 View (n): ...` 与 `[ViewRegistry] 同步到 uiMgr (n): ...`
- 资源项必须包含 `path`、`type`、`bundle`
- UI 资源由框架统一释放，View 不要在 `onDestroy()` 中重复释放

### 资源

- `AssetMgr.load()` 与 `AssetMgr.release()` 按引用次数配对
- 音频预加载和 UI 加载走各自模块，不要混用释放逻辑

### 日志

- 业务日志统一使用 `m.logMgr`，不要直接 `console.log`

### 网络与存储

- HTTP 相对路径必须配置 `baseUrl`
- 客户端存储不可作为关键资产的唯一可信来源
- 写操作接口需要服务端幂等保障

### 原生与热更新

- JSB 桥接避免同事件并发调用
- 热更新上线前应补充 manifest 签名校验和路径白名单

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [热更新逻辑说明](./热更新逻辑说明.md) | 热更新完整设计与 API |
| [extensions/hot-update/README.zh-CN.md](../extensions/hot-update/README.zh-CN.md) | 编辑器热更新插件 |
| [agents/issue-tracker.md](./agents/issue-tracker.md) | Issue 跟踪规范 |
| [agents/domain.md](./agents/domain.md) | 领域文档规范 |
| [AGENTS.md](../AGENTS.md) | Agent 技能与协作约定 |
