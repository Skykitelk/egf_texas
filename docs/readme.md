# EGF Texas 项目说明

## 目录

- [项目概览](./readme.md#overview)
- [核心目录结构](./readme.md#structure)
- [启动流程](./readme.md#startup)
- [全局模块列表](./readme.md#modules)
- [UI 模块](./readme.md#ui)
- [资源模块 AssetMgr](./readme.md#assetmgr)
- [层级模块 LayerMgr](./readme.md#layermgr)
- [日志模块 LogMgr](./readme.md#logmgr)
- [存储模块 StorageMgr](./readme.md#storagemgr)
- [CSV 模块 CsvMgr](./readme.md#csvmgr)
- [音频模块 AudioMgr](./readme.md#audiomgr)
- [原生桥接 JsbBridgeMgr](./readme.md#jsbbridgemgr)
- [热更新模块 HotUpdateMgr](./readme.md#hotupdatemgr)
- [模块动态加载](./readme.md#dynamic-modules)
- [开发约定](./readme.md#conventions)

<a id="overview"></a>

## 项目概览

本项目基于 Cocos Creator `3.8.8`，使用 `@ailhc/egf-core` 进行应用启动和模块管理。项目核心能力集中在 `assets/scripts/modules`，初始化完成后通过全局访问器 `m` 使用各模块。

入口组件是 `assets/scripts/main.ts`，主要负责创建 `App`、注册模块、配置日志环境。

<a id="structure"></a>

## 核心目录结构

- `assets/scripts/main.ts`：项目入口组件。
- `assets/scripts/modules/`：资源、音频、存储、CSV、热更新、JSB、日志等核心模块。
- `assets/scripts/views/`：UI 控制器。
- `assets/scripts/configs/ViewConfig.ts`：UI 控制器注册表和层级枚举。
- `assets/scripts/protos/`：协议类型文件。
- `docs/readme.md`：项目使用说明。

<a id="startup"></a>

## 启动流程

1. 场景节点挂载 `main` 组件。
2. `main.onLoad()` 调用 `initApp()`。
3. 创建 `App<IModuleMap>`。
4. 通过 `ModuleLoader` 注册所有模块。
5. 调用 `app.init()` 触发模块生命周期。
6. 通过 `m.xxxMgr` 使用模块。

```ts
/**
 * @param root ModuleLoader 挂载层级和音频根节点时使用的 Cocos 节点。
 * @param isMountWindow 是否把模块表挂到 `window.m`，便于调试。
 */
const app = new App<IModuleMap>();
await app.bootstrap([new ModuleLoader(this.node, this.isMountWindow)]);
app.init();

m.logMgr.info("[app] init success");
```

<a id="modules"></a>

## 全局模块列表

- `m.uiMgr`：UI 控制器显示、隐藏、更新。
- `m.layerMgr`：UI 层级管理。
- `m.assetMgr`：资源加载、缓存、引用计数和释放。
- `m.audioMgr`：BGM / SFX 播放与任务控制。
- `m.storageMgr`：本地存储、domain 作用域隔离和可选加密。
- `m.csvMgr`：CSV 加载、解析、查询和缓存。
- `m.logMgr`：日志输出和生产环境过滤。
- `m.hotUpdateMgr`：热更新实例管理。
- `m.jsbBridgeMgr`：原生平台桥接。
- `m.poolMgr`：对象池。

<a id="ui"></a>

## UI 模块

UI 使用 `@ailhc/dpctrl-c3d` 的 `DpcMgr` 和 `NodeCtrl`。新增 UI 时，需要定义类型、创建控制器、注册控制器，并声明资源。

### 定义 UI 类型

```ts
/**
 * @remarks 扩展全局 UI 类型映射后，`showDpc()` / `onInit()` / `onShow()` 可获得类型提示。
 */
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

### 创建控制器


```ts
/**
 * @param typeKey UI 控制器唯一 key。
 * @param prefabUrl prefab 在 bundle 内的路径，不带扩展名。
 * @returns `getRess()` 返回 UI 预加载资源列表。
 */
export class LoginView extends NodeCtrl {
    static typeKey = "LoginView";
    static prefabUrl = "login/LoginView";

    private static _ress: IViewRessItem[] = [
        { path: LoginView.prefabUrl, type: Prefab, bundle: "resources" },
    ];

    getRess() {
        return LoginView._ress;
    }
}
```

### 注册控制器

```ts
/**
 * @param LoginView 控制器类，key 必须与控制器的 `typeKey` 一致。
 */
export const ViewCtrlClassMap: displayCtrl.CtrlClassMap = {
    LoginView: LoginView,
};
```

### `showDpc()` 显示界面

```ts
/**
 * @param typeKey 界面类型 key，例如 `"LoginView"`。
 * @param onShowData 显示时传给 `onShow()` 的数据。
 * @param showedCb 界面显示完成后的回调。
 * @param onInitData 首次创建界面时传给 `onInit()` 的初始化数据。
 */
m.uiMgr.showDpc(
    "LoginView",
    { playerName: "玩家1" },
    () => {
        m.logMgr.info("LoginView showed");
    },
    { playerName: "玩家0" },
);
```

### `hideDpc()` 隐藏界面

```ts
/**
 * @param typeKey 要隐藏的界面类型 key，例如 `"LoginView"`。
 */
m.uiMgr.hideDpc("LoginView");
```

### `getRess()` 声明 UI 资源

```ts
/**
 * @param path 资源在 `bundle` 内的路径，不带扩展名。
 * @param type 资源类型，例如 `Prefab`。
 * @param bundle 资源所属 bundle，例如 `"resources"`。
 */
getRess() {
    return [
        { path: "login/LoginView", type: Prefab, bundle: "resources" },
    ];
}
```

资源项必须包含 `path`、`type`、`bundle`，不要使用纯字符串路径。

UI 资源由 `ModuleMgr.releaseResHandler()` 在界面销毁时统一释放。业务 View 的 `onDestroy()` 不要再手动调用 `m.assetMgr.releaseBatch(getRess())`，否则会造成重复释放。

<a id="assetmgr"></a>

## 资源模块 AssetMgr

`AssetMgr` 负责资源加载、缓存、并发加载去重、引用计数和释放。所有对外资源接口都要求首参是完整资源项。

`load()` 使用缓存时会增加逻辑引用计数；`release()` 引用归零后会释放该缓存资源持有的引擎引用。`useCache: false` 的资源不会进入 `AssetMgr` 缓存，调用方需要自行管理其生命周期。

```ts
/**
 * @param path 资源路径，不带扩展名。
 * @param type 资源类型，`load()` 和 `get()` 会根据它自动推导返回类型。
 * @param bundle 资源所属 bundle。
 */
const loginPrefabRes = {
    path: "login/LoginView",
    type: Prefab,
    bundle: "resources",
} as const;
```

### `load()` 加载资源

```ts
/**
 * @param item 完整资源项。
 * @param options.useCache 是否加入缓存并使用引用计数。
 */
const prefab = await m.assetMgr.load(loginPrefabRes, {
    useCache: true,
});
```

### `loadBatch()` 批量加载

```ts
/**
 * @param items 资源项数组，每一项都必须包含 `path`、`type`、`bundle`。
 * @returns 返回数组顺序与 `items` 一致；使用 `as const` 时类型推导更精确。
 */
const [loginPrefab] = await m.assetMgr.loadBatch([
    { path: "login/LoginView", type: Prefab, bundle: "resources" },
] as const);
```

### `get()` 获取缓存资源

```ts
/**
 * @param item 完整资源项，用于精确定位缓存资源。
 * @remarks 不增加引用计数。
 */
const prefab = m.assetMgr.get(loginPrefabRes);
```

### `has()` 判断是否缓存

```ts
/**
 * @param item 完整资源项。
 */
const hasPrefab = m.assetMgr.has(loginPrefabRes);
```

### `release()` 释放一次引用

```ts
/**
 * @param item 完整资源项；每调用一次释放一次对应资源引用。
 */
m.assetMgr.release(loginPrefabRes);
```

### `releaseBatch()` 批量释放

```ts
/**
 * @param items 资源项数组，建议与 `loadBatch()` 入参保持一致。
 */
m.assetMgr.releaseBatch([
    { path: "login/LoginView", type: Prefab, bundle: "resources" },
]);
```

### `releaseAll()` 释放全部缓存

```ts
/**
 * @remarks 无参数。会强制释放 `AssetMgr` 当前缓存中的全部资源。
 */
m.assetMgr.releaseAll();
```

<a id="layermgr"></a>

## 层级模块 LayerMgr

层级枚举定义在 `ViewConfig.ts`，用于将 UI 节点放到对应层。

### `addNodeToLayer()` 添加节点到层级

```ts
/**
 * @param node 要加入层级的 Cocos 节点。
 * @param layerType 目标层级，例如 `LayerType.UI`。
 */
m.layerMgr.addNodeToLayer(this.node, LayerType.UI);
```

常用层级：

- `LayerType.SCENE`：场景层。
- `LayerType.UI`：常规 UI。
- `LayerType.POP_UP_UI`：弹窗层。
- `LayerType.EFFECT_UI`：特效层。
- `LayerType.TOP`：最顶层。

<a id="logmgr"></a>

## 日志模块 LogMgr

`LogMgr` 用于统一控制日志级别和生产环境输出。

### `setMinLevel()` 设置最低输出级别

```ts
/**
 * @param level 最低输出级别，可选 `"log"`、`"info"`、`"warn"`、`"error"`。
 */
m.logMgr.setMinLevel("warn");
```

### `setProduction()` 设置生产环境

```ts
/**
 * @param prod 是否开启生产环境日志策略；生产环境会过滤 `log` 和 `info`。
 */
m.logMgr.setProduction(true);
```

### 日志输出

```ts
/**
 * @param args 任意日志内容。
 */
m.logMgr.log("普通日志", data);
m.logMgr.info("初始化完成");
m.logMgr.warn("资源未命中", path);
m.logMgr.error("加载失败", err);
```

<a id="storagemgr"></a>

## 存储模块 StorageMgr

`StorageMgr` 基于 `sys.localStorage`，支持类型封装、对象序列化、domain 作用域隔离、内存缓存和可选 AES 加密。

多数对外接口最后一个参数都是 `domain`：

- 不传 `domain`：操作全局域。
- 传入 `domain`：只操作指定作用域。
- `null` 是合法存储值，`get()` 和 `getBatch()` 都会按 `null` 返回。
- `getString()` / `getNumber()` / `getBoolean()` 等 typed getter 会在值为 `null` 或类型不匹配时返回默认值。

### domain 示例

```ts
/**
 * @param key 逻辑键名。
 * @param value 要写入的值。
 * @param options 写入选项；这里传 `undefined` 表示使用默认选项。
 * @param domain 作用域；不传表示全局域。
 */
m.storageMgr.setNumber("coin", 1000);
m.storageMgr.setNumber("coin", 2000, undefined, "player_10001");

const globalCoin = m.storageMgr.getNumber("coin", 0);
const playerCoin = m.storageMgr.getNumber("coin", 0, "player_10001");
```

### 配置项

```ts
/**
 * @param prefix 存储键前缀，会自动补 `_`。
 * @param encrypt 是否默认加密后续写入的数据。
 * @param memoryCacheEnabled 是否启用内存读缓存。
 * @param key AES 加密密钥，只影响后续新写入的数据。
 */
m.storageMgr.prefix = "texas";
m.storageMgr.encrypt = true;
m.storageMgr.memoryCacheEnabled = false;
m.storageMgr.setSecretKey("my-secret-key");
```

### `set()` / `setString()` / `setNumber()` / `setBoolean()` / `setObject()`

```ts
/**
 * @param key 逻辑键名，不包含模块前缀和 domain。
 * @param value 要写入的值；`set()` 传 `undefined` 等价于删除该键。
 * @param options.encrypt 是否单独加密本条数据。
 * @param domain 作用域；不传表示全局域。
 */
m.storageMgr.set("profile", { name: "Alice", level: 10 });
m.storageMgr.setString("player_name", "Alice");
m.storageMgr.setNumber("coin", 1000);
m.storageMgr.setBoolean("tutorial_done", true);
m.storageMgr.setObject("settings", { music: true, sfx: true });

m.storageMgr.setNumber("coin", 2000, undefined, "player_10001");
```

### `setBatch()` 批量写入

```ts
/**
 * @param entries 键值对字典。
 * @param options 写入选项，会应用到每一项。
 * @param domain 作用域；不传表示全局域。
 */
m.storageMgr.setBatch({
    level: 10,
    exp: 2500,
    coin: 1000,
});

m.storageMgr.setBatch({ level: 20, coin: 2000 }, undefined, "player_10001");
```

### `get()` / `getString()` / `getNumber()` / `getBoolean()` / `getObject()` / `getArray()`

```ts
/**
 * @param key 逻辑键名。
 * @param defaultValue 读取失败或类型不匹配时返回的默认值。
 * @param domain 作用域；不传表示全局域。
 */
const profile = m.storageMgr.get<{ name: string; level: number }>("profile");
const name = m.storageMgr.getString("player_name", "Guest");
const coin = m.storageMgr.getNumber("coin", 0);
const done = m.storageMgr.getBoolean("tutorial_done", false);
const settings = m.storageMgr.getObject<{ music: boolean }>("settings");
const ids = m.storageMgr.getArray<number>("completed_levels", []);

const playerCoin = m.storageMgr.getNumber("coin", 0, "player_10001");
```

### `getBatch()` 批量读取

```ts
/**
 * @param keys 逻辑键名列表。
 * @param domain 作用域；不传表示全局域。
 */
const data = m.storageMgr.getBatch<number>(["level", "exp", "coin"]);
const playerData = m.storageMgr.getBatch<number>(["level", "exp", "coin"], "player_10001");
```

### `has()` / `remove()` / `removeBatch()` / `keys()` / `clear()`

```ts
/**
 * @param key 单个逻辑键名。
 * @param keys 逻辑键名列表。
 * @param domain 作用域；不传表示全局域。
 */
const exists = m.storageMgr.has("coin");
m.storageMgr.remove("token");
m.storageMgr.removeBatch(["temp_a", "temp_b"]);

const keys = m.storageMgr.keys();
m.storageMgr.clear();

const playerKeys = m.storageMgr.keys("player_10001");
m.storageMgr.clear("player_10001");
```

### `clearMemoryCache()` 清空内存缓存

```ts
/**
 * @param domain 作用域；不传表示清空全部内存缓存，传入时只清理该作用域。
 */
m.storageMgr.clearMemoryCache();
m.storageMgr.clearMemoryCache("player_10001");
```

重要数据不要只依赖客户端存储，服务端仍应做最终校验。

<a id="csvmgr"></a>

## CSV 模块 CsvMgr

`CsvMgr` 负责加载、解析、缓存和查询 CSV 配表。表缓存按 `bundle://name` 区分，因此不同 bundle 可以使用相同的 `name`；同一个 bundle 内 `name` 必须唯一。

### `load()` 加载 CSV

```ts
/**
 * @param item.name 表逻辑名，用于缓存和后续查询。
 * @param item.path CSV 资源路径，不带扩展名。
 * @param item.bundle 资源所属 bundle。
 * @param options.keyField 主键字段名。
 * @param options.typeRow 是否使用类型行，支持 `true`、`false`、`"auto"`。
 * @param options.fieldRow 是否使用英文字段名行，支持 `true`、`false`、`"auto"`。
 * @param options.skipComments 是否跳过空行和 `#` 注释行。
 * @param options.warnOnConvertError 类型转换失败时是否输出警告。
 */
const table = await m.csvMgr.load(
    { name: "test", path: "csv/test", bundle: "resources" },
    { keyField: "key" },
);
```

### `loadBatch()` 批量加载

```ts
/**
 * @param items 表配置数组，每项包含 `name`、`path`、`bundle`。
 * @param options 共用加载与解析选项，会应用到每张表。
 * @returns 返回对象以 `bundle://name` 为 key，避免不同 bundle 的同名表冲突。
 */
const tables = await m.csvMgr.loadBatch([
    { name: "hero", path: "csv/hero", bundle: "resources" },
    { name: "item", path: "csv/item", bundle: "resources" },
]);
```

### `parse()` 解析文本

```ts
/**
 * @param item.name 表逻辑名。
 * @param item.bundle 表所属 bundle。
 * @param text CSV 原始文本。
 * @param options 解析选项；`item` 仍需提供 `name` 和 `bundle`，但 `options` 不包含 `bundle`。
 */
const table = m.csvMgr.parse(
    { name: "inline", bundle: "resources" },
    "id,name\n1,Alice",
    { keyField: "id" },
);
```

### 查询和释放

```ts
/**
 * @param item.name 表逻辑名。
 * @param item.bundle 表所属 bundle。
 * @param id 主键值。
 */
const tableRef = { name: "test", bundle: "resources" } as const;

const table = m.csvMgr.getTable(tableRef);
const row = m.csvMgr.getRow(tableRef, "1001");
const rows = m.csvMgr.getRows(tableRef);
const loaded = m.csvMgr.hasTable(tableRef);

m.csvMgr.release(tableRef);
m.csvMgr.releaseAll();
```

### 表对象接口

```ts
/**
 * @param id 主键值。
 * @param callback 遍历回调，参数为 `row` 和 `index`。
 */
const table = await m.csvMgr.load(
    { name: "hero", path: "csv/hero", bundle: "resources" },
    { keyField: "id" },
);

const hero = table?.get(1001);
const allHeroes = table?.getAll();
const hasHero = table?.has(1001);

table?.forEach((row, index) => {
    m.logMgr.info(index, row);
});
```

<a id="audiomgr"></a>

## 音频模块 AudioMgr

`AudioMgr` 管理 BGM、SFX、音量、静音、任务状态和音频缓存。

SFX 限流会在请求通过限流检查时先占位，避免加载期间的并发窗口；如果加载或播放失败，会回滚占位。

### 池和限流配置

```ts
/**
 * @param sfxPoolMax SFX 音源池最大数量。
 * @param sfxDefaultThrottleMs 同路径 SFX 默认最小播放间隔，单位毫秒。
 */
m.audioMgr.sfxPoolMax = 24;
m.audioMgr.sfxDefaultThrottleMs = 80;
```

### `playBgm()` / `playSfx()` 播放音频

```ts
/**
 * @param item.path 音频资源路径，不带扩展名。
 * @param item.bundle 资源所属 bundle。
 * @param options.loop 是否循环播放，BGM 默认 `true`，SFX 默认 `false`。
 * @param options.volume 任务音量倍率，范围 `0~1`。
 * @param options.fadeIn 淡入时长，单位秒。
 * @param options.fadeOut 淡出时长，单位秒。
 * @param options.throttleMs SFX 本次播放的限流间隔，单位毫秒。
 * @param options.onComplete 自然播放完成回调。
 * @param options.onStop 被中断停止回调。
 */
const bgmId = m.audioMgr.playBgm(
    { path: "audio/bgm_main", bundle: "resources" },
    { loop: true, fadeIn: 1 },
);

const sfxId = m.audioMgr.playSfx(
    { path: "audio/click", bundle: "resources" },
    { throttleMs: 100 },
);
```

### `playBgmClip()` / `playSfxClip()` 播放已加载音频

```ts
/**
 * @param clip 已加载的 `AudioClip`。
 * @param options 播放选项，不包含 `bundle`。
 */
m.audioMgr.playBgmClip(clip, { loop: true });
m.audioMgr.playSfxClip(clip);
```

### 异步播放

```ts
/**
 * @param item.path 音频资源路径，不带扩展名。
 * @param item.bundle 资源所属 bundle。
 * @param options 播放选项，同 `playBgm()` 或 `playSfx()`。
 * @returns `>0` 表示任务 ID，`0` 表示静音，`-1` 表示失败或超时，`-2` 表示 SFX 被限流；超时会自动停止任务。
 */
const bgmId = await m.audioMgr.playBgmAsync({ path: "audio/bgm_main", bundle: "resources" });
const sfxId = await m.audioMgr.playSfxAsync({ path: "audio/click", bundle: "resources" });
```

### 任务控制

```ts
/**
 * @param taskId 播放接口返回的任务 ID，必须大于 `0`。
 * @param immediate 是否立即停止并跳过淡出，默认 `false`。
 * @param cb 回调函数；传 `null` 可清除。
 */
const info = m.audioMgr.getTask(taskId);
m.audioMgr.pauseTask(taskId);
m.audioMgr.resumeTask(taskId);
m.audioMgr.stopTask(taskId);

m.audioMgr.setTaskOnComplete(taskId, () => {
    m.logMgr.info("audio complete");
});

m.audioMgr.setTaskOnStop(taskId, () => {
    m.logMgr.info("audio stopped");
});

m.audioMgr.stopAllTasks(true);
m.audioMgr.stopAllSfx();
```

### BGM 快捷控制

```ts
/**
 * @remarks `pauseBgm()` / `resumeBgm()` / `stopBgm()` 无参数。
 * @returns `currentBgmTaskId` 返回当前 BGM 任务 ID；`isBgmPlaying()` 返回是否正在播放。
 */
m.audioMgr.pauseBgm();
m.audioMgr.resumeBgm();
m.audioMgr.stopBgm();

const currentId = m.audioMgr.currentBgmTaskId;
const isPlaying = m.audioMgr.isBgmPlaying();
```

### 音量和静音

```ts
/**
 * @param volume 音量值，范围 `0~1`。
 * @param mute 是否静音。
 */
m.audioMgr.setBgmVolume(0.8);
m.audioMgr.setSfxVolume(0.7);
m.audioMgr.setBgmMute(false);
m.audioMgr.setSfxMute(false);

const bgmVolume = m.audioMgr.bgmVolume;
const sfxVolume = m.audioMgr.sfxVolume;
const bgmMuted = m.audioMgr.bgmMute;
const sfxMuted = m.audioMgr.sfxMute;
```

### 预加载和释放缓存

```ts
/**
 * @param items 音频资源项数组，每项包含 `path`、`bundle`。
 * @param item 单个音频资源项，包含 `path`、`bundle`。
 */
await m.audioMgr.preload([
    { path: "audio/click", bundle: "resources" },
    { path: "audio/win", bundle: "resources" },
]);
m.audioMgr.releaseClip({ path: "audio/click", bundle: "resources" });
```

<a id="jsbbridgemgr"></a>

## 原生桥接 JsbBridgeMgr

`JsbBridgeMgr` 封装原生平台相关能力。非原生平台会对部分接口返回兼容结果。

### 平台和分享

```ts
/**
 * @param text 要发送给原生分享能力的文本。
 * @returns `isNativePlatform()` 返回当前是否运行在 Android 或 iOS 原生平台。
 */
if (m.jsbBridgeMgr.isNativePlatform()) {
    m.jsbBridgeMgr.shareText("hello");
}
```

### `getAdjustId()` 获取 Adjust ID

```ts
/**
 * @param adjustToken Adjust Token。
 * @param timeout 等待原生回调的超时时间，单位秒，默认 `10`。
 */
const result = await m.jsbBridgeMgr.getAdjustId("adjust-token", 10);
```

### `getDeviceId()` 获取设备 ID

```ts
/**
 * @param timeout 等待原生回调的超时时间，单位秒，默认 `5`。
 */
const deviceId = await m.jsbBridgeMgr.getDeviceId();
```

同一个原生事件不支持并发请求，重复调用会直接返回错误，避免回调错配。

<a id="hotupdatemgr"></a>

## 热更新模块 HotUpdateMgr

`HotUpdateMgr` 用于创建、获取和销毁 bundle 级热更新实例。

### 创建和管理更新器

```ts
/**
 * @param bundleName 要热更新的 bundle 名称。
 * @param updateUrl 热更新服务器基础地址。
 * @param version 目标远程版本号。
 */
const updater = m.hotUpdateMgr.createHotUpdater(
    "game",
    "https://cdn.example.com",
    "1.0.1",
);

const sameUpdater = m.hotUpdateMgr.getHotUpdater("game");
m.hotUpdateMgr.destroyHotUpdater("game");
```

### 执行更新

```ts
/**
 * @param onProgress 进度回调，参数 `progress` 范围为 `0~1`。
 * @returns `startUpdate()` 返回 `true` 表示更新成功，`false` 表示失败或被停止。
 */
updater.onUpdateProgress((progress) => {
    m.logMgr.info("update progress", progress);
});

if (updater.checkUpdate()) {
    const ok = await updater.startUpdate();
}

updater.stopUpdate();
updater.destroy();
```

生产环境建议额外加入 manifest 签名校验、强制 HTTPS 和资源路径白名单。

<a id="dynamic-modules"></a>

## 模块动态加载

`ModuleMgr.ts` 提供模块动态加载和卸载方法。

### `loadModule()` / `unloadModule()`

```ts
/**
 * @param module 要加载的模块实例。
 * @param moduleName 模块名；不传时会尝试读取 `module.key`。
 */
loadModule(customModule, "customModule" as keyof IModuleMap);
unloadModule("audioMgr");
```

卸载模块会触发模块的 `onStop()`，不要随意卸载正在被业务使用的模块。

<a id="conventions"></a>

## 开发约定

- 新 UI 必须注册到 `ViewCtrlClassMap`。
- UI 资源必须使用完整资源项：`path`、`type`、`bundle`。
- UI 资源由框架统一释放，View 不要在 `onDestroy()` 中重复释放 `getRess()`。
- `AssetMgr.load()` 和 `AssetMgr.release()` 要按引用次数配对。
- 业务日志统一使用 `m.logMgr`。
- 原生桥接接口避免同事件并发调用。
- 客户端存储不可作为关键资产的唯一可信来源。
- 热更新上线前应补充签名校验和路径校验。
