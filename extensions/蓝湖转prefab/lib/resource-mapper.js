/**
 * resource-mapper.js
 *
 * Cocos Creator 3.8.x 资源映射模块。
 *
 * 3.x 中 .meta 文件结构变化：subMetas 为嵌套结构
 * image.meta -> subMetas -> texture(uuid@6c48a) -> subMetas -> sprite-frame(uuid@f9941)
 *
 * .meta 文件结构示例（Cocos Creator 3.x）：
 * {
 *   "ver": "1.0.26",
 *   "importer": "image",
 *   "imported": true,
 *   "uuid": "<image-uuid>",
 *   "files": [".json", ".png"],
 *   "subMetas": {
 *     "6c48a": {
 *       "importer": "texture",
 *       "uuid": "<image-uuid>@6c48a",
 *       "files": [".json"],
 *       "subMetas": {
 *         "f9941": {
 *           "importer": "sprite-frame",
 *           "uuid": "<image-uuid>@f9941",   <-- prefab 需要引用的 uuid
 *           "files": [".json"],
 *           "subMetas": {}
 *         }
 *       }
 *     }
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');

class ResourceMapper {
  constructor(projectPath) {
    this.projectPath = path.resolve(projectPath);
  }

  /**
   * 等待 Cocos 编辑器生成 .meta 文件
   */
  async waitForMeta(imagePath, timeout = 30000, interval = 500) {
    const absImagePath = path.isAbsolute(imagePath)
      ? imagePath
      : path.resolve(this.projectPath, imagePath);
    const metaPath = absImagePath + '.meta';

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (fs.existsSync(metaPath)) {
        try {
          const content = fs.readFileSync(metaPath, 'utf-8');
          JSON.parse(content);
          return metaPath;
        } catch (e) {
          // .meta 文件可能正在写入
        }
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(
      `Timeout waiting for .meta file: ${metaPath} (waited ${timeout}ms)`
    );
  }

  /**
   * 读取 3.x .meta 文件，递归查找 sprite-frame 的 uuid。
   *
   * 3.x 中 spriteFrame uuid 格式为 "<base-uuid>@<sub-id>"，
   * 嵌套在 subMetas -> texture -> subMetas -> sprite-frame 中。
   */
  async getSpriteFrameUuid(imagePath) {
    const absImagePath = path.isAbsolute(imagePath)
      ? imagePath
      : path.resolve(this.projectPath, imagePath);
    const metaPath = absImagePath + '.meta';

    if (!fs.existsSync(metaPath)) {
      throw new Error(`Meta file not found: ${metaPath}`);
    }

    const content = fs.readFileSync(metaPath, 'utf-8');
    let meta;
    try {
      meta = JSON.parse(content);
    } catch (e) {
      throw new Error(`Failed to parse meta file: ${metaPath} - ${e.message}`);
    }

    const textureUuid = meta.uuid;
    if (!textureUuid) {
      throw new Error(`No uuid found in meta file: ${metaPath}`);
    }

    // 递归查找 sprite-frame importer 的 uuid
    const spriteFrameUuid = this._findSpriteFrameUuid(meta.subMetas);
    if (!spriteFrameUuid) {
      throw new Error(
        `No spriteFrame uuid found in meta file: ${metaPath}`
      );
    }

    return {
      spriteFrameUuid: spriteFrameUuid,
      textureUuid: textureUuid,
      metaPath: metaPath,
    };
  }

  /**
   * 递归在 subMetas 中查找 importer === 'sprite-frame' 的条目
   * @private
   */
  _findSpriteFrameUuid(subMetas) {
    if (!subMetas || typeof subMetas !== 'object') return null;

    for (const key of Object.keys(subMetas)) {
      const entry = subMetas[key];

      if (entry.importer === 'sprite-frame' && entry.uuid) {
        return entry.uuid;
      }

      // 递归查找嵌套的 subMetas
      if (entry.subMetas) {
        const found = this._findSpriteFrameUuid(entry.subMetas);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * 批量获取资源映射
   * @returns {Promise<Object<string, {__uuid__: string}>>}
   */
  async mapAll(imagePathMap, options = {}) {
    const { waitForMeta = false, timeout = 30000 } = options;
    const result = {};
    const errors = [];

    for (const [elementName, imagePath] of Object.entries(imagePathMap)) {
      try {
        if (waitForMeta) {
          await this.waitForMeta(imagePath, timeout);
        }

        const { spriteFrameUuid } = await this.getSpriteFrameUuid(imagePath);
        result[elementName] = { __uuid__: spriteFrameUuid };
      } catch (e) {
        errors.push({ elementName, imagePath, error: e.message });
      }
    }

    if (errors.length > 0) {
      console.warn(
        `[ResourceMapper] ${errors.length} element(s) failed to map:`
      );
      for (const err of errors) {
        console.warn(`  - ${err.elementName} (${err.imagePath}): ${err.error}`);
      }
    }

    return result;
  }
}

module.exports = { ResourceMapper };
