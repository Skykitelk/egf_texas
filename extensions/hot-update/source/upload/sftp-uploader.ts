import fs from 'fs';
import os from 'os';
import path from 'path';
import SftpClient from 'ssh2-sftp-client';
import { ISshUploadConfig, IProjectManifest } from '../types';
import { md5Buffer } from '../utils/md5';
import { executeDiffUpload } from './diff-upload';
import { IRemoteStorageProvider, IRemoteVersionJson, IUploadStats } from './upload-types';

const SSH_COPY_TIMEOUT_MS = 120_000;

function normalizeRemotePath(remotePath: string): string {
    return remotePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} 超时（${ms / 1000}s）`));
        }, ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}

class SshRemoteStorageProvider implements IRemoteStorageProvider {
    private sftp: SftpClient;
    private remoteBase: string;

    constructor(sftp: SftpClient, remoteBase: string) {
        this.sftp = sftp;
        this.remoteBase = normalizeRemotePath(remoteBase);
    }

    private versionDir(version: string): string {
        return `${this.remoteBase}/${version}`.replace(/\/+/g, '/');
    }

    private versionFile(version: string, relPath: string): string {
        return `${this.versionDir(version)}/${relPath}`.replace(/\/+/g, '/');
    }

    private rootFile(relPath: string): string {
        return `${this.remoteBase}/${relPath}`.replace(/\/+/g, '/');
    }

    async fetchVersionJson(): Promise<IRemoteVersionJson | null> {
        const remotePath = this.rootFile('version.json');
        try {
            if (!(await this.sftp.exists(remotePath))) {
                return null;
            }
            const buffer = await this.sftp.get(remotePath) as Buffer;
            const parsed = JSON.parse(buffer.toString('utf-8')) as IRemoteVersionJson;
            return parsed?.version ? parsed : null;
        } catch {
            return null;
        }
    }

    async fetchRemoteMd5Index(remoteVersion: string): Promise<Map<string, string>> {
        const map = new Map<string, string>();
        const manifestDir = `${this.versionDir(remoteVersion)}/manifest`;

        if (!(await this.sftp.exists(manifestDir))) {
            return map;
        }

        const entries = await this.sftp.list(manifestDir);
        for (const entry of entries) {
            if (entry.type !== '-' || !entry.name.endsWith('_version.json')) {
                continue;
            }
            const remotePath = `${manifestDir}/${entry.name}`;
            const buffer = await this.sftp.get(remotePath) as Buffer;
            map.set(`manifest/${entry.name}`, md5Buffer(buffer));

            try {
                const manifest = JSON.parse(buffer.toString('utf-8')) as IProjectManifest;
                if (manifest.assets) {
                    for (const [assetKey, asset] of Object.entries(manifest.assets)) {
                        if (asset?.md5) {
                            map.set(assetKey, asset.md5);
                        }
                    }
                }
            } catch {
                // 忽略损坏 manifest
            }
        }

        const zipsJsonPath = this.versionFile(remoteVersion, 'zips/zips.json');
        if (await this.sftp.exists(zipsJsonPath)) {
            try {
                const buffer = await this.sftp.get(zipsJsonPath) as Buffer;
                map.set('zips/zips.json', md5Buffer(buffer));
                const zipsMeta = JSON.parse(buffer.toString('utf-8')) as Record<string, string>;
                for (const [zipName, md5] of Object.entries(zipsMeta)) {
                    if (typeof md5 === 'string' && md5) {
                        map.set(`zips/${zipName}`, md5);
                    }
                }
            } catch {
                // zips.json 无效时忽略
            }
        }

        return map;
    }

    async getRemoteFileMd5(_remoteVersion: string, _relPath: string): Promise<string | null> {
        return null;
    }

    /**
     * 通过 SFTP rcopy 在远程复制文件（不依赖 shell exec）。
     * 多数 SFTP 账号禁止 exec，原先 cp 命令会永久挂起。
     */
    async remoteCopy(fromVersion: string, relPath: string, toVersion: string): Promise<void> {
        const source = this.versionFile(fromVersion, relPath);
        const dest = this.versionFile(toVersion, relPath);
        const destDir = path.posix.dirname(dest);

        await this.sftp.mkdir(destDir, true);

        if (!(await this.sftp.exists(source))) {
            throw new Error(`远程源文件不存在：${source}`);
        }

        if (await this.sftp.exists(dest)) {
            await this.sftp.delete(dest, true);
        }

        await withTimeout(
            this.sftp.rcopy(source, dest),
            SSH_COPY_TIMEOUT_MS,
            `远程复制 ${relPath}`,
        );
    }

    async localUpload(localPath: string, relPath: string, toVersion: string): Promise<void> {
        const remotePath = this.versionFile(toVersion, relPath);
        const remoteDir = path.posix.dirname(remotePath);
        await this.sftp.mkdir(remoteDir, true);
        await this.sftp.fastPut(localPath, remotePath);
    }

    async writeVersionJson(version: string): Promise<void> {
        const remotePath = this.rootFile('version.json');
        const content = JSON.stringify({ version }, null, 2);
        const tmpPath = path.join(os.tmpdir(), `hot-update-version-${Date.now()}.json`);
        fs.writeFileSync(tmpPath, content, 'utf-8');
        try {
            await this.sftp.fastPut(tmpPath, remotePath);
        } finally {
            fs.unlinkSync(tmpPath);
        }
    }

    async ensureVersionDir(toVersion: string): Promise<void> {
        await this.sftp.mkdir(this.versionDir(toVersion), true);
    }
}

export async function uploadToSsh(
    localVersionDir: string,
    config: ISshUploadConfig,
    onProgress?: (percent: number, message: string) => void,
): Promise<IUploadStats> {
    const sftp = new SftpClient();
    const connectConfig: Record<string, unknown> = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
    };
    if (config.password) {
        connectConfig.password = config.password;
    }
    if (config.privateKey) {
        connectConfig.privateKey = config.privateKey;
    }

    await sftp.connect(connectConfig);

    try {
        const provider = new SshRemoteStorageProvider(sftp, config.remotePath);
        // SSH 远程复制走 SFTP 流式 rcopy，并发不宜过高
        return await executeDiffUpload(provider, localVersionDir, {
            onProgress,
            concurrency: 4,
            copyConcurrency: 2,
        });
    } finally {
        await sftp.end();
    }
}
