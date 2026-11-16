'use strict';

const packageName = 'lanhu-to-prefab';

exports.style = `
  :host { margin: 10px; }
  .container { display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row label { width: 80px; flex-shrink: 0; font-size: 12px; }
  .row ui-input, .row ui-select { flex: 1; }
  .btn-group { display: flex; gap: 8px; margin-top: 5px; }
  ui-button.convert { color: #fff; }
  .section { border-bottom: 1px solid #e0e0e0; padding-bottom: 10px; margin-bottom: 5px; }
  .section-title { font-size: 13px; font-weight: bold; margin-bottom: 8px; }
  .token-status { font-size: 11px; color: #999; margin-left: 4px; }
  .token-status.ok { color: #67c23a; }
  .hint { font-size: 11px; color: #999; margin-left: 80px; }
  .result { margin-top: 10px; padding: 10px; background: #f0f0f0; border-radius: 4px; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
  .success { background: #e7f7e7; }
  .error { background: #ffe7e7; }
`;

exports.template = `
<div class="container">
  <h2>蓝湖设计稿转 Prefab (3.x)</h2>

  <div class="section">
    <div class="section-title">认证配置 <span id="token-status" class="token-status">未配置</span></div>
    <div class="row">
      <label>认证方式：</label>
      <ui-select id="auth-type">
        <option value="cookie">Cookie Token</option>
        <option value="api">API Token</option>
      </ui-select>
    </div>
    <div class="row">
      <label id="token-label">Token：</label>
      <ui-input id="token" type="password" placeholder="粘贴浏览器 Cookie 中的 user_token 值"></ui-input>
      <ui-button id="save-token" type="warn">保存</ui-button>
    </div>
    <div id="hint" class="hint">从浏览器 F12 -> Application -> Cookies 中复制 user_token 的值</div>
  </div>

  <div class="section">
    <div class="section-title">转换</div>
    <div class="row">
      <label>蓝湖链接：</label>
      <ui-input id="url" placeholder="输入蓝湖设计稿链接"></ui-input>
    </div>
    <div class="row">
      <label>Prefab名称：</label>
      <ui-input id="prefab-name" placeholder="默认使用设计稿名称"></ui-input>
    </div>
    <div class="row">
      <label>Prefab目录：</label>
      <ui-input id="prefab-dir" placeholder="默认: assets/resources/prefab/generated"></ui-input>
    </div>
    <div class="row">
      <label>图片目录：</label>
      <ui-input id="texture-dir" placeholder="默认: assets/resources/textures/generated"></ui-input>
    </div>
    <div class="btn-group">
      <ui-button id="convert" type="primary" class="convert">转换</ui-button>
      <ui-button id="convert-mock" type="success" class="convert">模拟转换</ui-button>
    </div>
  </div>

  <div id="result" class="result" style="display:none;"></div>
</div>
`;

exports.$ = {
  authType: '#auth-type',
  token: '#token',
  tokenLabel: '#token-label',
  hint: '#hint',
  saveToken: '#save-token',
  tokenStatus: '#token-status',
  url: '#url',
  prefabName: '#prefab-name',
  prefabDir: '#prefab-dir',
  textureDir: '#texture-dir',
  convert: '#convert',
  convertMock: '#convert-mock',
  result: '#result',
};

exports.methods = {
  showResult(success, msg) {
    this.$.result.textContent = msg;
    this.$.result.className = 'result ' + (success ? 'success' : 'error');
    this.$.result.style.display = 'block';
  },

  setLoading(loading) {
    this.$.convert.disabled = loading;
    this.$.convertMock.disabled = loading;
    if (loading) {
      this.$.convert.textContent = '转换中...';
    } else {
      this.$.convert.textContent = '转换';
    }
  },

  updateTokenStatus(hasToken, authType) {
    if (hasToken) {
      var label = authType === 'api' ? 'API Token 已配置' : 'Cookie Token 已配置';
      this.$.tokenStatus.textContent = label;
      this.$.tokenStatus.className = 'token-status ok';
    } else {
      this.$.tokenStatus.textContent = '未配置';
      this.$.tokenStatus.className = 'token-status';
    }
  },

  updateAuthUI() {
    var type = this.$.authType.value;
    if (type === 'api') {
      this.$.tokenLabel.textContent = 'API Key：';
      this.$.token.setAttribute('placeholder', '输入蓝湖开放平台 API Token');
      this.$.hint.textContent = '在蓝湖「团队设置 -> 开放平台」中获取 API Token';
    } else {
      this.$.tokenLabel.textContent = 'Cookie：';
      this.$.token.setAttribute('placeholder', '粘贴浏览器请求头中完整的 Cookie 值');
      this.$.hint.textContent = 'F12 -> Network -> 任意 lanhuapp.com 请求 -> 复制 Cookie 请求头的完整值';
    }
  },
};

