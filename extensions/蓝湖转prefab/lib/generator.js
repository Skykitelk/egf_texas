/**
 * Cocos Creator 3.8.x Prefab 生成器
 *
 * 3.x 与 2.x 的主要差异：
 * - Node 使用 _lpos(Vec3) / _lrot(Quat) / _lscl(Vec3) 代替 _trs
 * - 尺寸/锚点放在 cc.UITransform 组件上，不再在 Node._contentSize
 * - 每个 UI 节点都需要 UITransform 组件
 * - _layer 字段: UI_2D = 1 << 25 = 33554432
 * - 组件不再有 _materials，使用 _customMaterial
 * - Sprite/Label 的 _color 在组件自身上
 * - PrefabInfo 结构变化
 */
const fs = require('fs').promises;
const path = require('path');

class CocosGenerator {
  constructor() {
    this.objects = [];
  }

  push(obj) {
    const id = this.objects.length;
    this.objects.push(obj);
    return id;
  }

  async generate(designData, projectPath, resourceMap, fontMap, prefabDir) {
    this.resourceMap = resourceMap || {};
    this.fontMap = fontMap || {};
    const prefabData = this.createPrefab(designData);
    const basePath = projectPath || process.cwd();
    const outputDir = prefabDir || 'assets/resources/prefab/generated';
    const outputPath = path.join(basePath, outputDir, `${designData.name}.prefab`);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(prefabData, null, 2));

