import { ProgressReporter } from '../types';

export type UploadStrategy = 'remote-copy' | 'local-upload';

export interface IUploadTask {
    relPath: string;
    localPath: string;
    localMd5: string;
    strategy: UploadStrategy;
    /** 远程复制源版本（与目标 relPath 相同） */
    copyFromVersion?: string;
}

export interface IUploadStats {
    total: number;
    copied: number;
    uploaded: number;
    copyFallback: number;
    failed: number;
}

export interface IRemoteVersionJson {
    version: string;
}

export interface IRemoteStorageProvider {
    fetchVersionJson(): Promise<IRemoteVersionJson | null>;
    fetchRemoteMd5Index(remoteVersion: string): Promise<Map<string, string>>;
    getRemoteFileMd5(remoteVersion: string, relPath: string): Promise<string | null>;
    remoteCopy(fromVersion: string, relPath: string, toVersion: string): Promise<void>;
    localUpload(localPath: string, relPath: string, toVersion: string): Promise<void>;
    writeVersionJson(version: string): Promise<void>;
    ensureVersionDir(toVersion: string): Promise<void>;
}

export interface IDiffUploadOptions {
    localVersionDir: string;
    onProgress?: ProgressReporter;
    concurrency?: number;
    copyConcurrency?: number;
    maxRetries?: number;
}

export const DEFAULT_UPLOAD_CONCURRENCY = 6;
export const DEFAULT_UPLOAD_MAX_RETRIES = 3;