exports.ready = async function () {
  var self = this;

  this.$.authType.addEventListener('change', function () {
    self.updateAuthUI();
  });

  // 加载 token 状态
  try {
    var result = await Editor.Message.request(packageName, 'get-token-status');
    if (result) {
      self.updateTokenStatus(result.hasToken, result.authType);
      if (result.authType) {
        self.$.authType.value = result.authType;
        self.updateAuthUI();
      }
      if (result.maskedToken) {
        self.$.token.setAttribute('placeholder', '已保存: ' + result.maskedToken);
      }
    }
  } catch (e) {
    console.warn('[蓝湖转Prefab] 获取 token 状态失败:', e);
  }

  // 加载缓存的目录
  try {
    var dirs = await Editor.Message.request(packageName, 'get-dirs');
    if (dirs) {
      if (dirs.prefabDir) self.$.prefabDir.value = dirs.prefabDir;
      if (dirs.textureDir) self.$.textureDir.value = dirs.textureDir;
    }
  } catch (e) {
    console.warn('[蓝湖转Prefab] 获取目录缓存失败:', e);
  }

  // 保存 token
  this.$.saveToken.addEventListener('confirm', async function () {
    var token = self.$.token.value.trim();
    var authType = self.$.authType.value;
    if (!token) {
      self.showResult(false, '请输入 Token');
      return;
    }

    try {
      var result = await Editor.Message.request(packageName, 'save-token', token, authType);
      if (result && result.success) {
        self.$.token.value = '';
        self.updateTokenStatus(true, authType);
        self.showResult(true, 'Token 保存成功');
      } else {
        self.showResult(false, '保存失败: ' + (result ? result.error : '未知错误'));
      }
    } catch (e) {
      self.showResult(false, '保存失败: ' + e.message);
    }
  });

  // 真实转换
  this.$.convert.addEventListener('confirm', async function () {
    var url = self.$.url.value.trim();
    if (!url) {
      self.showResult(false, '请输入蓝湖链接');
      return;
    }

    self.setLoading(true);
    self.$.result.style.display = 'none';

    try {
      var prefabDir = self.$.prefabDir.value.trim() || '';
      var textureDir = self.$.textureDir.value.trim() || '';
      // 缓存目录设置
      Editor.Message.send(packageName, 'save-dirs', prefabDir, textureDir);
      var options = {
        url: url,
        prefabName: self.$.prefabName.value.trim() || '',
        prefabDir: prefabDir,
        textureDir: textureDir
      };
      var result = await Editor.Message.request(packageName, 'convert', options);
      self.setLoading(false);
      if (result && result.success) {
        self.showResult(true, '转换成功!\n生成路径: ' + result.path);
      } else {
        self.showResult(false, '转换失败: ' + (result ? result.error : '未知错误'));
      }
    } catch (e) {
      self.setLoading(false);
      self.showResult(false, '错误: ' + e.message);
    }
  });

  // 模拟转换
  this.$.convertMock.addEventListener('confirm', async function () {
    var url = self.$.url.value.trim() || 'https://lanhu.gg/mock?pid=test1234&teamId=1';

    self.setLoading(true);
    self.$.result.style.display = 'none';

    try {
      var prefabDir = self.$.prefabDir.value.trim() || '';
      var textureDir = self.$.textureDir.value.trim() || '';
      Editor.Message.send(packageName, 'save-dirs', prefabDir, textureDir);
      var options = {
        url: url,
        prefabName: self.$.prefabName.value.trim() || '',
        prefabDir: prefabDir,
        textureDir: textureDir
      };
      var result = await Editor.Message.request(packageName, 'convert-mock', options);
      self.setLoading(false);
      if (result && result.success) {
        self.showResult(true, '模拟转换成功!\n生成路径: ' + result.path);
      } else {
        self.showResult(false, '模拟转换失败: ' + (result ? result.error : '未知错误'));
      }
    } catch (e) {
      self.setLoading(false);
      self.showResult(false, '错误: ' + e.message);
    }
  });
};

exports.close = function () {};
