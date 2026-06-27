# readme.md UI 文档对齐设计

**日期：** 2026-06-27  
**范围：** 仅更新 `docs/readme.md`，与当前代码严格对齐  
**状态：** 已批准

## 背景

View 管理已改为「`ViewConfig.ts` 集中配置 + 各 bundle `registerXxxViews()` + 直接 `uiMgr.regist`」。`docs/readme.md` 仍描述已不存在的 `registView()`，且缺少 `bundles/` 结构、NodeCtrl 状态机、BaseView 最新行为说明。

## 目标

1. 删除所有 `registView` 相关描述，改为 `uiMgr.regist(ctrl, key)` 实际用法
2. 补充 `assets/bundles/` 项目结构
3. 启动流程明确 `registerMainViews()` 调用时机
4. 新增 NodeCtrl 状态机小节（`isShowed` vs `isShowing`）
5. BaseView 行为与源码一致（`viewConfig` 缓存、`ressItems`、`_mountPrefabView`、`this.key` 查配置）
6. 子 bundle / 热更示例与 `initView.ts` 一致
7. 不提及未使用的 `ViewRegistry.ts`

## 不改范围

- 其他模块章节（AssetMgr、HttpMgr 等）保持现状
- 不改代码、不动其他 md 文件

## 章节变更清单

| 章节 | 变更 |
|------|------|
| 项目结构 | 增加 `bundles/{name}/views/` |
| 架构与启动 | 补充 `registerMainViews()`；代码示例对齐 `main.ts` |
| UI 开发 | 整章重写：职责表、注册流程、生命周期、NodeCtrl 状态、BaseView、热更 |
| 开发约定 · UI | 三句话概括新流程 |

## 验收标准

- 文档中无 `registView` 字样
- 所有 UI 代码示例可与仓库文件逐行对照
- 目录含 NodeCtrl 状态机锚点
