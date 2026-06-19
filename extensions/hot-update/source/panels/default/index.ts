import { readFileSync } from 'fs-extra';
import { join } from 'path';
import { createApp, App, defineComponent } from 'vue';

const PACKAGE_NAME = 'hot-update';
const SAVE_DEBOUNCE_MS = 400;

const panelDataMap = new WeakMap<any, App>();

type BusyTask = 'remote' | 'package' | 'upload';

interface IPanelVm {
    setRemoteProgress: (d: { percent: number; message: string }) => void;
    setPackageProgress: (d: { percent: number; message: string }) => void;
    setUploadProgress: (d: { percent: number; message: string }) => void;
}

let panelVm: IPanelVm | null = null;

interface IProgressState {
    percent: number;
    message: string;
}

interface IProfileData {
    versionOutputDir?: string;
    buildAndroidPath?: string;
    uploadVersionDir?: string;
    serverType?: 's3' | 'ssh';
    s3Config?: Record<string, string>;
    sshConfig?: Record<string, string>;
    lastVersion?: string;
    lastVersionDir?: string;
}

interface IVersionDirValidation {
    ok: boolean;
    error?: string;
    version?: string;
    manifestCount?: number;
}

function normalizeProgressPayload(...args: unknown[]): IProgressState {
    for (const arg of args) {
        if (arg && typeof arg === 'object' && 'percent' in arg) {
            const payload = arg as { percent?: unknown; message?: unknown };
            return {
                percent: typeof payload.percent === 'number' ? payload.percent : 0,
                message: typeof payload.message === 'string' ? payload.message : '',
            };
        }
    }
    return { percent: 0, message: '' };
}

async function requestMain(message: string, ...args: unknown[]) {
    return Editor.Message.request(PACKAGE_NAME, message as any, ...(args as any[]));
}

