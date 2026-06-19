import fs from 'fs';
import path from 'path';
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    CopyObjectCommand,
    ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { IS3UploadConfig, IProjectManifest } from '../types';
import { md5Buffer } from '../utils/md5';
import { executeDiffUpload } from './diff-upload';
import { IRemoteStorageProvider, IRemoteVersionJson, IUploadStats } from './upload-types';

async function streamToBuffer(body: unknown): Promise<Buffer> {
    if (!body) {
        return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(body)) {
        return body;
    }
    if (body instanceof Uint8Array) {
        return Buffer.from(body);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function normalizePrefix(prefix: string): string {
    return prefix.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function encodeCopySource(bucket: string, key: string): string {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${bucket}/${encodedKey}`;
}

class S3RemoteStorageProvider implements IRemoteStorageProvider {
    private client: S3Client;
    private bucket: string;
    private prefix: string;

    constructor(config: IS3UploadConfig) {
        this.client = new S3Client({
            region: config.region,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
        this.bucket = config.bucket;
        this.prefix = normalizePrefix(config.filePrefix);
    }

    private versionKey(version: string, relPath = ''): string {
        const base = this.prefix ? `${this.prefix}/${version}` : version;
        if (!relPath) {
            return base;
        }
        return `${base}/${relPath}`.replace(/\/+/g, '/');
    }

    private rootKey(relPath: string): string {
        return this.prefix ? `${this.prefix}/${relPath}`.replace(/\/+/g, '/') : relPath;
    }

    async fetchVersionJson(): Promise<IRemoteVersionJson | null> {
        const key = this.rootKey('version.json');
        try {
            const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
            const buffer = await streamToBuffer(resp.Body);
            if (buffer.length === 0) {
                return null;
            }
            const parsed = JSON.parse(buffer.toString('utf-8')) as IRemoteVersionJson;
            return parsed?.version ? parsed : null;
        } catch (err: unknown) {
            const code = (err as { name?: string; Code?: string })?.name || (err as { Code?: string })?.Code;
            if (code === 'NoSuchKey' || code === 'NotFound') {
                return null;
            }
            throw err;
        }
    }

    async fetchRemoteMd5Index(remoteVersion: string): Promise<Map<string, string>> {
        const map = new Map<string, string>();
        const manifestPrefix = `${this.versionKey(remoteVersion)}/manifest/`;

        let continuationToken: string | undefined;
        do {
            const listResp = await this.client.send(new ListObjectsV2Command({
                Bucket: this.bucket,
                Prefix: manifestPrefix,
                ContinuationToken: continuationToken,
            }));

            for (const item of listResp.Contents ?? []) {
                if (!item.Key || !item.Key.endsWith('_version.json')) {
                    continue;
                }
                const resp = await this.client.send(new GetObjectCommand({
                    Bucket: this.bucket,
                    Key: item.Key,
                }));
                const buffer = await streamToBuffer(resp.Body);
                const versionPrefix = `${this.versionKey(remoteVersion)}/`;
                const relFromVersionRoot = item.Key.startsWith(versionPrefix)
                    ? item.Key.slice(versionPrefix.length)
                    : item.Key;
                map.set(relFromVersionRoot, md5Buffer(buffer));

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

            continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
        } while (continuationToken);

        const zipsKey = this.versionKey(remoteVersion, 'zips/zips.json');
        try {
            const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: zipsKey }));
            const buffer = await streamToBuffer(resp.Body);
            map.set('zips/zips.json', md5Buffer(buffer));
            const zipsMeta = JSON.parse(buffer.toString('utf-8')) as Record<string, string>;
            for (const [zipName, md5] of Object.entries(zipsMeta)) {
                if (typeof md5 === 'string' && md5) {
                    map.set(`zips/${zipName}`, md5);
                }
            }
        } catch (err: unknown) {
            const code = (err as { name?: string })?.name;
            if (code !== 'NoSuchKey' && code !== 'NotFound') {
                throw err;
            }
        }

        return map;
    }

    async getRemoteFileMd5(_remoteVersion: string, _relPath: string): Promise<string | null> {
        return null;
    }

    async remoteCopy(fromVersion: string, relPath: string, toVersion: string): Promise<void> {
        const sourceKey = this.versionKey(fromVersion, relPath);
        const destKey = this.versionKey(toVersion, relPath);
        await this.client.send(new CopyObjectCommand({
            Bucket: this.bucket,
            CopySource: encodeCopySource(this.bucket, sourceKey),
            Key: destKey,
        }));
    }

    async localUpload(localPath: string, relPath: string, toVersion: string): Promise<void> {
        const key = this.versionKey(toVersion, relPath);
        const body = fs.readFileSync(localPath);
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
        }));
    }

    async writeVersionJson(version: string): Promise<void> {
        const key = this.rootKey('version.json');
        const body = JSON.stringify({ version }, null, 2);
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: 'application/json',
        }));
    }

    async ensureVersionDir(_toVersion: string): Promise<void> {
        // S3 无需预创建目录
    }
}

export async function uploadToS3(
    localVersionDir: string,
    config: IS3UploadConfig,
    onProgress?: (percent: number, message: string) => void,
): Promise<IUploadStats> {
    const provider = new S3RemoteStorageProvider(config);
    return executeDiffUpload(provider, localVersionDir, { onProgress });
}
