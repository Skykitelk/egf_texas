import fs from 'fs';
import path from 'path';
import { IProjectManifest } from '../types';
import { md5File } from '../utils/md5';
import { collectVersionFiles, toRelPath } from './file-collector';

export interface ILocalMd5Index {
    /** relPath → md5 */
    md5Map: Map<string, string>;
    files: string[];
}

function loadManifestAssets(manifestDir: string, out: Map<string, string>) {
    if (!fs.existsSync(manifestDir)) {
        return;
    }
    for (const name of fs.readdirSync(manifestDir)) {
        if (!name.endsWith('_version.json')) {
            continue;
        }
        const abs = path.join(manifestDir, name);
        try {
            const manifest = JSON.parse(fs.readFileSync(abs, 'utf-8')) as IProjectManifest;
            if (!manifest.assets) {
                continue;
            }
            for (const [key, item] of Object.entries(manifest.assets)) {
                if (item?.md5) {
                    out.set(key, item.md5);
                }
            }
        } catch {
            // 忽略损坏 manifest，后续按文件 md5 兜底
        }
    }
}

function loadZipsJson(zipsJsonPath: string, out: Map<string, string>) {
    if (!fs.existsSync(zipsJsonPath)) {
        return;
    }
    try {
        const data = JSON.parse(fs.readFileSync(zipsJsonPath, 'utf-8')) as Record<string, string>;
        for (const [zipName, md5] of Object.entries(data)) {
            if (typeof md5 === 'string' && md5) {
                out.set(`zips/${zipName}`, md5);
            }
        }
    } catch {
        // zips.json 无效时回退到文件 md5
    }
}

/** 优先使用 manifest / zips.json 中的 md5，对其余文件现场计算；以本地磁盘文件为全集 */
export function buildLocalMd5Index(versionDir: string): ILocalMd5Index {
    const md5Map = new Map<string, string>();
    const manifestDir = path.join(versionDir, 'manifest');
    const zipsJsonPath = path.join(versionDir, 'zips', 'zips.json');

    // manifest assets 与 zips.json 中的 md5（用于资源文件比对）
    loadManifestAssets(manifestDir, md5Map);
    loadZipsJson(zipsJsonPath, md5Map);

    const files = collectVersionFiles(versionDir);
    for (const absPath of files) {
        const rel = toRelPath(versionDir, absPath);
        // 每个本地文件都写入 md5Map，manifest/zips.json 文件本身用实际文件 md5
        md5Map.set(rel, md5File(absPath));
    }

    return { md5Map, files };
}

/** 从本地版本目录构建远程索引（manifest assets + zips.json + manifest 文件 md5） */
export function buildMd5IndexFromVersionDir(versionDir: string): Map<string, string> {
    return buildLocalMd5Index(versionDir).md5Map;
}