async function pickDirectory(title: string, defaultPath?: string): Promise<string | null> {
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
        show() {},
        hide() {},
    },
    template: readFileSync(join(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: readFileSync(join(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        app: '#app',
    },
    methods: {
        onRemoteProgress(...args: unknown[]) {
            panelVm?.setRemoteProgress(normalizeProgressPayload(...args));
        },
        onPackageProgress(...args: unknown[]) {
            panelVm?.setPackageProgress(normalizeProgressPayload(...args));
        },
        onUploadProgress(...args: unknown[]) {
            panelVm?.setUploadProgress(normalizeProgressPayload(...args));
        },
    },
    ready() {
        if (!this.$.app) {
            return;
        }

        const app = createApp(
            defineComponent({
                data() {
                    return {
                        versionOutputDir: '',
                        buildAndroidPath: '',
                        version: '',
                        serverType: 's3' as 's3' | 'ssh',
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
                        remoteProgress: { percent: 0, message: '' } as IProgressState,
                        packageProgress: { percent: 0, message: '' } as IProgressState,
                        uploadProgress: { percent: 0, message: '' } as IProgressState,
                        uploadVersionDir: '',
                        lastVersionDir: '',
                        busyTask: null as BusyTask | null,
                        isRestoringProfile: false,
                        saveTimer: null as ReturnType<typeof setTimeout> | null,
                    };
                },
                computed: {
                    isBusy(): boolean {
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
                            const profile = (raw && typeof raw === 'object' ? raw : {}) as IProfileData;

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
                                this.s3Config = { ...this.s3Config, ...profile.s3Config };
                            }
                            if (profile.sshConfig) {
                                this.sshConfig = { ...this.sshConfig, ...profile.sshConfig };
                            }
                            if (profile.lastVersionDir) {
                                this.lastVersionDir = profile.lastVersionDir;
                            }
                            if (profile.uploadVersionDir) {
                                this.uploadVersionDir = profile.uploadVersionDir;
                            } else if (profile.lastVersionDir) {
                                this.uploadVersionDir = profile.lastVersionDir;
                            }
                            if (profile.lastVersion) {
                                this.version = profile.lastVersion;
                            }
                        } finally {
                            this.isRestoringProfile = false;
                        }
                    },
                    collectProfileSnapshot(extra: Partial<IProfileData> = {}): IProfileData {
                        return {
                            versionOutputDir: this.versionOutputDir,
                            buildAndroidPath: this.buildAndroidPath,
                            serverType: this.serverType,
                            s3Config: { ...this.s3Config },
                            sshConfig: { ...this.sshConfig },
                            lastVersion: this.version,
                            lastVersionDir: this.lastVersionDir,
                            uploadVersionDir: this.uploadVersionDir,
                            ...extra,
                        };
                    },
                    async saveProfile(extra: Partial<IProfileData> = {}) {
                        await requestMain('save-profile', this.collectProfileSnapshot(extra));
                    },
                    beginBusy(task: BusyTask) {
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
                    async validateUploadVersionDir(dir: string): Promise<IVersionDirValidation> {
                        return requestMain('validate-version-dir', dir) as Promise<IVersionDirValidation>;
                    },
                    async applyUploadVersionDir(dir: string, showSuccessHint = false): Promise<boolean> {
                        const result = await this.validateUploadVersionDir(dir);
                        if (!result.ok) {
                            Editor.Dialog.warn(result.error || '版本目录无效', { title: '热更新' });
                            return false;
                        }
                        this.uploadVersionDir = dir;
                        if (showSuccessHint && result.version) {
                            Editor.Dialog.info(
                                `版本目录有效：${result.version}\nmanifest 文件数：${result.manifestCount ?? 0}`,
                                { title: '热更新' },
                            );
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
                    validateGenerateInputs(): string | null {
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
                            this.version = await requestMain('format-version-timestamp') as string;
                            this.remoteProgress = { percent: 0, message: '开始生成远程版本...' };

                            const result = await requestMain('generate-remote-version', {
                                versionOutputDir: this.versionOutputDir,
                                buildAndroidPath: this.buildAndroidPath,
                                version: this.version,
                            }) as { ok: boolean; outputDir?: string; error?: string };

                            if (result.ok && result.outputDir) {
                                this.lastVersionDir = result.outputDir;
                                this.uploadVersionDir = result.outputDir;
                                await this.saveProfile({
                                    lastVersionDir: result.outputDir,
                                    uploadVersionDir: result.outputDir,
                                    lastVersion: this.version,
                                });
                                Editor.Dialog.info(`远程版本已生成：\n${result.outputDir}`, { title: '热更新' });
                            } else {
                                Editor.Dialog.error(result.error || '生成失败', { title: '热更新' });
                            }
                        } finally {
                            this.endBusy();
                        }
                    },
                    async onGeneratePackage() {
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
                            }) as { ok: boolean; removed?: string[]; error?: string };

                            if (result.ok) {
                                const removed = result.removed?.length ? result.removed.join(', ') : '无';
                                Editor.Dialog.info(`打包版本处理完成，已剔除：${removed}`, { title: '热更新' });
                            } else {
                                Editor.Dialog.error(result.error || '处理失败', { title: '热更新' });
                            }
                        } finally {
                            this.endBusy();
                        }
                    },
                    async onUpload() {
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
                        } else if (!this.sshConfig.host.trim() || !this.sshConfig.username.trim()) {
                            Editor.Dialog.warn('请填写 SSH 服务器地址与用户名', { title: '热更新' });
                            return;
                        } else if (!this.sshConfig.password.trim() && !this.sshConfig.privateKey.trim()) {
                            Editor.Dialog.warn('请填写 SSH 密码或私钥', { title: '热更新' });
                            return;
                        }

                        this.beginBusy('upload');
                        this.uploadProgress = { percent: 0, message: '开始上传...' };

                        try {
                            const payload: Record<string, unknown> = {
                                serverType: this.serverType,
                                localVersionDir: this.uploadVersionDir,
                            };

                            if (this.serverType === 's3') {
                                payload.s3Config = { ...this.s3Config };
                            } else {
                                payload.sshConfig = {
                                    ...this.sshConfig,
                                    port: parseInt(this.sshConfig.port, 10) || 22,
                                };
                            }

                            const result = await requestMain('upload-resources', payload) as {
                                ok: boolean;
                                total?: number;
                                copied?: number;
                                uploaded?: number;
                                copyFallback?: number;
                                error?: string;
                            };

                            if (result.ok) {
                                await this.saveProfile();
                                Editor.Dialog.info(
                                    [
                                        '差异上传完成',
                                        `总计：${result.total ?? 0} 个文件`,
                                        `远程复制：${result.copied ?? 0}`,
                                        `本地上传：${result.uploaded ?? 0}`,
                                        `复制回退上传：${result.copyFallback ?? 0}`,
                                    ].join('\n'),
                                    { title: '热更新' },
                                );
                            } else {
                                Editor.Dialog.error(result.error || '上传失败', { title: '热更新' });
                            }
                        } finally {
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
            }),
        );

        app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('ui-');
        app.mount(this.$.app);
        panelDataMap.set(this, app);
    },
    beforeClose() {},
    close() {
        panelVm = null;
        const app = panelDataMap.get(this);
        if (app) {
            app.unmount();
        }
    },
});
