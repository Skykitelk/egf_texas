export interface IAssetItem {
    size: number;
    md5: string;
    compressed: boolean;
}

export interface IProjectManifest {
    version: string;
    assets: Record<string, IAssetItem>;
    searchPaths: string[];
}

export type ProgressReporter = (percent: number, message: string) => void;

export const INCREMENTAL_ONLY_BUNDLES = new Set(['main', 'internal']);

export interface IS3UploadConfig {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    filePrefix: string;
    distributionId?: string;
}

export interface ISshUploadConfig {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    remotePath: string;
}

export type ServerType = 's3' | 'ssh';
