# EGF Texas 项目说明

## 目录

- [项目概览](#项目概览)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [架构与启动](#架构与启动)
- [全局模块速查](#全局模块速查)
- [UI 开发](#ui-开发)
  - [概述](#概述)
  - [架构与职责划分](#架构与职责划分)
  - [启动与注册流程](#启动与注册流程)
  - [注册机制](#注册机制)
  - [show / hide 生命周期](#show--hide-生命周期)
  - [NodeCtrl 状态机](#nodectrl-状态机)
  - [BaseView 行为说明](#baseview-行为说明)
  - [资源加载与释放](#资源加载与释放)
  - [层级挂载](#层级挂载)
  - [新增 View 步骤](#新增-view-步骤)
  - [子 bundle / 热更注册](#子-bundle--热更注册)
  - [显示 / 隐藏 API](#显示--隐藏-api)
  - [资源声明规范](#资源声明规范)
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
│   ├── resources/                # 默认 bundle（resources）资源
│   ├── bundles/                  # 子 bundle（如 lobby）
│   │   └── lobby/
│   │       └── views/            # LobbyView + initView.ts（registerLobbyViews）
│   └── scripts/
│       ├── main.ts               # 入口组件
│       ├── modules/              # 核心模块（通过 m.xxxMgr 访问）
│       ├── views/                # 主包 UI 控制器 + registerViews.ts
│       ├── components/BaseView.ts # UI 基类（配置读取、挂载、弹窗动画）
│       ├── customLayers/         # 层级实现（SceneLayer）
│       ├── configs/              # ViewConfig / Layer / BroadCast 配置
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
5. `registerMainViews()` 将主包 View 注册到 `m.uiMgr`
6. `setupModule()` 配置日志级别与环境
7. 业务代码通过 `m.xxxMgr` 访问模块

```ts
const app = new App<IModuleMap>();
await app.bootstrap([new ModuleLoader(this.node, this.isMountWindow)]);
app.init();
registerMainViews();

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

### 概述

UI 基于 `@ailhc/dpctrl-c3d` 的 **`DpcMgr`（运行时调度）+ `NodeCtrl`（控制器基类）** 模式。业务通过全局 `m.uiMgr` 显示 / 隐藏界面，每个界面对应一个继承 `BaseView` 的控制器类。

新增界面四步：**ViewConfig.ts 配类型与资源 → 创建 View 类 → bootstrap 后 registerXxxViews → show / hide**。

核心设计原则：

| 原则 | 说明 |
|------|------|
| 配置集中 | 全量 `ViewConfigMap` 在 `ViewConfig.ts`，含主包与各子 bundle View |
| 注册分散 | 各 bundle 独立 `registerXxxViews()`，bootstrap / loadBundle 后显式调用 |
| 注册与加载解耦 | `uiMgr.regist` 只登记控制器类；prefab 在 **showDpc 时** 才加载 |
| 资源统一托管 | 加载 / 释放由 `ModuleLoader` 对接 `assetMgr`，View 通过 `getRess()` 声明 |

### 架构与职责划分

```
ViewConfig.ts（全量配置 + getViewConfig）
       │
       ├─ BaseView.getRess / _mountPrefabView（读 ViewConfigMap）
       │
       ├─ views/registerViews.ts → registerMainViews() → uiMgr.regist
       └─ bundles/lobby/views/initView.ts → registerLobbyViews() → uiMgr.regist
```

| 文件 | 职责 |
|------|------|
| `configs/ViewConfig.ts` | 类型映射 + 全量 `ViewConfigMap` + `getViewConfig()` |
| `views/registerViews.ts` | 主包 `registerMainViews()` |
| `bundles/{name}/views/initView.ts` | 子 bundle `registerXxxViews()` |
| `components/BaseView.ts` | 读配置、`getRess()`、挂载 prefab、弹窗动画 |
| `configs/LayerConfig.ts` | 层级枚举 |
| `views/LoginView.ts` | 主包示例 View |
| `bundles/lobby/views/LobbyView.ts` | 子 bundle 示例 View |

### 启动与注册流程

```
main.ts
  ├─ app.bootstrap(ModuleLoader)  → 创建 uiMgr / assetMgr / layerMgr，赋值 m
  ├─ app.init()
  └─ registerMainViews()          → uiMgr.regist(LoginView, "LoginView")

子 bundle（如 lobby）
  ├─ loadBundle("lobby")
  └─ registerLobbyViews()         → uiMgr.regist(LobbyView, "LobbyView")
```

> **注意**：不得在模块顶层直接 `m.uiMgr.regist`（bootstrap 前 `m` 为空）。必须在 bootstrap 完成后调用注册函数。

### 注册机制

#### uiMgr.regist — 登记控制器

`m.uiMgr.regist(CtrlClass, key)` 将控制器类登记到 `DpcMgr`，`key` 须与 `IViewKeyMap` / `ViewConfigMap` 中的键一致。注册时**不加载 prefab**，也不读取 `ViewConfigMap`。

bundle 与 prefab 路径的一致性由 `ViewConfigMap` 配置 + 开发约定保证，当前无运行时 bundle 校验函数。

#### registerMainViews — 主包

```ts
// views/registerViews.ts
import { m } from "../modules/ModuleMgr";
import { LoginView } from "./LoginView";

export function registerMainViews(): void {
    const uiMgr = m.uiMgr;
    if (!uiMgr) {
        m.logMgr?.error("[View] uiMgr 未初始化");
        return;
    }
    uiMgr.regist(LoginView, "LoginView");
    m.logMgr?.info("[View] 主包 View 已注册");
}
```

```ts
// main.ts（bootstrap + app.init 之后）
registerMainViews();
```

#### registerLobbyViews — 子 bundle 示例

```ts
// bundles/lobby/views/initView.ts
import { m } from "../../../scripts/modules/ModuleMgr";
import { LobbyView } from "./LobbyView";

export function registerLobbyViews(): void {
    m.uiMgr.regist(LobbyView, "LobbyView");
    m.logMgr?.info("[View] lobby View 已注册");
}
```

> **注意**：`regist` ≠ prefab 加载。`BaseView` 通过实例 `key`（及构造函数 `typeKey` 兜底）读 `ViewConfigMap` 获取 path / bundle / layer。

### show / hide 生命周期

```
showDpc("LoginView", onShowData, showedCb?, onInitData?)
  │
  ├─ needShow = true
  ├─ [首次] loadRes ← getRess() 声明的 prefab 列表
  │         └─ ModuleLoader.loadResHandler → assetMgr.loadBatch
  │
  ├─ [首次] onInit(onInitData) → _mountPrefabView()
  │         └─ assetMgr.get(prefab) → instantiate → layerMgr.addNodeToLayer
  │
  ├─ onShow(onShowData) → BaseView 播放 show 动画 → showEndCb / showedCb
  │
hideDpc("LoginView")
  │
  ├─ needShow = false
  ├─ onHide() → BaseView 播放 hide 动画 → super.onHide()
  │
  └─ [destroyDpc 时] releaseRes ← getRess() → assetMgr.release（逐项）
```

| 回调 | 触发时机 | 典型用途 |
|------|----------|----------|
| `onInit` | 控制器首次创建，资源加载完成后 | 实例化 prefab、绑定节点、读取 init 数据 |
| `onShow` | 每次显示 | 刷新 UI、播放动画、处理 show 数据 |
| `onHide` | 每次隐藏 | 停止动画、清理临时状态 |
| `onDestroy` | 控制器销毁 | 解绑事件；**不要**在此手动 release 资源 |

### NodeCtrl 状态机

`NodeCtrl`（`BaseView` 的基类）实例上有一组状态字段，主要由 `DpcMgr` 在 `showDpc` / `hideDpc` / `destroyDpc` 流程中维护：

| 字段 | 维护方 | 含义 |
|------|--------|------|
| `needLoad` | DpcMgr | 本次 show 需要先走资源加载 |
| `isLoading` | DpcMgr | 正在执行 `getRess()` → `loadRes` |
| `isLoaded` | DpcMgr | prefab 等资源已加载完成 |
| `isInited` | DpcMgr | 已调用过 `onInit`（仅首次） |
| `isShowed` | DpcMgr | 当前处于 show 生命周期（`onShow` 已调且未 hide） |
| `needShow` | DpcMgr | 异步 load 期间标记「load 完成后还要 show」；hide 时置 false |
| `isShowing` | 业务层 | `BaseView` 动画播放期间为 true；**DpcMgr 不读写** |

典型首次 show 流程：

```
showDpc → needShow=true → needLoad=true → isLoading → isLoaded
       → isInited → onInit → onShow → isShowed=true → needShow=false

hideDpc → needShow=false → onHide → isShowed=false
        （isInited / isLoaded 保持，实例可复用）

destroyDpc → 重置 isLoaded / isInited / needShow，并 releaseRes
```

查询 API：`m.uiMgr.isLoading(key)` / `isLoaded` / `isInited` / `isShowed` 即读取对应实例字段。

### BaseView 行为说明

`BaseView` 在 `NodeCtrl` 之上封装了配置读取、prefab 挂载和弹窗动画：

| 能力 | 说明 |
|------|------|
| `viewConfig` | 首次解析后缓存，避免重复查 `ViewConfigMap` |
| `getRess()` | 从 `ViewConfigMap` 生成 prefab 资源项，写入 `ressItems` 并返回；子类可 override 追加资源 |
| `_getTypeKey()` | 优先用实例 `this.key`，其次构造函数静态 `typeKey`，匹配 `ViewConfigMap` 键 |
| `onInit` | 调用 `super.onInit` 后自动 `_mountPrefabView()` |
| `_mountPrefabView()` | `assetMgr.get` 取已加载 prefab → `instantiate` → `layerMgr.addNodeToLayer` |
| `onShow` | 设置 `isShowing=true`，播放缩放 + 遮罩动画，结束后 `isShowing=false` 并回调 `showEndCb` |
| `onHide` | 若 node 不存在或未 active，直接 `super.onHide()`；否则播放 hide 动画后再 `super.onHide()` |

子类一般只需 `super.onInit(config)` / `super.onShow(config)` / `super.onHide()`，按需追加业务逻辑。

### 资源加载与释放

`uiMgr.init()` 注入的两个 handler 位于 `ModuleMgr.ts`：

| Handler | 职责 |
|---------|------|
| `loadResHandler` | 读取 `config.ress`（来自 `getRess()`），调用 `assetMgr.loadBatch`；失败 rollback；可选 `showLoading` |
| `releaseResHandler` | 控制器销毁时遍历 `ctrlIns.getRess()`，逐项 `assetMgr.release` |

资源项格式（`IViewRessItem`）必须包含 **`path`、`type`、`bundle`** 三项，不支持纯字符串路径。

### 层级挂载

`ViewConfigMap` 中的 `layer` 指定挂载层：

| 层级 | 枚举 | 用途 |
|------|------|------|
| 场景层 | `LayerType.SCENE` | 登录、大厅、游戏场景 |
| 常规 UI | `LayerType.UI` | 背包、商城、设置 |
| 弹窗层 | `LayerType.POP` | 活动、礼包 |
| 最顶层 | `LayerType.TOP` | 引导、提示、公告 |

`_mountPrefabView()` 内部调用 `m.layerMgr.addNodeToLayer(this.node, layer)`。所有层级当前使用 `SceneLayer` 实现，会根据子节点 `active` 自动显隐。详见 [层级模块 LayerMgr](#层级模块-layermgr)。

### 新增 View 步骤

#### 1. 定义 UI 类型与资源配置

在 `ViewConfig.ts` 中扩展全局类型映射，并加入 `ViewConfigMap`：

```ts
declare global {
    interface IViewKeyMap {
        LoginView: "LoginView";
        ShopView: "ShopView";
    }
    interface IViewInitDataMap {
        LoginView: { playerName: string };
        ShopView: { shopId: number };
    }
    // IViewShowDataMap / IViewUpdateDataMap 同理
}

export const ViewConfigMap: Record<keyof IViewKeyMap, IViewItem> = {
    LoginView: {
        name: "LoginView",
        path: "login/LoginView",
        bundle: "resources",
        layer: LayerType.UI,
    },
    ShopView: {
        name: "ShopView",
        path: "shop/ShopView",
        bundle: "resources",
        layer: LayerType.UI,
    },
};
```

#### 2. 创建控制器类

```ts
import { BaseView } from "../components/BaseView";

export class LoginView extends BaseView {
    // onInit 中 BaseView 已自动 _mountPrefabView，按需 override 业务逻辑
}
```

#### 3. 注册到 uiMgr

**主包** — 在 `views/registerViews.ts` 的 `registerMainViews()` 中追加：

```ts
uiMgr.regist(ShopView, "ShopView");
```

**子 bundle** — 在 `bundles/{name}/views/initView.ts` 的 `registerXxxViews()` 中追加，loadBundle 后调用。

### 子 bundle / 热更注册

配置已在主包 `ViewConfig.ts` 中声明；子 bundle 只负责提供控制器类并注册：

```ts
await loadBundle("lobby");
const { registerLobbyViews } = await import(/* lobby bundle 路径 */ "./initView");
registerLobbyViews();
m.uiMgr.showDpc("LobbyView", { playerName: "test" });
```

要点：

- 全量配置在 `ViewConfig.ts`，方便统一查阅
- 注册脚本各 bundle 独立维护，bootstrap / loadBundle 后显式调用
- 热更替换控制器类时：先 `destroyDpc(key)` 销毁旧实例并释放资源，再 `uiMgr.regist(NewViewClass, key)` 重新登记

### 显示 / 隐藏 API

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

详见 [UI 开发](#ui-开发)。要点：

- 新 UI：`ViewConfig.ts` 扩展类型与 `ViewConfigMap` → 创建 View 类 → `registerXxxViews()` 内 `uiMgr.regist`（bootstrap / loadBundle 后调用）
- 子 bundle：`loadBundle` → `registerXxxViews()`
- 资源由框架统一释放，View 不要在 `onDestroy()` 中重复 release

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
