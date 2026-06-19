// @ts-ignore
import packageJSON from '../package.json';
import { generateRemoteVersion } from './hot-update-generator';
import { stripPackageBundles } from './package-stripper';
import { uploadToS3 } from './upload/s3-uploader';
import { uploadToSsh } from './upload/sftp-uploader';
import { IS3UploadConfig, ISshUploadConfig, ProgressReporter, ServerType } from './types';
import { formatVersionTimestamp } from './utils/version';
import { validateVersionDir } from './utils/version-dir-validator';

const PACKAGE_NAME = packageJSON.name;

function notifyPanel(message: string, percent: number, msg: string) {
    Editor.Message.send(PACKAGE_NAME, message, { percent, message: msg });
}

function makeReporter(message: string): ProgressReporter {
    return (percent, msg) => notifyPanel(message, percent, msg);
}

export const methods: { [key: string]: (...args: any[]) => any } = {
    openPanel() {
        Editor.Panel.open(PACKAGE_NAME);
    },

    formatVersionTimestamp() {
        return formatVersionTimestamp();
    },

    async generateRemoteVersion(options: {
        versionOutputDir: string;
        buildAndroidPath: string;
        version?: string;
    }) {
        const version = options.version || formatVersionTimestamp();
        try {
            const result = await generateRemoteVersion(
                {
                    versionOutputDir: options.versionOutputDir,
                    buildAndroidPath: options.buildAndroidPath,
                    version,
                },
                makeReporter('remote-progress'),
            );
            notifyPanel('remote-progress', 100, '完成');
            return { ok: true, ...result };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            notifyPanel('remote-progress', 0, `失败: ${message}`);
            return { ok: false, error: message };
        }
    },

    async generatePackageVersion(options: { buildAndroidPath: string }) {
        try {
            const result = await stripPackageBundles(options, makeReporter('package-progress'));
            notifyPanel('package-progress', 100, '完成');
            return { ok: true, ...result };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            notifyPanel('package-progress', 0, `失败: ${message}`);
            return { ok: false, error: message };
        }
    },

    async uploadResources(options: {
        serverType: ServerType;
        localVersionDir: string;
        s3Config?: IS3UploadConfig;
        sshConfig?: ISshUploadConfig;
    }) {
        try {
            let stats;
            if (options.serverType === 's3') {
                if (!options.s3Config) {
                    throw new Error('缺少 S3 配置');
                }
                stats = await uploadToS3(options.localVersionDir, options.s3Config, makeReporter('upload-progress'));
            } else if (options.serverType === 'ssh') {
                if (!options.sshConfig) {
                    throw new Error('缺少 SSH 配置');
                }
                stats = await uploadToSsh(options.localVersionDir, options.sshConfig, makeReporter('upload-progress'));
            } else {
                throw new Error(`不支持的服务器类型: ${options.serverType}`);
            }
            notifyPanel('upload-progress', 100, '完成');
            return { ok: true, ...stats };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            notifyPanel('upload-progress', 0, `失败: ${message}`);
            return { ok: false, error: message };
        }
    },

    async saveProfile(data: Record<string, unknown>) {
        await Editor.Profile.setProject(PACKAGE_NAME, 'settings', data);
        return true;
    },

    async loadProfile() {
        const data = await Editor.Profile.getProject(PACKAGE_NAME, 'settings');
        if (data && typeof data === 'object') {
            return data as Record<string, unknown>;
        }
        return {};
    },

    validateVersionDir(dir: string) {
        return validateVersionDir(dir);
    },
};

export function load() {}

export function unload() {}
