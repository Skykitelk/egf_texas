"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const vue_1 = require("vue");
const PACKAGE_NAME = 'hot-update';
const SAVE_DEBOUNCE_MS = 400;
const panelDataMap = new WeakMap();
let panelVm = null;
function normalizeProgressPayload(...args) {
    for (const arg of args) {
        if (arg && typeof arg === 'object' && 'percent' in arg) {
            const payload = arg;
            return {
                percent: typeof payload.percent === 'number' ? payload.percent : 0,
                message: typeof payload.message === 'string' ? payload.message : '',
            };
        }
    }
    return { percent: 0, message: '' };
}
async function requestMain(message, ...args) {
    return Editor.Message.request(PACKAGE_NAME, message, ...args);
}
async function pickDirectory(title, defaultPath) {
    const result = await Editor.Dialog.select({
        title,
        path: defaultPath || Editor.Project.path,
        type: 'directory',
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
}
module.exports = Editor.Panel.define({
    listeners: {
        show() { },
        hide() { },
    },
    template: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: (0, fs_extra_1.readFileSync)((0, path_1.join)(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        app: '#app',
    },
    methods: {
        onRemoteProgress(...args) {
            panelVm === null || panelVm === void 0 ? void 0 : panelVm.setRemoteProgress(normalizeProgressPayload(...args));
        },
        onPackageProgress(...args) {
            panelVm === null || panelVm === void 0 ? void 0 : panelVm.setPackageProgress(normalizeProgressPayload(...args));
        },
        onUploadProgress(...args) {
            panelVm === null || panelVm === void 0 ? void 0 : panelVm.setUploadProgress(normalizeProgressPayload(...args));
        },
    },
    ready() {
        if (!this.$.app) {
            return;
        }
        const app = (0, vue_1.createApp)((0, vue_1.defineComponent)({
            data() {
                return {
                    versionOutputDir: '',
                    buildAndroidPath: '',
                    version: '',
                    serverType: 's3',
                    s3Config: {
                        accessKeyId: '',
                        secretAccessKey: '',
                        region: 'us-west-2',
                        bucket: '',
                        filePrefix: 'app/hotupdate/',
                        distributionId: '',
                    },
                    sshConfig: {
                        host: '',
                        port: '22',
                        username: '',
                        password: '',
                        privateKey: '',
                        remotePath: '/var/www/hotupdate/',
                    },
                    remoteProgress: { percent: 0, message: '' },
                    packageProgress: { percent: 0, message: '' },
                    uploadProgress: { percent: 0, message: '' },
                    uploadVersionDir: '',
                    lastVersionDir: '',
                    busyTask: null,
                    isRestoringProfile: false,
                    saveTimer: null,
                };
            },
            computed: {
                isBusy() {
                    return this.busyTask !== null;
                },
            },
            async mounted() {
                panelVm = {
                    setRemoteProgress: (data) => {
                        this.remoteProgress = { percent: data.percent, message: data.message };
                    },
                    setPackageProgress: (data) => {
                        this.packageProgress = { percent: data.percent, message: data.message };
                    },
                    setUploadProgress: (data) => {
                        this.uploadProgress = { percent: data.percent, message: data.message };
                    },
                };
                await this.loadSavedProfile();
                this.bindAutoSaveWatchers();
            },
            beforeUnmount() {
                if (this.saveTimer) {
                    clearTimeout(this.saveTimer);
                    this.saveTimer = null;
                }
            },
            methods: {
                bindAutoSaveWatchers() {
                    this.$watch('versionOutputDir', () => this.scheduleSaveProfile());
                    this.$watch('buildAndroidPath', () => this.scheduleSaveProfile());
                    this.$watch('uploadVersionDir', () => this.scheduleSaveProfile());
                    this.$watch('serverType', () => this.scheduleSaveProfile());
                    this.$watch('s3Config', () => this.scheduleSaveProfile(), { deep: true });
                    this.$watch('sshConfig', () => this.scheduleSaveProfile(), { deep: true });
                },
                scheduleSaveProfile() {
                    if (this.isRestoringProfile || this.isBusy) {
                        return;
                    }
                    if (this.saveTimer) {
                        clearTimeout(this.saveTimer);
                    }
                    this.saveTimer = setTimeout(() => {
                        this.saveTimer = null;
                        this.saveProfile();
                    }, SAVE_DEBOUNCE_MS);
                },
                async loadSavedProfile() {
                    this.isRestoringProfile = true;
                    try {
                        const raw = await requestMain('load-profile');
                        const profile = (raw && typeof raw === 'object' ? raw : {});
                        if (profile.versionOutputDir) {
                            this.versionOutputDir = profile.versionOutputDir;
                        }
                        if (profile.buildAndroidPath) {
                            this.buildAndroidPath = profile.buildAndroidPath;
                        }
                        if (profile.serverType) {
                            this.serverType = profile.serverType;
                        }
                        if (profile.s3Config) {
                            this.s3Config = Object.assign(Object.assign({}, this.s3Config), profile.s3Config);
                        }
                        if (profile.sshConfig) {
                            this.sshConfig = Object.assign(Object.assign({}, this.sshConfig), profile.sshConfig);
                        }
                        if (profile.lastVersionDir) {
                            this.lastVersionDir = profile.lastVersionDir;
                        }
                        if (profile.uploadVersionDir) {
                            this.uploadVersionDir = profile.uploadVersionDir;
                        }
                        else if (profile.lastVersionDir) {
                            this.uploadVersionDir = profile.lastVersionDir;
                        }
                        if (profile.lastVersion) {
                            this.version = profile.lastVersion;
                        }
                    }
                    finally {
                        this.isRestoringProfile = false;
                    }
                },
                collectProfileSnapshot(extra = {}) {
                    return Object.assign({ versionOutputDir: this.versionOutputDir, buildAndroidPath: this.buildAndroidPath, serverType: this.serverType, s3Config: Object.assign({}, this.s3Config), sshConfig: Object.assign({}, this.sshConfig), lastVersion: this.version, lastVersionDir: this.lastVersionDir, uploadVersionDir: this.uploadVersionDir }, extra);
                },
                async saveProfile(extra = {}) {
                    await requestMain('save-profile', this.collectProfileSnapshot(extra));
                },
                beginBusy(task) {
                    this.busyTask = task;
                },
                endBusy() {
                    this.busyTask = null;
                },
                async pickVersionOutputDir() {
                    if (this.isBusy) {
                        return;
                    }
                    const dir = await pickDirectory('选择版本输出根目录', this.versionOutputDir || Editor.Project.path);
                    if (dir) {
                        this.versionOutputDir = dir;
                    }
                },
                async pickBuildAndroidPath() {
                    if (this.isBusy) {
                        return;
                    }
                    const dir = await pickDirectory('选择 build/android 目录', this.buildAndroidPath || Editor.Project.path);
                    if (dir) {
                        this.buildAndroidPath = dir;
                    }
                },
                async validateUploadVersionDir(dir) {
                    return requestMain('validate-version-dir', dir);
                },
                async applyUploadVersionDir(dir, showSuccessHint = false) {
                    var _a;
                    const result = await this.validateUploadVersionDir(dir);
                    if (!result.ok) {
                        Editor.Dialog.warn(result.error || '版本目录无效', { title: '热更新' });
                        return false;
                    }
                    this.uploadVersionDir = dir;
                    if (showSuccessHint && result.version) {
                        Editor.Dialog.info(`版本目录有效：${result.version}\nmanifest 文件数：${(_a = result.manifestCount) !== null && _a !== void 0 ? _a : 0}`, { title: '热更新' });
                    }
                    return true;
                },
                async pickUploadVersionDir() {
                    if (this.isBusy) {
                        return;
                    }
                    const defaultPath = this.uploadVersionDir || this.versionOutputDir || Editor.Project.path;
                    const dir = await pickDirectory('选择要上传的版本目录', defaultPath);
                    if (dir) {
                        await this.applyUploadVersionDir(dir, true);
                    }
                },
                validateGenerateInputs() {
                    if (!this.versionOutputDir.trim()) {
                        return '请先选择版本目录路径';
                    }
                    if (!this.buildAndroidPath.trim()) {
                        return '请先选择 build/android 路径';
                    }
                    return null;
                },
                async onGenerateRemote() {
                    if (this.isBusy) {
                        return;
                    }
                    const err = this.validateGenerateInputs();
                    if (err) {
                        Editor.Dialog.warn(err, { title: '热更新' });
                        return;
                    }
                    this.beginBusy('remote');
                    this.remoteProgress = { percent: 0, message: '准备生成...' };
                    try {
                        this.version = await requestMain('format-version-timestamp');
                        this.remoteProgress = { percent: 0, message: '开始生成远程版本...' };
                        const result = await requestMain('generate-remote-version', {
                            versionOutputDir: this.versionOutputDir,
                            buildAndroidPath: this.buildAndroidPath,
                            version: this.version,
                        });
                        if (result.ok && result.outputDir) {
                            this.lastVersionDir = result.outputDir;
                            this.uploadVersionDir = result.outputDir;
                            await this.saveProfile({
                                lastVersionDir: result.outputDir,
                                uploadVersionDir: result.outputDir,
                                lastVersion: this.version,
                            });
                            Editor.Dialog.info(`远程版本已生成：\n${result.outputDir}`, { title: '热更新' });
                        }
                        else {
                            Editor.Dialog.error(result.error || '生成失败', { title: '热更新' });
                        }
                    }
                    finally {
                        this.endBusy();
                    }
                },
                async onGeneratePackage() {
                    var _a;
                    if (this.isBusy) {
                        return;
                    }
                    if (!this.buildAndroidPath.trim()) {
                        Editor.Dialog.warn('请先选择 build/android 路径', { title: '热更新' });
                        return;
                    }
                    this.beginBusy('package');
                    this.packageProgress = { percent: 0, message: '开始处理打包版本...' };
                    try {
                        const result = await requestMain('generate-package-version', {
                            buildAndroidPath: this.buildAndroidPath,
                        });
                        if (result.ok) {
                            const removed = ((_a = result.removed) === null || _a === void 0 ? void 0 : _a.length) ? result.removed.join(', ') : '无';
                            Editor.Dialog.info(`打包版本处理完成，已剔除：${removed}`, { title: '热更新' });
                        }
                        else {
                            Editor.Dialog.error(result.error || '处理失败', { title: '热更新' });
                        }
                    }
                    finally {
                        this.endBusy();
                    }
                },
                async onUpload() {
                    var _a, _b, _c, _d;
                    if (this.isBusy) {
                        return;
                    }
                    if (!this.uploadVersionDir.trim()) {
                        Editor.Dialog.warn('请先选择上传版本目录', { title: '热更新' });
                        return;
                    }
                    const validation = await this.validateUploadVersionDir(this.uploadVersionDir);
                    if (!validation.ok) {
                        Editor.Dialog.warn(validation.error || '上传版本目录无效', { title: '热更新' });
                        return;
                    }
                    if (this.serverType === 's3') {
                        if (!this.s3Config.bucket.trim()) {
                            Editor.Dialog.warn('请填写 S3 Bucket', { title: '热更新' });
                            return;
                        }
                        if (!this.s3Config.accessKeyId.trim() || !this.s3Config.secretAccessKey.trim()) {
                            Editor.Dialog.warn('请填写 S3 Access Key 与 Secret Key', { title: '热更新' });
                            return;
                        }
                    }
                    else if (!this.sshConfig.host.trim() || !this.sshConfig.username.trim()) {
                        Editor.Dialog.warn('请填写 SSH 服务器地址与用户名', { title: '热更新' });
                        return;
                    }
                    else if (!this.sshConfig.password.trim() && !this.sshConfig.privateKey.trim()) {
                        Editor.Dialog.warn('请填写 SSH 密码或私钥', { title: '热更新' });
                        return;
                    }
                    this.beginBusy('upload');
                    this.uploadProgress = { percent: 0, message: '开始上传...' };
                    try {
                        const payload = {
                            serverType: this.serverType,
                            localVersionDir: this.uploadVersionDir,
                        };
                        if (this.serverType === 's3') {
                            payload.s3Config = Object.assign({}, this.s3Config);
                        }
                        else {
                            payload.sshConfig = Object.assign(Object.assign({}, this.sshConfig), { port: parseInt(this.sshConfig.port, 10) || 22 });
                        }
                        const result = await requestMain('upload-resources', payload);
                        if (result.ok) {
                            await this.saveProfile();
                            Editor.Dialog.info([
                                '差异上传完成',
                                `总计：${(_a = result.total) !== null && _a !== void 0 ? _a : 0} 个文件`,
                                `远程复制：${(_b = result.copied) !== null && _b !== void 0 ? _b : 0}`,
                                `本地上传：${(_c = result.uploaded) !== null && _c !== void 0 ? _c : 0}`,
                                `复制回退上传：${(_d = result.copyFallback) !== null && _d !== void 0 ? _d : 0}`,
                            ].join('\n'), { title: '热更新' });
                        }
                        else {
                            Editor.Dialog.error(result.error || '上传失败', { title: '热更新' });
                        }
                    }
                    finally {
                        this.endBusy();
                    }
                },
            },
            template: `
<div class="panel-root" :class="{ 'is-busy': isBusy }">
  <div v-if="isBusy" class="busy-overlay"></div>

  <div class="section-block">
    <div class="section-title">一、资源生成</div>

    <div class="field-row">
      <div class="field-label">版本目录路径（远程资源根目录）</div>
      <div class="path-row">
        <ui-input :value="versionOutputDir" readonly placeholder="选择版本输出根目录"></ui-input>
        <ui-button :disabled="isBusy" @click="pickVersionOutputDir">浏览</ui-button>
      </div>
    </div>

    <div class="field-row">
      <div class="field-label">build/android 路径</div>
      <div class="path-row">
        <ui-input :value="buildAndroidPath" readonly placeholder="选择 Native 构建产物目录"></ui-input>
        <ui-button :disabled="isBusy" @click="pickBuildAndroidPath">浏览</ui-button>
      </div>
      <div class="hint">将自动读取 data/ 下的构建资源（若存在 build/android/data）</div>
    </div>

    <div class="field-row">
      <div class="field-label">版本号（目录名，精确到秒）</div>
      <div class="version-display" :class="{ 'is-empty': !version }">{{ version || '点击「生成远程版本」时自动生成' }}</div>
    </div>

    <div class="action-group">
      <ui-button type="primary" :disabled="isBusy" @click="onGenerateRemote">生成远程版本</ui-button>
      <div class="progress-block tight">
        <div class="field-label">远程版本进度：{{ remoteProgress.percent }}%</div>
        <ui-progress :value="remoteProgress.percent"></ui-progress>
        <div class="progress-text">{{ remoteProgress.message }}</div>
      </div>
    </div>

    <div class="action-group">
      <ui-button type="primary" :disabled="isBusy" @click="onGeneratePackage">生成打包版本</ui-button>
      <div class="progress-block tight">
        <div class="field-label">打包版本进度：{{ packageProgress.percent }}%</div>
        <ui-progress :value="packageProgress.percent"></ui-progress>
        <div class="progress-text">{{ packageProgress.message }}</div>
      </div>
    </div>

    <div class="hint" v-if="lastVersionDir">上次远程版本：{{ lastVersionDir }}</div>
  </div>

  <div class="divider"></div>

  <div class="section-block">
    <div class="section-title">二、资源上传</div>

    <div class="field-row">
      <div class="field-label">上传版本目录（含 manifest/ 的版本号目录）</div>
      <div class="path-row">
        <ui-input :value="uploadVersionDir" readonly placeholder="选择要上传的版本目录"></ui-input>
        <ui-button :disabled="isBusy" @click="pickUploadVersionDir">浏览</ui-button>
      </div>
      <div class="hint">须为 yyyyMMddHHmmss 格式目录，且包含 manifest/*_version.json</div>
    </div>

    <div class="field-row">
      <div class="field-label">资源服务器类型</div>
      <div class="path-row">
        <ui-button :disabled="isBusy" :type="serverType === 's3' ? 'primary' : 'normal'" @click="serverType = 's3'">S3 服务器</ui-button>
        <ui-button :disabled="isBusy" :type="serverType === 'ssh' ? 'primary' : 'normal'" @click="serverType = 'ssh'">普通服务器 (SSH/SFTP)</ui-button>
      </div>
    </div>

    <div v-if="serverType === 's3'" class="config-grid">
      <div class="full-width">
        <div class="field-label">Access Key ID</div>
        <ui-input :disabled="isBusy" :value="s3Config.accessKeyId" @change="(e) => s3Config.accessKeyId = e.target.value"></ui-input>
      </div>
      <div class="full-width">
        <div class="field-label">Secret Access Key</div>
        <ui-input :disabled="isBusy" password :value="s3Config.secretAccessKey" @change="(e) => s3Config.secretAccessKey = e.target.value"></ui-input>
      </div>
      <div>
        <div class="field-label">Region</div>
        <ui-input :disabled="isBusy" :value="s3Config.region" @change="(e) => s3Config.region = e.target.value"></ui-input>
      </div>
      <div>
        <div class="field-label">Bucket</div>
        <ui-input :disabled="isBusy" :value="s3Config.bucket" @change="(e) => s3Config.bucket = e.target.value"></ui-input>
      </div>
      <div class="full-width">
        <div class="field-label">File Prefix</div>
        <ui-input :disabled="isBusy" :value="s3Config.filePrefix" @change="(e) => s3Config.filePrefix = e.target.value"></ui-input>
      </div>
      <div class="full-width">
        <div class="field-label">CloudFront Distribution ID（可选）</div>
        <ui-input :disabled="isBusy" :value="s3Config.distributionId" @change="(e) => s3Config.distributionId = e.target.value"></ui-input>
      </div>
    </div>

    <div v-else class="config-grid">
      <div>
        <div class="field-label">服务器地址</div>
        <ui-input :disabled="isBusy" :value="sshConfig.host" @change="(e) => sshConfig.host = e.target.value"></ui-input>
      </div>
      <div>
        <div class="field-label">端口</div>
        <ui-input :disabled="isBusy" :value="sshConfig.port" @change="(e) => sshConfig.port = e.target.value"></ui-input>
      </div>
      <div>
        <div class="field-label">用户名</div>
        <ui-input :disabled="isBusy" :value="sshConfig.username" @change="(e) => sshConfig.username = e.target.value"></ui-input>
      </div>
      <div>
        <div class="field-label">密码</div>
        <ui-input :disabled="isBusy" password :value="sshConfig.password" @change="(e) => sshConfig.password = e.target.value"></ui-input>
      </div>
      <div class="full-width">
        <div class="field-label">私钥（可选，PEM 内容）</div>
        <ui-textarea :disabled="isBusy" :value="sshConfig.privateKey" @change="(e) => sshConfig.privateKey = e.target.value"></ui-textarea>
      </div>
      <div class="full-width">
        <div class="field-label">远程目录</div>
        <ui-input :disabled="isBusy" :value="sshConfig.remotePath" @change="(e) => sshConfig.remotePath = e.target.value"></ui-input>
      </div>
    </div>

    <div class="action-group">
      <ui-button type="primary" :disabled="isBusy" @click="onUpload">上传远程版本</ui-button>
      <div class="progress-block tight">
        <div class="field-label">上传进度：{{ uploadProgress.percent }}%</div>
        <ui-progress :value="uploadProgress.percent"></ui-progress>
        <div class="progress-text">{{ uploadProgress.message }}</div>
      </div>
    </div>
  </div>
</div>
                `,
        }));
        app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('ui-');
        app.mount(this.$.app);
        panelDataMap.set(this, app);
    },
    beforeClose() { },
    close() {
        panelVm = null;
        const app = panelDataMap.get(this);
        if (app) {
            app.unmount();
        }
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL2RlZmF1bHQvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSx1Q0FBd0M7QUFDeEMsK0JBQTRCO0FBQzVCLDZCQUFzRDtBQUV0RCxNQUFNLFlBQVksR0FBRyxZQUFZLENBQUM7QUFDbEMsTUFBTSxnQkFBZ0IsR0FBRyxHQUFHLENBQUM7QUFFN0IsTUFBTSxZQUFZLEdBQUcsSUFBSSxPQUFPLEVBQVksQ0FBQztBQVU3QyxJQUFJLE9BQU8sR0FBb0IsSUFBSSxDQUFDO0FBeUJwQyxTQUFTLHdCQUF3QixDQUFDLEdBQUcsSUFBZTtJQUNoRCxLQUFLLE1BQU0sR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3JCLElBQUksR0FBRyxJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVEsSUFBSSxTQUFTLElBQUksR0FBRyxFQUFFLENBQUM7WUFDckQsTUFBTSxPQUFPLEdBQUcsR0FBK0MsQ0FBQztZQUNoRSxPQUFPO2dCQUNILE9BQU8sRUFBRSxPQUFPLE9BQU8sQ0FBQyxPQUFPLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNsRSxPQUFPLEVBQUUsT0FBTyxPQUFPLENBQUMsT0FBTyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRTthQUN0RSxDQUFDO1FBQ04sQ0FBQztJQUNMLENBQUM7SUFDRCxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUMsRUFBRSxPQUFPLEVBQUUsRUFBRSxFQUFFLENBQUM7QUFDdkMsQ0FBQztBQUVELEtBQUssVUFBVSxXQUFXLENBQUMsT0FBZSxFQUFFLEdBQUcsSUFBZTtJQUMxRCxPQUFPLE1BQU0sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxPQUFjLEVBQUUsR0FBSSxJQUFj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LFdBQVcsS0FBSSxDQUFDO0lBQ2hCLEtBQUs7UUFDRCxPQUFPLEdBQUcsSUFBSSxDQUFDO1FBQ2YsTUFBTSxHQUFHLEdBQUcsWUFBWSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNuQyxJQUFJLEdBQUcsRUFBRSxDQUFDO1lBQ04sR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ2xCLENBQUM7SUFDTCxDQUFDO0NBQ0osQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgY3JlYXRlQXBwLCBBcHAsIGRlZmluZUNvbXBvbmVudCB9IGZyb20gJ3Z1ZSc7XG5cbmNvbnN0IFBBQ0tBR0VfTkFNRSA9ICdob3QtdXBkYXRlJztcbmNvbnN0IFNBVkVfREVCT1VOQ0VfTVMgPSA0MDA7XG5cbmNvbnN0IHBhbmVsRGF0YU1hcCA9IG5ldyBXZWFrTWFwPGFueSwgQXBwPigpO1xuXG50eXBlIEJ1c3lUYXNrID0gJ3JlbW90ZScgfCAncGFja2FnZScgfCAndXBsb2FkJztcblxuaW50ZXJmYWNlIElQYW5lbFZtIHtcbiAgICBzZXRSZW1vdGVQcm9ncmVzczogKGQ6IHsgcGVyY2VudDogbnVtYmVyOyBtZXNzYWdlOiBzdHJpbmcgfSkgPT4gdm9pZDtcbiAgICBzZXRQYWNrYWdlUHJvZ3Jlc3M6IChkOiB7IHBlcmNlbnQ6IG51bWJlcjsgbWVzc2FnZTogc3RyaW5nIH0pID0+IHZvaWQ7XG4gICAgc2V0VXBsb2FkUHJvZ3Jlc3M6IChkOiB7IHBlcmNlbnQ6IG51bWJlcjsgbWVzc2FnZTogc3RyaW5nIH0pID0+IHZvaWQ7XG59XG5cbmxldCBwYW5lbFZtOiBJUGFuZWxWbSB8IG51bGwgPSBudWxsO1xuXG5pbnRlcmZhY2UgSVByb2dyZXNzU3RhdGUge1xuICAgIHBlcmNlbnQ6IG51bWJlcjtcbiAgICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBJUHJvZmlsZURhdGEge1xuICAgIHZlcnNpb25PdXRwdXREaXI/OiBzdHJpbmc7XG4gICAgYnVpbGRBbmRyb2lkUGF0aD86IHN0cmluZztcbiAgICB1cGxvYWRWZXJzaW9uRGlyPzogc3RyaW5nO1xuICAgIHNlcnZlclR5cGU/OiAnczMnIHwgJ3NzaCc7XG4gICAgczNDb25maWc/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgIHNzaENvbmZpZz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gICAgbGFzdFZlcnNpb24/OiBzdHJpbmc7XG4gICAgbGFzdFZlcnNpb25EaXI/OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBJVmVyc2lvbkRpclZhbGlkYXRpb24ge1xuICAgIG9rOiBib29sZWFuO1xuICAgIGVycm9yPzogc3RyaW5nO1xuICAgIHZlcnNpb24/OiBzdHJpbmc7XG4gICAgbWFuaWZlc3RDb3VudD86IG51bWJlcjtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUHJvZ3Jlc3NQYXlsb2FkKC4uLmFyZ3M6IHVua25vd25bXSk6IElQcm9ncmVzc1N0YXRlIHtcbiAgICBmb3IgKGNvbnN0IGFyZyBvZiBhcmdzKSB7XG4gICAgICAgIGlmIChhcmcgJiYgdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgJ3BlcmNlbnQnIGluIGFyZykge1xuICAgICAgICAgICAgY29uc3QgcGF5bG9hZCA9IGFyZyBhcyB7IHBlcmNlbnQ/OiB1bmtub3duOyBtZXNzYWdlPzogdW5rbm93biB9O1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICBwZXJjZW50OiB0eXBlb2YgcGF5bG9hZC5wZXJjZW50ID09PSAnbnVtYmVyJyA/IHBheWxvYWQucGVyY2VudCA6IDAsXG4gICAgICAgICAgICAgICAgbWVzc2FnZTogdHlwZW9mIHBheWxvYWQubWVzc2FnZSA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLm1lc3NhZ2UgOiAnJyxcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgcGVyY2VudDogMCwgbWVzc2FnZTogJycgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVxdWVzdE1haW4obWVzc2FnZTogc3RyaW5nLCAuLi5hcmdzOiB1bmtub3duW10pIHtcbiAgICByZXR1cm4gRWRpdG9yLk1lc3NhZ2UucmVxdWVzdChQQUNLQUdFX05BTUUsIG1lc3NhZ2UgYXMgYW55LCAuLi4oYXJncyBhcyBhbnlbXSkpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwaWNrRGlyZWN0b3J5KHRpdGxlOiBzdHJpbmcsIGRlZmF1bHRQYXRoPzogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgRWRpdG9yLkRpYWxvZy5zZWxlY3Qoe1xuICAgICAgICB0aXRsZSxcbiAgICAgICAgcGF0aDogZGVmYXVsdFBhdGggfHwgRWRpdG9yLlByb2plY3QucGF0aCxcbiAgICAgICAgdHlwZTogJ2RpcmVjdG9yeScsXG4gICAgfSk7XG4gICAgaWYgKHJlc3VsdC5jYW5jZWxlZCB8fCAhcmVzdWx0LmZpbGVQYXRocyB8fCByZXN1bHQuZmlsZVBhdGhzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdC5maWxlUGF0aHNbMF07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gRWRpdG9yLlBhbmVsLmRlZmluZSh7XG4gICAgbGlzdGVuZXJzOiB7XG4gICAgICAgIHNob3coKSB7fSxcbiAgICAgICAgaGlkZSgpIHt9LFxuICAgIH0sXG4gICAgdGVtcGxhdGU6IHJlYWRGaWxlU3luYyhqb2luKF9fZGlybmFtZSwgJy4uLy4uLy4uL3N0YXRpYy90ZW1wbGF0ZS9kZWZhdWx0L2luZGV4Lmh0bWwnKSwgJ3V0Zi04JyksXG4gICAgc3R5bGU6IHJlYWRGaWxlU3luYyhqb2luKF9fZGlybmFtZSwgJy4uLy4uLy4uL3N0YXRpYy9zdHlsZS9kZWZhdWx0L2luZGV4LmNzcycpLCAndXRmLTgnKSxcbiAgICAkOiB7XG4gICAgICAgIGFwcDogJyNhcHAnLFxuICAgIH0sXG4gICAgbWV0aG9kczoge1xuICAgICAgICBvblJlbW90ZVByb2dyZXNzKC4uLmFyZ3M6IHVua25vd25bXSkge1xuICAgICAgICAgICAgcGFuZWxWbT8uc2V0UmVtb3RlUHJvZ3Jlc3Mobm9ybWFsaXplUHJvZ3Jlc3NQYXlsb2FkKC4uLmFyZ3MpKTtcbiAgICAgICAgfSxcbiAgICAgICAgb25QYWNrYWdlUHJvZ3Jlc3MoLi4uYXJnczogdW5rbm93bltdKSB7XG4gICAgICAgICAgICBwYW5lbFZtPy5zZXRQYWNrYWdlUHJvZ3Jlc3Mobm9ybWFsaXplUHJvZ3Jlc3NQYXlsb2FkKC4uLmFyZ3MpKTtcbiAgICAgICAgfSxcbiAgICAgICAgb25VcGxvYWRQcm9ncmVzcyguLi5hcmdzOiB1bmtub3duW10pIHtcbiAgICAgICAgICAgIHBhbmVsVm0/LnNldFVwbG9hZFByb2dyZXNzKG5vcm1hbGl6ZVByb2dyZXNzUGF5bG9hZCguLi5hcmdzKSk7XG4gICAgICAgIH0sXG4gICAgfSxcbiAgICByZWFkeSgpIHtcbiAgICAgICAgaWYgKCF0aGlzLiQuYXBwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhcHAgPSBjcmVhdGVBcHAoXG4gICAgICAgICAgICBkZWZpbmVDb21wb25lbnQoe1xuICAgICAgICAgICAgICAgIGRhdGEoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uT3V0cHV0RGlyOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGJ1aWxkQW5kcm9pZFBhdGg6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogJycsXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXJ2ZXJUeXBlOiAnczMnIGFzICdzMycgfCAnc3NoJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHMzQ29uZmlnOiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYWNjZXNzS2V5SWQ6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNlY3JldEFjY2Vzc0tleTogJycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnaW9uOiAndXMtd2VzdC0yJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBidWNrZXQ6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVQcmVmaXg6ICdhcHAvaG90dXBkYXRlLycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGlzdHJpYnV0aW9uSWQ6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNzaENvbmZpZzoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhvc3Q6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBvcnQ6ICcyMicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhc3N3b3JkOiAnJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcml2YXRlS2V5OiAnJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZW1vdGVQYXRoOiAnL3Zhci93d3cvaG90dXBkYXRlLycsXG4gICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgcmVtb3RlUHJvZ3Jlc3M6IHsgcGVyY2VudDogMCwgbWVzc2FnZTogJycgfSBhcyBJUHJvZ3Jlc3NTdGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhY2thZ2VQcm9ncmVzczogeyBwZXJjZW50OiAwLCBtZXNzYWdlOiAnJyB9IGFzIElQcm9ncmVzc1N0YXRlLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXBsb2FkUHJvZ3Jlc3M6IHsgcGVyY2VudDogMCwgbWVzc2FnZTogJycgfSBhcyBJUHJvZ3Jlc3NTdGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVwbG9hZFZlcnNpb25EaXI6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgbGFzdFZlcnNpb25EaXI6ICcnLFxuICAgICAgICAgICAgICAgICAgICAgICAgYnVzeVRhc2s6IG51bGwgYXMgQnVzeVRhc2sgfCBudWxsLFxuICAgICAgICAgICAgICAgICAgICAgICAgaXNSZXN0b3JpbmdQcm9maWxlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNhdmVUaW1lcjogbnVsbCBhcyBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjb21wdXRlZDoge1xuICAgICAgICAgICAgICAgICAgICBpc0J1c3koKTogYm9vbGVhbiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5idXN5VGFzayAhPT0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGFzeW5jIG1vdW50ZWQoKSB7XG4gICAgICAgICAgICAgICAgICAgIHBhbmVsVm0gPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRSZW1vdGVQcm9ncmVzczogKGRhdGEpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlbW90ZVByb2dyZXNzID0geyBwZXJjZW50OiBkYXRhLnBlcmNlbnQsIG1lc3NhZ2U6IGRhdGEubWVzc2FnZSB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldFBhY2thZ2VQcm9ncmVzczogKGRhdGEpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnBhY2thZ2VQcm9ncmVzcyA9IHsgcGVyY2VudDogZGF0YS5wZXJjZW50LCBtZXNzYWdlOiBkYXRhLm1lc3NhZ2UgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICBzZXRVcGxvYWRQcm9ncmVzczogKGRhdGEpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnVwbG9hZFByb2dyZXNzID0geyBwZXJjZW50OiBkYXRhLnBlcmNlbnQsIG1lc3NhZ2U6IGRhdGEubWVzc2FnZSB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmxvYWRTYXZlZFByb2ZpbGUoKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5iaW5kQXV0b1NhdmVXYXRjaGVycygpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgYmVmb3JlVW5tb3VudCgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuc2F2ZVRpbWVyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5zYXZlVGltZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zYXZlVGltZXIgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtZXRob2RzOiB7XG4gICAgICAgICAgICAgICAgICAgIGJpbmRBdXRvU2F2ZVdhdGNoZXJzKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kd2F0Y2goJ3ZlcnNpb25PdXRwdXREaXInLCAoKSA9PiB0aGlzLnNjaGVkdWxlU2F2ZVByb2ZpbGUoKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiR3YXRjaCgnYnVpbGRBbmRyb2lkUGF0aCcsICgpID0+IHRoaXMuc2NoZWR1bGVTYXZlUHJvZmlsZSgpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuJHdhdGNoKCd1cGxvYWRWZXJzaW9uRGlyJywgKCkgPT4gdGhpcy5zY2hlZHVsZVNhdmVQcm9maWxlKCkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kd2F0Y2goJ3NlcnZlclR5cGUnLCAoKSA9PiB0aGlzLnNjaGVkdWxlU2F2ZVByb2ZpbGUoKSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLiR3YXRjaCgnczNDb25maWcnLCAoKSA9PiB0aGlzLnNjaGVkdWxlU2F2ZVByb2ZpbGUoKSwgeyBkZWVwOiB0cnVlIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy4kd2F0Y2goJ3NzaENvbmZpZycsICgpID0+IHRoaXMuc2NoZWR1bGVTYXZlUHJvZmlsZSgpLCB7IGRlZXA6IHRydWUgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIHNjaGVkdWxlU2F2ZVByb2ZpbGUoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5pc1Jlc3RvcmluZ1Byb2ZpbGUgfHwgdGhpcy5pc0J1c3kpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5zYXZlVGltZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5zYXZlVGltZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zYXZlVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNhdmVUaW1lciA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zYXZlUHJvZmlsZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSwgU0FWRV9ERUJPVU5DRV9NUyk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGFzeW5jIGxvYWRTYXZlZFByb2ZpbGUoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmlzUmVzdG9yaW5nUHJvZmlsZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJhdyA9IGF3YWl0IHJlcXVlc3RNYWluKCdsb2FkLXByb2ZpbGUnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwcm9maWxlID0gKHJhdyAmJiB0eXBlb2YgcmF3ID09PSAnb2JqZWN0JyA/IHJhdyA6IHt9KSBhcyBJUHJvZmlsZURhdGE7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocHJvZmlsZS52ZXJzaW9uT3V0cHV0RGlyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudmVyc2lvbk91dHB1dERpciA9IHByb2ZpbGUudmVyc2lvbk91dHB1dERpcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHByb2ZpbGUuYnVpbGRBbmRyb2lkUGF0aCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJ1aWxkQW5kcm9pZFBhdGggPSBwcm9maWxlLmJ1aWxkQW5kcm9pZFBhdGg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwcm9maWxlLnNlcnZlclR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5zZXJ2ZXJUeXBlID0gcHJvZmlsZS5zZXJ2ZXJUeXBlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocHJvZmlsZS5zM0NvbmZpZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnMzQ29uZmlnID0geyAuLi50aGlzLnMzQ29uZmlnLCAuLi5wcm9maWxlLnMzQ29uZmlnIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwcm9maWxlLnNzaENvbmZpZykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNzaENvbmZpZyA9IHsgLi4udGhpcy5zc2hDb25maWcsIC4uLnByb2ZpbGUuc3NoQ29uZmlnIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwcm9maWxlLmxhc3RWZXJzaW9uRGlyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubGFzdFZlcnNpb25EaXIgPSBwcm9maWxlLmxhc3RWZXJzaW9uRGlyO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocHJvZmlsZS51cGxvYWRWZXJzaW9uRGlyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBsb2FkVmVyc2lvbkRpciA9IHByb2ZpbGUudXBsb2FkVmVyc2lvbkRpcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHByb2ZpbGUubGFzdFZlcnNpb25EaXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy51cGxvYWRWZXJzaW9uRGlyID0gcHJvZmlsZS5sYXN0VmVyc2lvbkRpcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHByb2ZpbGUubGFzdFZlcnNpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy52ZXJzaW9uID0gcHJvZmlsZS5sYXN0VmVyc2lvbjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuaXNSZXN0b3JpbmdQcm9maWxlID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGNvbGxlY3RQcm9maWxlU25hcHNob3QoZXh0cmE6IFBhcnRpYWw8SVByb2ZpbGVEYXRhPiA9IHt9KTogSVByb2ZpbGVEYXRhIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbk91dHB1dERpcjogdGhpcy52ZXJzaW9uT3V0cHV0RGlyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJ1aWxkQW5kcm9pZFBhdGg6IHRoaXMuYnVpbGRBbmRyb2lkUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXJ2ZXJUeXBlOiB0aGlzLnNlcnZlclR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgczNDb25maWc6IHsgLi4udGhpcy5zM0NvbmZpZyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNzaENvbmZpZzogeyAuLi50aGlzLnNzaENvbmZpZyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RWZXJzaW9uOiB0aGlzLnZlcnNpb24sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFzdFZlcnNpb25EaXI6IHRoaXMubGFzdFZlcnNpb25EaXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXBsb2FkVmVyc2lvbkRpcjogdGhpcy51cGxvYWRWZXJzaW9uRGlyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLmV4dHJhLFxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgYXN5bmMgc2F2ZVByb2ZpbGUoZXh0cmE6IFBhcnRpYWw8SVByb2ZpbGVEYXRhPiA9IHt9KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZXF1ZXN0TWFpbignc2F2ZS1wcm9maWxlJywgdGhpcy5jb2xsZWN0UHJvZmlsZVNuYXBzaG90KGV4dHJhKSk7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGJlZ2luQnVzeSh0YXNrOiBCdXN5VGFzaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5idXN5VGFzayA9IHRhc2s7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGVuZEJ1c3koKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJ1c3lUYXNrID0gbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgYXN5bmMgcGlja1ZlcnNpb25PdXRwdXREaXIoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5pc0J1c3kpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkaXIgPSBhd2FpdCBwaWNrRGlyZWN0b3J5KCfpgInmi6nniYjmnKzovpPlh7rmoLnnm67lvZUnLCB0aGlzLnZlcnNpb25PdXRwdXREaXIgfHwgRWRpdG9yLlByb2plY3QucGF0aCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZGlyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy52ZXJzaW9uT3V0cHV0RGlyID0gZGlyO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBhc3luYyBwaWNrQnVpbGRBbmRyb2lkUGF0aCgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmlzQnVzeSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpciA9IGF3YWl0IHBpY2tEaXJlY3RvcnkoJ+mAieaLqSBidWlsZC9hbmRyb2lkIOebruW9lScsIHRoaXMuYnVpbGRBbmRyb2lkUGF0aCB8fCBFZGl0b3IuUHJvamVjdC5wYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChkaXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJ1aWxkQW5kcm9pZFBhdGggPSBkaXI7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGFzeW5jIHZhbGlkYXRlVXBsb2FkVmVyc2lvbkRpcihkaXI6IHN0cmluZyk6IFByb21pc2U8SVZlcnNpb25EaXJWYWxpZGF0aW9uPiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVxdWVzdE1haW4oJ3ZhbGlkYXRlLXZlcnNpb24tZGlyJywgZGlyKSBhcyBQcm9taXNlPElWZXJzaW9uRGlyVmFsaWRhdGlvbj47XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGFzeW5jIGFwcGx5VXBsb2FkVmVyc2lvbkRpcihkaXI6IHN0cmluZywgc2hvd1N1Y2Nlc3NIaW50ID0gZmFsc2UpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMudmFsaWRhdGVVcGxvYWRWZXJzaW9uRGlyKGRpcik7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXJlc3VsdC5vaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVkaXRvci5EaWFsb2cud2FybihyZXN1bHQuZXJyb3IgfHwgJ+eJiOacrOebruW9leaXoOaViCcsIHsgdGl0bGU6ICfng63mm7TmlrAnIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBsb2FkVmVyc2lvbkRpciA9IGRpcjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChzaG93U3VjY2Vzc0hpbnQgJiYgcmVzdWx0LnZlcnNpb24pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuRGlhbG9nLmluZm8oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGDniYjmnKznm67lvZXmnInmlYjvvJoke3Jlc3VsdC52ZXJzaW9ufVxcbm1hbmlmZXN0IOaWh+S7tuaVsO+8miR7cmVzdWx0Lm1hbmlmZXN0Q291bnQgPz8gMH1gLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRpdGxlOiAn54Ot5pu05pawJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgYXN5bmMgcGlja1VwbG9hZFZlcnNpb25EaXIoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5pc0J1c3kpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBkZWZhdWx0UGF0aCA9IHRoaXMudXBsb2FkVmVyc2lvbkRpciB8fCB0aGlzLnZlcnNpb25PdXRwdXREaXIgfHwgRWRpdG9yLlByb2plY3QucGF0aDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGRpciA9IGF3YWl0IHBpY2tEaXJlY3RvcnkoJ+mAieaLqeimgeS4iuS8oOeahOeJiOacrOebruW9lScsIGRlZmF1bHRQYXRoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChkaXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmFwcGx5VXBsb2FkVmVyc2lvbkRpcihkaXIsIHRydWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICB2YWxpZGF0ZUdlbmVyYXRlSW5wdXRzKCk6IHN0cmluZyB8IG51bGwge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLnZlcnNpb25PdXRwdXREaXIudHJpbSgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICfor7flhYjpgInmi6nniYjmnKznm67lvZXot6/lvoQnO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLmJ1aWxkQW5kcm9pZFBhdGgudHJpbSgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICfor7flhYjpgInmi6kgYnVpbGQvYW5kcm9pZCDot6/lvoQnO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGFzeW5jIG9uR2VuZXJhdGVSZW1vdGUoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5pc0J1c3kpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnIgPSB0aGlzLnZhbGlkYXRlR2VuZXJhdGVJbnB1dHMoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuRGlhbG9nLndhcm4oZXJyLCB7IHRpdGxlOiAn54Ot5pu05pawJyB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYmVnaW5CdXN5KCdyZW1vdGUnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucmVtb3RlUHJvZ3Jlc3MgPSB7IHBlcmNlbnQ6IDAsIG1lc3NhZ2U6ICflh4blpIfnlJ/miJAuLi4nIH07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy52ZXJzaW9uID0gYXdhaXQgcmVxdWVzdE1haW4oJ2Zvcm1hdC12ZXJzaW9uLXRpbWVzdGFtcCcpIGFzIHN0cmluZztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnJlbW90ZVByb2dyZXNzID0geyBwZXJjZW50OiAwLCBtZXNzYWdlOiAn5byA5aeL55Sf5oiQ6L+c56iL54mI5pysLi4uJyB9O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVxdWVzdE1haW4oJ2dlbmVyYXRlLXJlbW90ZS12ZXJzaW9uJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2ZXJzaW9uT3V0cHV0RGlyOiB0aGlzLnZlcnNpb25PdXRwdXREaXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJ1aWxkQW5kcm9pZFBhdGg6IHRoaXMuYnVpbGRBbmRyb2lkUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmVyc2lvbjogdGhpcy52ZXJzaW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pIGFzIHsgb2s6IGJvb2xlYW47IG91dHB1dERpcj86IHN0cmluZzsgZXJyb3I/OiBzdHJpbmcgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXN1bHQub2sgJiYgcmVzdWx0Lm91dHB1dERpcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxhc3RWZXJzaW9uRGlyID0gcmVzdWx0Lm91dHB1dERpcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy51cGxvYWRWZXJzaW9uRGlyID0gcmVzdWx0Lm91dHB1dERpcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zYXZlUHJvZmlsZSh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXN0VmVyc2lvbkRpcjogcmVzdWx0Lm91dHB1dERpcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVwbG9hZFZlcnNpb25EaXI6IHJlc3VsdC5vdXRwdXREaXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYXN0VmVyc2lvbjogdGhpcy52ZXJzaW9uLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy5pbmZvKGDov5znqIvniYjmnKzlt7LnlJ/miJDvvJpcXG4ke3Jlc3VsdC5vdXRwdXREaXJ9YCwgeyB0aXRsZTogJ+eDreabtOaWsCcgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy5lcnJvcihyZXN1bHQuZXJyb3IgfHwgJ+eUn+aIkOWksei0pScsIHsgdGl0bGU6ICfng63mm7TmlrAnIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbmRCdXN5KCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGFzeW5jIG9uR2VuZXJhdGVQYWNrYWdlKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuaXNCdXN5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLmJ1aWxkQW5kcm9pZFBhdGgudHJpbSgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy53YXJuKCfor7flhYjpgInmi6kgYnVpbGQvYW5kcm9pZCDot6/lvoQnLCB7IHRpdGxlOiAn54Ot5pu05pawJyB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYmVnaW5CdXN5KCdwYWNrYWdlJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnBhY2thZ2VQcm9ncmVzcyA9IHsgcGVyY2VudDogMCwgbWVzc2FnZTogJ+W8gOWni+WkhOeQhuaJk+WMheeJiOacrC4uLicgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXF1ZXN0TWFpbignZ2VuZXJhdGUtcGFja2FnZS12ZXJzaW9uJywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBidWlsZEFuZHJvaWRQYXRoOiB0aGlzLmJ1aWxkQW5kcm9pZFBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSkgYXMgeyBvazogYm9vbGVhbjsgcmVtb3ZlZD86IHN0cmluZ1tdOyBlcnJvcj86IHN0cmluZyB9O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlc3VsdC5vaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCByZW1vdmVkID0gcmVzdWx0LnJlbW92ZWQ/Lmxlbmd0aCA/IHJlc3VsdC5yZW1vdmVkLmpvaW4oJywgJykgOiAn5pegJztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy5pbmZvKGDmiZPljIXniYjmnKzlpITnkIblrozmiJDvvIzlt7LliZTpmaTvvJoke3JlbW92ZWR9YCwgeyB0aXRsZTogJ+eDreabtOaWsCcgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy5lcnJvcihyZXN1bHQuZXJyb3IgfHwgJ+WkhOeQhuWksei0pScsIHsgdGl0bGU6ICfng63mm7TmlrAnIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbmRCdXN5KCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGFzeW5jIG9uVXBsb2FkKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuaXNCdXN5KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLnVwbG9hZFZlcnNpb25EaXIudHJpbSgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy53YXJuKCfor7flhYjpgInmi6nkuIrkvKDniYjmnKznm67lvZUnLCB7IHRpdGxlOiAn54Ot5pu05pawJyB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHZhbGlkYXRpb24gPSBhd2FpdCB0aGlzLnZhbGlkYXRlVXBsb2FkVmVyc2lvbkRpcih0aGlzLnVwbG9hZFZlcnNpb25EaXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF2YWxpZGF0aW9uLm9rKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy53YXJuKHZhbGlkYXRpb24uZXJyb3IgfHwgJ+S4iuS8oOeJiOacrOebruW9leaXoOaViCcsIHsgdGl0bGU6ICfng63mm7TmlrAnIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuc2VydmVyVHlwZSA9PT0gJ3MzJykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5zM0NvbmZpZy5idWNrZXQudHJpbSgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVkaXRvci5EaWFsb2cud2Fybign6K+35aGr5YaZIFMzIEJ1Y2tldCcsIHsgdGl0bGU6ICfng63mm7TmlrAnIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5zM0NvbmZpZy5hY2Nlc3NLZXlJZC50cmltKCkgfHwgIXRoaXMuczNDb25maWcuc2VjcmV0QWNjZXNzS2V5LnRyaW0oKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuRGlhbG9nLndhcm4oJ+ivt+Whq+WGmSBTMyBBY2Nlc3MgS2V5IOS4jiBTZWNyZXQgS2V5JywgeyB0aXRsZTogJ+eDreabtOaWsCcgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKCF0aGlzLnNzaENvbmZpZy5ob3N0LnRyaW0oKSB8fCAhdGhpcy5zc2hDb25maWcudXNlcm5hbWUudHJpbSgpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgRWRpdG9yLkRpYWxvZy53YXJuKCfor7floavlhpkgU1NIIOacjeWKoeWZqOWcsOWdgOS4jueUqOaIt+WQjScsIHsgdGl0bGU6ICfng63mm7TmlrAnIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoIXRoaXMuc3NoQ29uZmlnLnBhc3N3b3JkLnRyaW0oKSAmJiAhdGhpcy5zc2hDb25maWcucHJpdmF0ZUtleS50cmltKCkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuRGlhbG9nLndhcm4oJ+ivt+Whq+WGmSBTU0gg5a+G56CB5oiW56eB6ZKlJywgeyB0aXRsZTogJ+eDreabtOaWsCcgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJlZ2luQnVzeSgndXBsb2FkJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnVwbG9hZFByb2dyZXNzID0geyBwZXJjZW50OiAwLCBtZXNzYWdlOiAn5byA5aeL5LiK5LygLi4uJyB9O1xuXG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzZXJ2ZXJUeXBlOiB0aGlzLnNlcnZlclR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxvY2FsVmVyc2lvbkRpcjogdGhpcy51cGxvYWRWZXJzaW9uRGlyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5zZXJ2ZXJUeXBlID09PSAnczMnKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBheWxvYWQuczNDb25maWcgPSB7IC4uLnRoaXMuczNDb25maWcgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXlsb2FkLnNzaENvbmZpZyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC4uLnRoaXMuc3NoQ29uZmlnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9ydDogcGFyc2VJbnQodGhpcy5zc2hDb25maWcucG9ydCwgMTApIHx8IDIyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlcXVlc3RNYWluKCd1cGxvYWQtcmVzb3VyY2VzJywgcGF5bG9hZCkgYXMge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvazogYm9vbGVhbjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdG90YWw/OiBudW1iZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvcGllZD86IG51bWJlcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXBsb2FkZWQ/OiBudW1iZXI7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvcHlGYWxsYmFjaz86IG51bWJlcjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3I/OiBzdHJpbmc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXN1bHQub2spIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zYXZlUHJvZmlsZSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZGl0b3IuRGlhbG9nLmluZm8oXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ+W3ruW8guS4iuS8oOWujOaIkCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYOaAu+iuoe+8miR7cmVzdWx0LnRvdGFsID8/IDB9IOS4quaWh+S7tmAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYOi/nOeoi+WkjeWItu+8miR7cmVzdWx0LmNvcGllZCA/PyAwfWAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYOacrOWcsOS4iuS8oO+8miR7cmVzdWx0LnVwbG9hZGVkID8/IDB9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBg5aSN5Yi25Zue6YCA5LiK5Lyg77yaJHtyZXN1bHQuY29weUZhbGxiYWNrID8/IDB9YCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF0uam9pbignXFxuJyksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB7IHRpdGxlOiAn54Ot5pu05pawJyB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVkaXRvci5EaWFsb2cuZXJyb3IocmVzdWx0LmVycm9yIHx8ICfkuIrkvKDlpLHotKUnLCB7IHRpdGxlOiAn54Ot5pu05pawJyB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZW5kQnVzeSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgdGVtcGxhdGU6IGBcbjxkaXYgY2xhc3M9XCJwYW5lbC1yb290XCIgOmNsYXNzPVwieyAnaXMtYnVzeSc6IGlzQnVzeSB9XCI+XG4gIDxkaXYgdi1pZj1cImlzQnVzeVwiIGNsYXNzPVwiYnVzeS1vdmVybGF5XCI+PC9kaXY+XG5cbiAgPGRpdiBjbGFzcz1cInNlY3Rpb24tYmxvY2tcIj5cbiAgICA8ZGl2IGNsYXNzPVwic2VjdGlvbi10aXRsZVwiPuS4gOOAgei1hOa6kOeUn+aIkDwvZGl2PlxuXG4gICAgPGRpdiBjbGFzcz1cImZpZWxkLXJvd1wiPlxuICAgICAgPGRpdiBjbGFzcz1cImZpZWxkLWxhYmVsXCI+54mI5pys55uu5b2V6Lev5b6E77yI6L+c56iL6LWE5rqQ5qC555uu5b2V77yJPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwicGF0aC1yb3dcIj5cbiAgICAgICAgPHVpLWlucHV0IDp2YWx1ZT1cInZlcnNpb25PdXRwdXREaXJcIiByZWFkb25seSBwbGFjZWhvbGRlcj1cIumAieaLqeeJiOacrOi+k+WHuuagueebruW9lVwiPjwvdWktaW5wdXQ+XG4gICAgICAgIDx1aS1idXR0b24gOmRpc2FibGVkPVwiaXNCdXN5XCIgQGNsaWNrPVwicGlja1ZlcnNpb25PdXRwdXREaXJcIj7mtY/op4g8L3VpLWJ1dHRvbj5cbiAgICAgIDwvZGl2PlxuICAgIDwvZGl2PlxuXG4gICAgPGRpdiBjbGFzcz1cImZpZWxkLXJvd1wiPlxuICAgICAgPGRpdiBjbGFzcz1cImZpZWxkLWxhYmVsXCI+YnVpbGQvYW5kcm9pZCDot6/lvoQ8L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJwYXRoLXJvd1wiPlxuICAgICAgICA8dWktaW5wdXQgOnZhbHVlPVwiYnVpbGRBbmRyb2lkUGF0aFwiIHJlYWRvbmx5IHBsYWNlaG9sZGVyPVwi6YCJ5oupIE5hdGl2ZSDmnoTlu7rkuqfniannm67lvZVcIj48L3VpLWlucHV0PlxuICAgICAgICA8dWktYnV0dG9uIDpkaXNhYmxlZD1cImlzQnVzeVwiIEBjbGljaz1cInBpY2tCdWlsZEFuZHJvaWRQYXRoXCI+5rWP6KeIPC91aS1idXR0b24+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJoaW50XCI+5bCG6Ieq5Yqo6K+75Y+WIGRhdGEvIOS4i+eahOaehOW7uui1hOa6kO+8iOiLpeWtmOWcqCBidWlsZC9hbmRyb2lkL2RhdGHvvIk8L2Rpdj5cbiAgICA8L2Rpdj5cblxuICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1yb3dcIj5cbiAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPueJiOacrOWPt++8iOebruW9leWQje+8jOeyvuehruWIsOenku+8iTwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cInZlcnNpb24tZGlzcGxheVwiIDpjbGFzcz1cInsgJ2lzLWVtcHR5JzogIXZlcnNpb24gfVwiPnt7IHZlcnNpb24gfHwgJ+eCueWHu+OAjOeUn+aIkOi/nOeoi+eJiOacrOOAjeaXtuiHquWKqOeUn+aIkCcgfX08L2Rpdj5cbiAgICA8L2Rpdj5cblxuICAgIDxkaXYgY2xhc3M9XCJhY3Rpb24tZ3JvdXBcIj5cbiAgICAgIDx1aS1idXR0b24gdHlwZT1cInByaW1hcnlcIiA6ZGlzYWJsZWQ9XCJpc0J1c3lcIiBAY2xpY2s9XCJvbkdlbmVyYXRlUmVtb3RlXCI+55Sf5oiQ6L+c56iL54mI5pysPC91aS1idXR0b24+XG4gICAgICA8ZGl2IGNsYXNzPVwicHJvZ3Jlc3MtYmxvY2sgdGlnaHRcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImZpZWxkLWxhYmVsXCI+6L+c56iL54mI5pys6L+b5bqm77yae3sgcmVtb3RlUHJvZ3Jlc3MucGVyY2VudCB9fSU8L2Rpdj5cbiAgICAgICAgPHVpLXByb2dyZXNzIDp2YWx1ZT1cInJlbW90ZVByb2dyZXNzLnBlcmNlbnRcIj48L3VpLXByb2dyZXNzPlxuICAgICAgICA8ZGl2IGNsYXNzPVwicHJvZ3Jlc3MtdGV4dFwiPnt7IHJlbW90ZVByb2dyZXNzLm1lc3NhZ2UgfX08L2Rpdj5cbiAgICAgIDwvZGl2PlxuICAgIDwvZGl2PlxuXG4gICAgPGRpdiBjbGFzcz1cImFjdGlvbi1ncm91cFwiPlxuICAgICAgPHVpLWJ1dHRvbiB0eXBlPVwicHJpbWFyeVwiIDpkaXNhYmxlZD1cImlzQnVzeVwiIEBjbGljaz1cIm9uR2VuZXJhdGVQYWNrYWdlXCI+55Sf5oiQ5omT5YyF54mI5pysPC91aS1idXR0b24+XG4gICAgICA8ZGl2IGNsYXNzPVwicHJvZ3Jlc3MtYmxvY2sgdGlnaHRcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImZpZWxkLWxhYmVsXCI+5omT5YyF54mI5pys6L+b5bqm77yae3sgcGFja2FnZVByb2dyZXNzLnBlcmNlbnQgfX0lPC9kaXY+XG4gICAgICAgIDx1aS1wcm9ncmVzcyA6dmFsdWU9XCJwYWNrYWdlUHJvZ3Jlc3MucGVyY2VudFwiPjwvdWktcHJvZ3Jlc3M+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJwcm9ncmVzcy10ZXh0XCI+e3sgcGFja2FnZVByb2dyZXNzLm1lc3NhZ2UgfX08L2Rpdj5cbiAgICAgIDwvZGl2PlxuICAgIDwvZGl2PlxuXG4gICAgPGRpdiBjbGFzcz1cImhpbnRcIiB2LWlmPVwibGFzdFZlcnNpb25EaXJcIj7kuIrmrKHov5znqIvniYjmnKzvvJp7eyBsYXN0VmVyc2lvbkRpciB9fTwvZGl2PlxuICA8L2Rpdj5cblxuICA8ZGl2IGNsYXNzPVwiZGl2aWRlclwiPjwvZGl2PlxuXG4gIDxkaXYgY2xhc3M9XCJzZWN0aW9uLWJsb2NrXCI+XG4gICAgPGRpdiBjbGFzcz1cInNlY3Rpb24tdGl0bGVcIj7kuozjgIHotYTmupDkuIrkvKA8L2Rpdj5cblxuICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1yb3dcIj5cbiAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPuS4iuS8oOeJiOacrOebruW9le+8iOWQqyBtYW5pZmVzdC8g55qE54mI5pys5Y+355uu5b2V77yJPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwicGF0aC1yb3dcIj5cbiAgICAgICAgPHVpLWlucHV0IDp2YWx1ZT1cInVwbG9hZFZlcnNpb25EaXJcIiByZWFkb25seSBwbGFjZWhvbGRlcj1cIumAieaLqeimgeS4iuS8oOeahOeJiOacrOebruW9lVwiPjwvdWktaW5wdXQ+XG4gICAgICAgIDx1aS1idXR0b24gOmRpc2FibGVkPVwiaXNCdXN5XCIgQGNsaWNrPVwicGlja1VwbG9hZFZlcnNpb25EaXJcIj7mtY/op4g8L3VpLWJ1dHRvbj5cbiAgICAgIDwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImhpbnRcIj7pobvkuLogeXl5eU1NZGRISG1tc3Mg5qC85byP55uu5b2V77yM5LiU5YyF5ZCrIG1hbmlmZXN0LypfdmVyc2lvbi5qc29uPC9kaXY+XG4gICAgPC9kaXY+XG5cbiAgICA8ZGl2IGNsYXNzPVwiZmllbGQtcm93XCI+XG4gICAgICA8ZGl2IGNsYXNzPVwiZmllbGQtbGFiZWxcIj7otYTmupDmnI3liqHlmajnsbvlnos8L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJwYXRoLXJvd1wiPlxuICAgICAgICA8dWktYnV0dG9uIDpkaXNhYmxlZD1cImlzQnVzeVwiIDp0eXBlPVwic2VydmVyVHlwZSA9PT0gJ3MzJyA/ICdwcmltYXJ5JyA6ICdub3JtYWwnXCIgQGNsaWNrPVwic2VydmVyVHlwZSA9ICdzMydcIj5TMyDmnI3liqHlmag8L3VpLWJ1dHRvbj5cbiAgICAgICAgPHVpLWJ1dHRvbiA6ZGlzYWJsZWQ9XCJpc0J1c3lcIiA6dHlwZT1cInNlcnZlclR5cGUgPT09ICdzc2gnID8gJ3ByaW1hcnknIDogJ25vcm1hbCdcIiBAY2xpY2s9XCJzZXJ2ZXJUeXBlID0gJ3NzaCdcIj7mma7pgJrmnI3liqHlmaggKFNTSC9TRlRQKTwvdWktYnV0dG9uPlxuICAgICAgPC9kaXY+XG4gICAgPC9kaXY+XG5cbiAgICA8ZGl2IHYtaWY9XCJzZXJ2ZXJUeXBlID09PSAnczMnXCIgY2xhc3M9XCJjb25maWctZ3JpZFwiPlxuICAgICAgPGRpdiBjbGFzcz1cImZ1bGwtd2lkdGhcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImZpZWxkLWxhYmVsXCI+QWNjZXNzIEtleSBJRDwvZGl2PlxuICAgICAgICA8dWktaW5wdXQgOmRpc2FibGVkPVwiaXNCdXN5XCIgOnZhbHVlPVwiczNDb25maWcuYWNjZXNzS2V5SWRcIiBAY2hhbmdlPVwiKGUpID0+IHMzQ29uZmlnLmFjY2Vzc0tleUlkID0gZS50YXJnZXQudmFsdWVcIj48L3VpLWlucHV0PlxuICAgICAgPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZnVsbC13aWR0aFwiPlxuICAgICAgICA8ZGl2IGNsYXNzPVwiZmllbGQtbGFiZWxcIj5TZWNyZXQgQWNjZXNzIEtleTwvZGl2PlxuICAgICAgICA8dWktaW5wdXQgOmRpc2FibGVkPVwiaXNCdXN5XCIgcGFzc3dvcmQgOnZhbHVlPVwiczNDb25maWcuc2VjcmV0QWNjZXNzS2V5XCIgQGNoYW5nZT1cIihlKSA9PiBzM0NvbmZpZy5zZWNyZXRBY2Nlc3NLZXkgPSBlLnRhcmdldC52YWx1ZVwiPjwvdWktaW5wdXQ+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxkaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPlJlZ2lvbjwvZGl2PlxuICAgICAgICA8dWktaW5wdXQgOmRpc2FibGVkPVwiaXNCdXN5XCIgOnZhbHVlPVwiczNDb25maWcucmVnaW9uXCIgQGNoYW5nZT1cIihlKSA9PiBzM0NvbmZpZy5yZWdpb24gPSBlLnRhcmdldC52YWx1ZVwiPjwvdWktaW5wdXQ+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxkaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPkJ1Y2tldDwvZGl2PlxuICAgICAgICA8dWktaW5wdXQgOmRpc2FibGVkPVwiaXNCdXN5XCIgOnZhbHVlPVwiczNDb25maWcuYnVja2V0XCIgQGNoYW5nZT1cIihlKSA9PiBzM0NvbmZpZy5idWNrZXQgPSBlLnRhcmdldC52YWx1ZVwiPjwvdWktaW5wdXQ+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJmdWxsLXdpZHRoXCI+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPkZpbGUgUHJlZml4PC9kaXY+XG4gICAgICAgIDx1aS1pbnB1dCA6ZGlzYWJsZWQ9XCJpc0J1c3lcIiA6dmFsdWU9XCJzM0NvbmZpZy5maWxlUHJlZml4XCIgQGNoYW5nZT1cIihlKSA9PiBzM0NvbmZpZy5maWxlUHJlZml4ID0gZS50YXJnZXQudmFsdWVcIj48L3VpLWlucHV0PlxuICAgICAgPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZnVsbC13aWR0aFwiPlxuICAgICAgICA8ZGl2IGNsYXNzPVwiZmllbGQtbGFiZWxcIj5DbG91ZEZyb250IERpc3RyaWJ1dGlvbiBJRO+8iOWPr+mAie+8iTwvZGl2PlxuICAgICAgICA8dWktaW5wdXQgOmRpc2FibGVkPVwiaXNCdXN5XCIgOnZhbHVlPVwiczNDb25maWcuZGlzdHJpYnV0aW9uSWRcIiBAY2hhbmdlPVwiKGUpID0+IHMzQ29uZmlnLmRpc3RyaWJ1dGlvbklkID0gZS50YXJnZXQudmFsdWVcIj48L3VpLWlucHV0PlxuICAgICAgPC9kaXY+XG4gICAgPC9kaXY+XG5cbiAgICA8ZGl2IHYtZWxzZSBjbGFzcz1cImNvbmZpZy1ncmlkXCI+XG4gICAgICA8ZGl2PlxuICAgICAgICA8ZGl2IGNsYXNzPVwiZmllbGQtbGFiZWxcIj7mnI3liqHlmajlnLDlnYA8L2Rpdj5cbiAgICAgICAgPHVpLWlucHV0IDpkaXNhYmxlZD1cImlzQnVzeVwiIDp2YWx1ZT1cInNzaENvbmZpZy5ob3N0XCIgQGNoYW5nZT1cIihlKSA9PiBzc2hDb25maWcuaG9zdCA9IGUudGFyZ2V0LnZhbHVlXCI+PC91aS1pbnB1dD5cbiAgICAgIDwvZGl2PlxuICAgICAgPGRpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImZpZWxkLWxhYmVsXCI+56uv5Y+jPC9kaXY+XG4gICAgICAgIDx1aS1pbnB1dCA6ZGlzYWJsZWQ9XCJpc0J1c3lcIiA6dmFsdWU9XCJzc2hDb25maWcucG9ydFwiIEBjaGFuZ2U9XCIoZSkgPT4gc3NoQ29uZmlnLnBvcnQgPSBlLnRhcmdldC52YWx1ZVwiPjwvdWktaW5wdXQ+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxkaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPueUqOaIt+WQjTwvZGl2PlxuICAgICAgICA8dWktaW5wdXQgOmRpc2FibGVkPVwiaXNCdXN5XCIgOnZhbHVlPVwic3NoQ29uZmlnLnVzZXJuYW1lXCIgQGNoYW5nZT1cIihlKSA9PiBzc2hDb25maWcudXNlcm5hbWUgPSBlLnRhcmdldC52YWx1ZVwiPjwvdWktaW5wdXQ+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxkaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPuWvhueggTwvZGl2PlxuICAgICAgICA8dWktaW5wdXQgOmRpc2FibGVkPVwiaXNCdXN5XCIgcGFzc3dvcmQgOnZhbHVlPVwic3NoQ29uZmlnLnBhc3N3b3JkXCIgQGNoYW5nZT1cIihlKSA9PiBzc2hDb25maWcucGFzc3dvcmQgPSBlLnRhcmdldC52YWx1ZVwiPjwvdWktaW5wdXQ+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJmdWxsLXdpZHRoXCI+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPuengemSpe+8iOWPr+mAie+8jFBFTSDlhoXlrrnvvIk8L2Rpdj5cbiAgICAgICAgPHVpLXRleHRhcmVhIDpkaXNhYmxlZD1cImlzQnVzeVwiIDp2YWx1ZT1cInNzaENvbmZpZy5wcml2YXRlS2V5XCIgQGNoYW5nZT1cIihlKSA9PiBzc2hDb25maWcucHJpdmF0ZUtleSA9IGUudGFyZ2V0LnZhbHVlXCI+PC91aS10ZXh0YXJlYT5cbiAgICAgIDwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImZ1bGwtd2lkdGhcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImZpZWxkLWxhYmVsXCI+6L+c56iL55uu5b2VPC9kaXY+XG4gICAgICAgIDx1aS1pbnB1dCA6ZGlzYWJsZWQ9XCJpc0J1c3lcIiA6dmFsdWU9XCJzc2hDb25maWcucmVtb3RlUGF0aFwiIEBjaGFuZ2U9XCIoZSkgPT4gc3NoQ29uZmlnLnJlbW90ZVBhdGggPSBlLnRhcmdldC52YWx1ZVwiPjwvdWktaW5wdXQ+XG4gICAgICA8L2Rpdj5cbiAgICA8L2Rpdj5cblxuICAgIDxkaXYgY2xhc3M9XCJhY3Rpb24tZ3JvdXBcIj5cbiAgICAgIDx1aS1idXR0b24gdHlwZT1cInByaW1hcnlcIiA6ZGlzYWJsZWQ9XCJpc0J1c3lcIiBAY2xpY2s9XCJvblVwbG9hZFwiPuS4iuS8oOi/nOeoi+eJiOacrDwvdWktYnV0dG9uPlxuICAgICAgPGRpdiBjbGFzcz1cInByb2dyZXNzLWJsb2NrIHRpZ2h0XCI+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZC1sYWJlbFwiPuS4iuS8oOi/m+W6pu+8mnt7IHVwbG9hZFByb2dyZXNzLnBlcmNlbnQgfX0lPC9kaXY+XG4gICAgICAgIDx1aS1wcm9ncmVzcyA6dmFsdWU9XCJ1cGxvYWRQcm9ncmVzcy5wZXJjZW50XCI+PC91aS1wcm9ncmVzcz5cbiAgICAgICAgPGRpdiBjbGFzcz1cInByb2dyZXNzLXRleHRcIj57eyB1cGxvYWRQcm9ncmVzcy5tZXNzYWdlIH19PC9kaXY+XG4gICAgICA8L2Rpdj5cbiAgICA8L2Rpdj5cbiAgPC9kaXY+XG48L2Rpdj5cbiAgICAgICAgICAgICAgICBgLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgICAgYXBwLmNvbmZpZy5jb21waWxlck9wdGlvbnMuaXNDdXN0b21FbGVtZW50ID0gKHRhZykgPT4gdGFnLnN0YXJ0c1dpdGgoJ3VpLScpO1xuICAgICAgICBhcHAubW91bnQodGhpcy4kLmFwcCk7XG4gICAgICAgIHBhbmVsRGF0YU1hcC5zZXQodGhpcywgYXBwKTtcbiAgICB9LFxuICAgIGJlZm9yZUNsb3NlKCkge30sXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIHBhbmVsVm0gPSBudWxsO1xuICAgICAgICBjb25zdCBhcHAgPSBwYW5lbERhdGFNYXAuZ2V0KHRoaXMpO1xuICAgICAgICBpZiAoYXBwKSB7XG4gICAgICAgICAgICBhcHAudW5tb3VudCgpO1xuICAgICAgICB9XG4gICAgfSxcbn0pO1xuIl19