import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';
import { INCREMENTAL_ONLY_BUNDLES, ProgressReporter } from './types';
import { resolveAssetsDir } from './utils/paths';

export interface IStripPackageOptions {
    buildAndroidPath: string;
}

export interface IStripPackageResult {
    assetsDir: string;
    removed: string[];
    kept: string[];
}

export async function stripPackageBundles(
    options: IStripPackageOptions,
    onProgress?: ProgressReporter,
): Promise<IStripPackageResult> {
    const assetsDir = resolveAssetsDir(options.buildAndroidPath);

    if (!fs.existsSync(assetsDir)) {
        throw new Error(`assets 目录不存在：${assetsDir}`);
    }

    const allDirs = fs.readdirSync(assetsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

    const toRemove = allDirs.filter((name) => !INCREMENTAL_ONLY_BUNDLES.has(name));
    const kept = allDirs.filter((name) => INCREMENTAL_ONLY_BUNDLES.has(name));

    if (toRemove.length === 0) {
        onProgress?.(100, '无需剔除，assets 下仅有 main/internal');
        return { assetsDir, removed: [], kept };
    }

    const total = toRemove.length;
    for (let i = 0; i < total; i++) {
        const name = toRemove[i];
        const dir = path.join(assetsDir, name);
        onProgress?.(Math.round(((i + 0.5) / total) * 100), `删除 Bundle: ${name}`);
        await fse.remove(dir);
        onProgress?.(Math.round(((i + 1) / total) * 100), `已删除: ${name}`);
    }

    onProgress?.(100, `打包版本处理完成，剔除 ${toRemove.length} 个 Bundle`);
    return { assetsDir, removed: toRemove, kept };
}
