'use strict';

const path = require('path');
const fs = require('fs');

const { CocosGenerator } = require('./lib/generator');
const { LanhuClient } = require('./lib/lanhu-client');
const { ImageDownloader } = require('./lib/downloader');
const { ResourceMapper } = require('./lib/resource-mapper');

// === 配置管理 ===

function getConfigPath() {
  return path.join(__dirname, '.lanhu-config.json');
}

function loadConfig() {
  var configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
  }
  return { token: '', authType: 'cookie' };
}

function saveConfig(config) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

// === 类型映射 ===

var TYPE_MAP = {
  'text': 'cc.Label',
  'image': 'cc.Sprite',
  'button': 'cc.Button',
  'container': 'cc.Node'
};

function mapElementTypes(elements) {
  return elements.map(function (el) {
    return Object.assign({}, el, {
      type: TYPE_MAP[el.type] || el.type,
      children: el.children ? mapElementTypes(el.children) : []
    });
  });
}

function extractImageList(elements) {
  var list = [];
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (el.imageUrl) {
      list.push({ name: el.name, url: el.imageUrl });
    }
    if (el.children) {
      list.push.apply(list, extractImageList(el.children));
    }
  }
  return list;
}

function createClient() {
  var client = new LanhuClient();
  var config = loadConfig();
  if (config.token) {
    client.config = config;
  }
  return client;
}

/**
 * 扫描项目字体文件，构建 { fontBaseName: uuid } 映射
 */
function buildFontMap(projectPath) {
  var fontDir = path.join(projectPath, 'assets/resources/font');
  var fontMap = {};
  try {
    var files = fs.readdirSync(fontDir);
    files.forEach(function (file) {
      if (!/\.(ttf|otf)$/i.test(file)) return;
      var metaPath = path.join(fontDir, file + '.meta');
      if (!fs.existsSync(metaPath)) return;
      try {
        var meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.uuid) {
          var baseName = file.replace(/\.(ttf|otf)$/i, '');
          fontMap[baseName] = meta.uuid;
        }
      } catch (e) {}
    });
  } catch (e) {}
  return fontMap;
}

// === 3.x 扩展入口 ===

exports.load = function () {
  console.log('[蓝湖转Prefab] 插件已加载');
};

exports.unload = function () {
  console.log('[蓝湖转Prefab] 插件已卸载');
};

exports.methods = {
  openPanel() {
    Editor.Panel.open('lanhu-to-prefab');
  },

  saveToken(token, authType) {
    try {
      if (typeof token === 'object') {
        authType = token.authType || 'cookie';
        token = token.token || '';
      }
      var config = loadConfig();
      config.token = token;
      config.authType = authType || 'cookie';
      saveConfig(config);
      console.log('[蓝湖转Prefab] Token 已保存 (方式: ' + config.authType + ')');
      return { success: true };
    } catch (error) {
      console.error('[蓝湖转Prefab] Token 保存失败:', error);
      return { success: false, error: error.message };
    }
  },

  getTokenStatus() {
    var config = loadConfig();
    var maskedToken = '';
    if (config.token) {
      var t = config.token;
      maskedToken = t.length > 16
        ? t.substring(0, 6) + '...' + t.substring(t.length - 6)
        : '******';
    }
    return {
      hasToken: !!config.token,
      authType: config.authType || 'cookie',
      maskedToken: maskedToken
    };
  },

  saveDirs(prefabDir, textureDir) {
    try {
      var config = loadConfig();
      config.prefabDir = prefabDir || '';
      config.textureDir = textureDir || '';
      saveConfig(config);
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  },

  getDirs() {
    var config = loadConfig();
    return {
      prefabDir: config.prefabDir || '',
      textureDir: config.textureDir || ''
    };
  },

  async convert(options) {
    var url = typeof options === 'string' ? options : options.url;
    var prefabName = (options && options.prefabName) || '';
    var prefabDir = (options && options.prefabDir) || 'assets/resources/prefab/generated';
    var textureDir = (options && options.textureDir) || 'assets/resources/textures/generated';

    console.log('[蓝湖转Prefab] 开始转换:', url);
    console.log('[蓝湖转Prefab] Prefab目录:', prefabDir, '图片目录:', textureDir);

    var projectPath = Editor.Project.path;
    var client = createClient();
    var downloader = new ImageDownloader(projectPath, textureDir);
    var mapper = new ResourceMapper(projectPath);

    try {
      var designData = await client.fetchDesign(url);
      if (prefabName) {
        designData.name = prefabName;
      }
      console.log('[蓝湖转Prefab] 设计稿获取成功:', designData.name);

      designData.elements = mapElementTypes(designData.elements);

      var resourceMap = {};
      var imageList = extractImageList(designData.elements);

      if (imageList.length > 0) {
        var downloadedMap = await downloader.downloadAll(imageList);
        console.log('[蓝湖转Prefab] 图片下载完成，刷新资源...');

        await Editor.Message.request('asset-db', 'refresh-asset', 'db://' + textureDir);
        resourceMap = await mapper.mapAll(downloadedMap, { waitForMeta: true, timeout: 30000 });
      }

      var generator = new CocosGenerator();
      var fontMap = buildFontMap(projectPath);
      console.log('[蓝湖转Prefab] 字体映射:', Object.keys(fontMap).join(', ') || '无');

      var prefabPath = await generator.generate(designData, projectPath, resourceMap, fontMap, prefabDir);
      console.log('[蓝湖转Prefab] 生成成功:', prefabPath);

      await Editor.Message.request('asset-db', 'refresh-asset', 'db://' + prefabDir);

      return { success: true, path: prefabPath };
    } catch (error) {
      console.error('[蓝湖转Prefab] 转换失败:', error);
      return { success: false, error: error.message };
    }
  },

  async convertMock(options) {
    var url = (typeof options === 'string' ? options : (options && options.url))
      || 'https://lanhu.gg/mock?pid=test1234&teamId=1';
    var prefabName = (options && options.prefabName) || '';

    console.log('[蓝湖转Prefab] 模拟转换:', url);

    var pidMatch = url.match(/pid=([^&#]+)/);
    var pid = pidMatch ? pidMatch[1] : 'unknown';
    var generator = new CocosGenerator();

    var designData = {
      name: prefabName || ('Lanhu_' + pid.substring(0, 8)),
      width: 750,
      height: 1334,
      elements: [
        { type: 'cc.Sprite', name: 'bg', x: 0, y: 0, width: 750, height: 1334 },
        { type: 'cc.Label', name: 'title', x: 175, y: 200, width: 400, height: 60, text: '蓝湖设计稿', fontSize: 48, color: '#333333' },
        { type: 'cc.Button', name: 'btn_action', x: 225, y: 800, width: 300, height: 80, children: [
          { type: 'cc.Label', name: 'label', x: 50, y: 20, width: 200, height: 40, text: '按钮', fontSize: 32 }
        ]}
      ]
    };

    try {
      var prefabPath = await generator.generate(designData, Editor.Project.path);
      console.log('[蓝湖转Prefab] 模拟生成成功:', prefabPath);

      await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/resources/prefab/generated');

      return { success: true, path: prefabPath };
    } catch (error) {
      console.error('[蓝湖转Prefab] 模拟转换失败:', error);
      return { success: false, error: error.message };
    }
  }
};
