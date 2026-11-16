/**
 * 蓝湖 API 客户端
 *
 * 实际 API 端点：
 *   GET /api/project/images?project_id=PID&team_id=TID   → 画板列表
 *   GET /api/project/image?project_id=PID&team_id=TID&image_id=IMG_ID → 画板详情（含 json_url）
 *   json_url 指向 CDN 上的 PSD 解析 JSON
 *
 * 认证：完整的浏览器 Cookie 字符串
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

class LanhuClient {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    const configPath = path.join(__dirname, '.lanhu-config.json');
    if (fs.existsSync(configPath)) {
      try { return JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) {}
    }
    return { token: '', authType: 'cookie' };
  }

  saveConfig(config) {
    const configPath = path.join(__dirname, '.lanhu-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  /**
   * 主入口：获取设计稿数据
   */
  async fetchDesign(url) {
    const { pid, teamId, imageId } = this.parseUrl(url);

    if (!this.config.token) {
      throw new Error('请先配置蓝湖 Cookie（在插件面板中填写，或命令行: node lanhu-client.js config <cookie>）');
    }
    if (!pid) {
      throw new Error('无法从链接中解析出项目 ID (pid)');
    }

    console.log(`正在获取设计稿 (pid: ${pid}${imageId ? ', image_id: ' + imageId : ''})...`);

    // 如果 URL 中指定了 image_id，直接获取该画板
    let targetImageId = imageId;
    let projectName = 'LanhuPanel';

    if (!targetImageId) {
      // 没指定画板，获取画板列表取第一个
      const params = { project_id: pid };
      if (teamId) params.team_id = teamId;

      const projectData = await this.callAPI('/api/project/images', params);
      const images = projectData.images || [];
      projectName = projectData.name || 'LanhuPanel';

      console.log(`项目: ${projectName}, 画板数: ${images.length}`);

      if (images.length === 0) {
        return { name: projectName, width: 750, height: 1334, elements: [] };
      }

      targetImageId = images[0].id;
    }

    // 获取画板详情（含 json_url）
    const detailParams = { project_id: pid, image_id: targetImageId };
    if (teamId) detailParams.team_id = teamId;

    const detail = await this.callAPI('/api/project/image', detailParams);
    const imageName = detail.name || projectName;
    const latestVersion = (detail.versions && detail.versions.length > 0)
      ? detail.versions[0]
      : null;

    if (!latestVersion || !latestVersion.json_url) {
      console.warn('该画板没有设计 JSON（需要有代码标注的切图才有图层数据），仅返回基础信息');
      return {
        name: imageName,
        width: latestVersion ? latestVersion.width : 750,
        height: latestVersion ? latestVersion.height : 1334,
        elements: []
      };
    }

    // 从 CDN 获取 PSD 解析后的设计 JSON
    console.log(`正在获取画板 "${imageName}" 的设计数据...`);
    const designJson = await this.fetchJson(latestVersion.json_url);

    return this.transformDesignJson(designJson, imageName);
  }

  /**
   * 将蓝湖 PSD JSON 转换为标准格式
   *
   * 蓝湖 JSON 结构：
   * { board: { name, artboard: { artboardRect: {top,left,bottom,right} }, layers: [...] } }
   *
   * 图层类型：layer(图片), textLayer(文字), layerSection(分组), shapeLayer(形状)
   */
  transformDesignJson(json, fallbackName) {
    const board = json.board || json;
    const rect = (board.artboard && board.artboard.artboardRect) || {};
    const width = (rect.right || 0) - (rect.left || 0) || 750;
    const height = (rect.bottom || 0) - (rect.top || 0) || 1334;

    return {
      name: board.name || fallbackName || 'LanhuPanel',
      width: width,
      height: height,
      elements: this.parseLayers(board.layers || [], rect.left || 0, rect.top || 0)
    };
  }

  /**
   * 递归解析图层
   * @param {Array} layers - 蓝湖图层数组
   * @param {number} offsetX - 画板左偏移（减去后得到相对坐标）
   * @param {number} offsetY - 画板上偏移
   */
  parseLayers(layers, offsetX, offsetY) {
    const result = [];

    // PSD 图层顺序：第一个在最上面（前景），最后一个在最下面（背景）
    // Cocos _children 顺序：索引越大越在上面
    // 所以需要反转，让 PSD 最底层的图层排在 Cocos _children 前面
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      // 跳过不可见图层
      if (layer.visible === false) continue;
      // 跳过调整图层
      if (layer.type === 'adjustmentLayer') continue;

      const parsed = this.parseLayer(layer, offsetX, offsetY);
      if (parsed) result.push(parsed);
    }

    return result;
  }

  /**
   * 解析单个图层
   *
   * offsetX/offsetY 是父容器的绝对坐标（画板坐标系）。
   * PSD 中所有坐标都是画板绝对坐标，需要减去父容器偏移才能得到相对坐标。
   */
  parseLayer(layer, offsetX, offsetY) {
    const bounds = layer.bounds || {};
    // 图层在画板中的绝对坐标
    const absX = layer.left !== undefined ? layer.left : (bounds.left || 0);
    const absY = layer.top !== undefined ? layer.top : (bounds.top || 0);
    const w = layer.width || ((bounds.right || 0) - (bounds.left || 0)) || 0;
    const h = layer.height || ((bounds.bottom || 0) - (bounds.top || 0)) || 0;

    // 相对于父容器左上角的坐标
    const x = absX - offsetX;
    const y = absY - offsetY;

    // 跳过零尺寸图层
    if (w <= 0 || h <= 0) return null;

    const type = this.mapLayerType(layer);
    const name = layer.name || '';

    const element = {
      type: type,
      name: name,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(w),
      height: Math.round(h)
    };

    // 文字属性 — PSD JSON 中文字内容在 textInfo 里
    if (layer.type === 'textLayer') {
      const ti = layer.textInfo;
      if (ti) {
        element.text = ti.text || layer.name || '';
        element.fontSize = ti.sizePt || ti.size || undefined;
        if (ti.color) {
          const c = ti.color;
          element.color = '#' +
            Math.round(c.r != null ? c.r : (c.red != null ? c.red : 255)).toString(16).padStart(2, '0') +
            Math.round(c.g != null ? c.g : (c.green != null ? c.green : 255)).toString(16).padStart(2, '0') +
            Math.round(c.b != null ? c.b : (c.blue != null ? c.blue : 255)).toString(16).padStart(2, '0');
        }
      } else {
        element.text = layer.name || '';
      }

      // 字体信息
      if (ti) {
        element.fontName = ti.fontName || undefined;
        element.fontPostScriptName = ti.fontPostScriptName || undefined;
        element.fontStyleName = ti.fontStyleName || undefined;
      }

      // 描边（frameFX）
      const fx = layer.layerEffects;
      if (fx && fx.frameFX && fx.frameFX.enabled) {
        const stroke = fx.frameFX;
        const sc = stroke.color || {};
        element.outline = {
          width: stroke.size || 2,
          color: '#' +
            Math.round(sc.r != null ? sc.r : (sc.red != null ? sc.red : 0)).toString(16).padStart(2, '0') +
            Math.round(sc.g != null ? sc.g : (sc.green != null ? sc.green : 0)).toString(16).padStart(2, '0') +
            Math.round(sc.b != null ? sc.b : (sc.blue != null ? sc.blue : 0)).toString(16).padStart(2, '0')
        };
      }

      // 投影（dropShadow）
      if (fx && fx.dropShadow && fx.dropShadow.enabled) {
        const ds = fx.dropShadow;
        const dc = ds.color || {};
        element.shadow = {
          color: '#' +
            Math.round(dc.r != null ? dc.r : (dc.red != null ? dc.red : 0)).toString(16).padStart(2, '0') +
            Math.round(dc.g != null ? dc.g : (dc.green != null ? dc.green : 0)).toString(16).padStart(2, '0') +
            Math.round(dc.b != null ? dc.b : (dc.blue != null ? dc.blue : 0)).toString(16).padStart(2, '0'),
          offsetX: ds.distance || 0,
          offsetY: ds.distance || 0,
          blur: ds.blur || 0
        };
      }
    }

    // 图片 URL
    if (layer.images) {
      element.imageUrl = layer.images.png_xxxhd || layer.images.png_xxhd || layer.images.png_xhd || layer.images.base;
    }
    if (layer.ddsImages && layer.ddsImages.orgUrl) {
      element.imageUrl = element.imageUrl || layer.ddsImages.orgUrl;
    }

    // 分组图层 → 递归子图层，用当前图层的绝对坐标作为子图层的偏移基准
    if (layer.type === 'layerSection' && layer.layers) {
      element.children = this.parseLayers(layer.layers, absX, absY);
      // 如果分组内没有有效子元素，跳过
      if (element.children.length === 0 && !element.imageUrl) return null;
    }

    return element;
  }

  /**
   * 映射蓝湖图层类型到标准类型
   */
  mapLayerType(layer) {
    if (layer.type === 'textLayer') return 'text';

    // 有图片资源的 layer/shapeLayer 当作 image
    if (layer.images || (layer.ddsImages && layer.ddsImages.orgUrl)) return 'image';

    // layerSection 是分组
    if (layer.type === 'layerSection') return 'container';

    // shapeLayer 无图片当作 image（有形状填充）
    if (layer.type === 'shapeLayer') return 'image';

    // 普通 layer 有像素数据
    if (layer.type === 'layer' && layer.pixels) return 'image';

    return 'container';
  }

  // === 网络层 ===

  _buildHeaders() {
    const authType = this.config.authType || 'cookie';
    const headers = {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9'
    };

    if (authType === 'api') {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    } else {
      headers['cookie'] = this.config.token;
      headers['request-from'] = 'web';
      headers['referer'] = 'https://lanhuapp.com/web/';
      headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
    }
    return headers;
  }

  async callAPI(endpoint, params) {
    const filteredParams = {};
    for (const [k, v] of Object.entries(params || {})) {
      if (v != null && v !== '') filteredParams[k] = v;
    }
    const query = new URLSearchParams(filteredParams).toString();
    const urlStr = query
      ? `https://lanhuapp.com${endpoint}?${query}`
      : `https://lanhuapp.com${endpoint}`;

    const text = await this._httpGet(urlStr, this._buildHeaders());
    const parsed = JSON.parse(text);

    if (parsed.code && parsed.code !== '00000' && parsed.code !== 0) {
      throw new Error(`蓝湖 API 错误 (${parsed.code}): ${parsed.msg || ''}`);
    }

    return parsed.data !== undefined ? parsed.data : (parsed.result !== undefined ? parsed.result : parsed);
  }

  async fetchJson(url) {
    const text = await this._httpGet(url, { 'accept': '*/*', 'user-agent': 'Mozilla/5.0' });
    return JSON.parse(text);
  }

  _httpGet(url, headers, redirectCount) {
    redirectCount = redirectCount || 0;
    if (redirectCount > 5) return Promise.reject(new Error('重定向次数过多'));

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.request({
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: headers
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          this._httpGet(new URL(res.headers.location, url).href, headers, redirectCount + 1)
            .then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new Error('认证失败，请重新复制浏览器 Cookie'));
          } else if (res.statusCode === 418) {
            reject(new Error('权限不足 (418)，请确认项目访问权限并使用完整 Cookie'));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('请求超时')); });
      req.end();
    });
  }

  parseUrl(url) {
    const pidMatch = url.match(/pid=([^&#]+)/);
    const teamIdMatch = url.match(/teamId=([^&#]+)/);
    const imageIdMatch = url.match(/image_id=([^&#]+)/);
    return {
      pid: pidMatch ? pidMatch[1] : null,
      teamId: teamIdMatch ? teamIdMatch[1] : null,
      imageId: imageIdMatch ? imageIdMatch[1] : null
    };
  }
}

// CLI
if (require.main === module) {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  const authType = process.argv[4] || 'cookie';
  const client = new LanhuClient();

  if (cmd === 'config') {
    if (!arg) {
      console.error('用法: node lanhu-client.js config <完整Cookie字符串> [cookie|api]');
      process.exit(1);
    }
    client.saveConfig({ token: arg, authType });
    console.log('已保存 (' + authType + ')');
  } else if (cmd === 'test') {
    if (!arg) { console.error('用法: node lanhu-client.js test <蓝湖链接>'); process.exit(1); }
    client.fetchDesign(arg)
      .then(data => console.log(JSON.stringify(data, null, 2)))
      .catch(err => console.error('错误:', err.message));
  } else {
    console.log('用法:');
    console.log('  配置: node lanhu-client.js config <Cookie> [cookie|api]');
    console.log('  测试: node lanhu-client.js test <蓝湖链接>');
  }
}

module.exports = { LanhuClient };