    return outputPath;
  }

  createPrefab(designData) {
    this.objects = [];
    this.designHeight = designData.height;

    // [0] cc.Prefab
    this.push({
      __type__: "cc.Prefab",
      _name: "",
      _objFlags: 0,
      _native: "",
      data: { __id__: 1 },
      optimizationPolicy: 0,
      persistent: false
    });

    // 创建根节点
    const rootId = this.createNode(designData.name, {
      width: designData.width,
      height: designData.height,
      x: 0,
      y: 0
    }, null);

    // 创建子元素
    designData.elements.forEach(el => {
      this.createElementNode(el, rootId);
    });

    return this.objects;
  }

  generateFileId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    for (let i = 0; i < 22; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 创建 3.x 节点：Node + UITransform + PrefabInfo
   */
  createNode(name, props, parentId) {
    const x = props.x || 0;
    const y = props.y || 0;

    // 预留 Node 位置
    const nodeId = this.push(null);

    // UITransform 组件
    const uiTransformId = this.push({
      __type__: "cc.UITransform",
      _name: "",
      _objFlags: 0,
      node: { __id__: nodeId },
      _enabled: true,
      _contentSize: {
        __type__: "cc.Size",
        width: props.width || 100,
        height: props.height || 100
      },
      _anchorPoint: { __type__: "cc.Vec2", x: 0.5, y: 0.5 },
      _id: ""
    });

    // PrefabInfo
    const prefabInfoId = this.push({
      __type__: "cc.PrefabInfo",
      root: { __id__: 1 },
      asset: { __id__: 0 },
      fileId: this.generateFileId()
    });

    // Node
    const node = {
      __type__: "cc.Node",
      _name: name,
      _objFlags: 0,
      _parent: parentId !== null ? { __id__: parentId } : null,
      _children: [],
      _active: true,
      _components: [{ __id__: uiTransformId }],
      _prefab: { __id__: prefabInfoId },
      _lpos: { __type__: "cc.Vec3", x: x, y: y, z: 0 },
      _lrot: { __type__: "cc.Quat", x: 0, y: 0, z: 0, w: 1 },
      _lscl: { __type__: "cc.Vec3", x: 1, y: 1, z: 1 },
      _mobility: 0,
      _layer: 33554432,
      _euler: { __type__: "cc.Vec3", x: 0, y: 0, z: 0 },
      _id: ""
    };

    this.objects[nodeId] = node;

    if (parentId !== null) {
      this.objects[parentId]._children.push({ __id__: nodeId });
    }

    return nodeId;
  }

  parseColor(colorStr) {
    if (!colorStr) return { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 };
    if (colorStr.startsWith('#')) {
      const hex = colorStr.replace('#', '');
      return {
        __type__: "cc.Color",
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255
      };
    }
    return { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 };
  }

  createElementNode(element, parentId) {
    // 找到父节点的 UITransform 获取尺寸
    const parentUITransform = this.findUITransform(parentId);
    const parentW = parentUITransform ? parentUITransform._contentSize.width : 100;
    const parentH = parentUITransform ? parentUITransform._contentSize.height : 100;

    // 蓝湖坐标(左上角) -> Cocos坐标(中心锚点)
    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;
    const cocosX = centerX - parentW / 2;
    const cocosY = parentH / 2 - centerY;

    const nodeId = this.createNode(element.name, {
      width: element.width,
      height: element.height,
      x: cocosX,
      y: cocosY,
      color: element.color
    }, parentId);

    if (element.type === 'cc.Label') {
      // 3.x 中描边/投影已内联到 Label 组件，element 整体传入
      this.addLabelComponent(nodeId, element);
    } else if (element.type === 'cc.Sprite') {
      this.addSpriteComponent(nodeId, element);
    } else if (element.type === 'cc.Button') {
      this.addSpriteComponent(nodeId, element);
      this.addButtonComponent(nodeId, element);
    }

    if (element.children) {
      element.children.forEach(child => {
        this.createElementNode(child, nodeId);
      });
    }

    return nodeId;
  }

  /**
   * 查找节点的 UITransform 组件
   */
  findUITransform(nodeId) {
    const node = this.objects[nodeId];
    if (!node || !node._components) return null;
    for (const compRef of node._components) {
      const comp = this.objects[compRef.__id__];
      if (comp && comp.__type__ === 'cc.UITransform') {
        return comp;
      }
    }
    return null;
  }

  /**
   * 根据蓝湖字体名匹配项目字体 uuid
   */
  matchFont(element) {
    if (!this.fontMap || Object.keys(this.fontMap).length === 0) return null;

    const names = [
      element.fontPostScriptName,
      element.fontName && element.fontStyleName
        ? element.fontName.replace(/\s/g, '') + '-' + element.fontStyleName
        : null,
      element.fontName
    ].filter(Boolean);

    for (const name of names) {
      const lower = name.toLowerCase().replace(/\s/g, '');
      for (const [fileName, uuid] of Object.entries(this.fontMap)) {
        const fileLower = fileName.toLowerCase().replace(/\s/g, '');
        if (fileLower.includes(lower) || lower.includes(fileLower)) {
          return uuid;
        }
      }
    }
    return null;
  }

  addLabelComponent(nodeId, element) {
    const fontUuid = this.matchFont(element);
    const color = element.color ? this.parseColor(element.color) : { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 };

    // 3.x 中描边和投影是 Label 组件的内联字段，不再是独立组件
    const hasOutline = !!element.outline;
    const hasShadow = !!element.shadow;
    const outlineColor = hasOutline
      ? this.parseColor(element.outline.color)
      : { __type__: "cc.Color", r: 0, g: 0, b: 0, a: 255 };
    const shadowColor = hasShadow
      ? this.parseColor(element.shadow.color)
      : { __type__: "cc.Color", r: 0, g: 0, b: 0, a: 255 };

    const compId = this.push({
      __type__: "cc.Label",
      _name: "",
      _objFlags: 0,
      node: { __id__: nodeId },
      _enabled: true,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: color,
      _string: element.text || "",
      _horizontalAlign: 1,
      _verticalAlign: 1,
      _actualFontSize: Math.round(element.fontSize || 24),
      _fontSize: Math.round(element.fontSize || 24),
      _fontFamily: "Arial",
      _lineHeight: Math.round((element.fontSize || 24) * 1.2),
      _overflow: 0,
      _enableWrapText: true,
      _font: fontUuid ? { __uuid__: fontUuid } : null,
      _isSystemFontUsed: !fontUuid,
      _spacingX: 0,
      _isItalic: false,
      _isBold: false,
      _isUnderline: false,
      _underlineHeight: 2,
      _cacheMode: 0,
      _enableOutline: hasOutline,
      _outlineColor: outlineColor,
      _outlineWidth: hasOutline ? Math.round(element.outline.width || 2) : 2,
      _enableShadow: hasShadow,
      _shadowColor: shadowColor,
      _shadowOffset: hasShadow
        ? { __type__: "cc.Vec2", x: element.shadow.offsetX || 2, y: -(element.shadow.offsetY || 2) }
        : { __type__: "cc.Vec2", x: 2, y: 2 },
      _shadowBlur: hasShadow ? (element.shadow.blur || 2) : 2,
      _id: ""
    });
    this.objects[nodeId]._components.push({ __id__: compId });
  }

  addSpriteComponent(nodeId, element) {
    const spriteFrameRef = this.resourceMap[element.name]
      ? { __uuid__: this.resourceMap[element.name].__uuid__, __expectedType__: "cc.SpriteFrame" }
      : null;

    const compId = this.push({
      __type__: "cc.Sprite",
      _name: "",
      _objFlags: 0,
      node: { __id__: nodeId },
      _enabled: true,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
      _spriteFrame: spriteFrameRef,
      _type: 0,
      _fillType: 0,
      _sizeMode: 0,
      _fillCenter: { __type__: "cc.Vec2", x: 0, y: 0 },
      _fillStart: 0,
      _fillRange: 0,
      _isTrimmedMode: true,
      _useGrayscale: false,
      _atlas: null,
      _id: ""
    });
    this.objects[nodeId]._components.push({ __id__: compId });
  }

  addButtonComponent(nodeId, element) {
    const compId = this.push({
      __type__: "cc.Button",
      _name: "",
      _objFlags: 0,
      node: { __id__: nodeId },
      _enabled: true,
      _interactable: true,
      _transition: 3,
      _normalColor: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
      _pressedColor: { __type__: "cc.Color", r: 211, g: 211, b: 211, a: 255 },
      _hoverColor: { __type__: "cc.Color", r: 255, g: 255, b: 255, a: 255 },
      _disabledColor: { __type__: "cc.Color", r: 124, g: 124, b: 124, a: 255 },
      _duration: 0.1,
      _zoomScale: 1.2,
      _target: { __id__: nodeId },
      clickEvents: [],
      _id: ""
    });
    this.objects[nodeId]._components.push({ __id__: compId });
  }
}

module.exports = { CocosGenerator };
