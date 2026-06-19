import fs from 'fs';
import path from 'path';

/** build/android → build/android/data（若存在） */
export function resolveBuildDataRoot(buildAndroidPath: string): string {
    const normalized = path.normalize(buildAndroidPath);
    const dataPath = path.join(normalized, 'data');
    if (fs.existsSync(dataPath)) {
        return dataPath;
    }
    return normalized;
}

/** build/android → .../data/assets */
export function resolveAssetsDir(buildAndroidPath: string): string {
    return path.join(resolveBuildDataRoot(buildAndroidPath), 'assets');
}

export function toPosixPath(rel: string): string {
    return rel.split(path.sep).join('/');
}
