# 热更新扩展面板

配合 `HotUpdateMgr` 运行时，提供资源生成与上传编辑器面板。

参考：[Cocos Creator 入门示例-面板](https://docs.cocos.com/creator/3.8/manual/zh/editor/extension/first-panel.html)

## 安装

```bash
cd extensions/hot-update
npm install
npm run build
```

扩展管理器启用后：**面板 → 热更新面板**

## 功能摘要

- **生成远程版本**：从 `build/android` 产物生成 CDN 目录结构（manifest / zips / assets）
- **生成打包版本**：剔除 `data/assets/` 下除 main、internal 外的 Bundle
- **上传远程版本**：差异上传（MD5 比对 + 远程复制 / 本地上传 + 重试兜底）
- **配置自动保存**：面板字段变更防抖写入项目 Profile
- **互斥锁**：三项操作不可并行，执行中全面板锁定

详细说明见 `docs/热更新逻辑说明.md` §17。
