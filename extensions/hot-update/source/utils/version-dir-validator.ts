import fs from 'fs';
import path from 'path';

export interface IVersionDirValidation {
    ok: boolean;
    error?: string;
    version?: string;
    manifestCount?: number;
}

const VERSION_DIR_PATTERN = /^\d{14}$/;

export function validateVersionDir(dir: string): IVersionDirValidation {
    const trimmed = dir.trim();
    if (!trimmed) {
        return { ok: false, error: '请先选择上传版本目录' };
    }
    if (!fs.existsSync(trimmed)) {
        return { ok: false, error: '目录不存在' };
    }
    if (!fs.statSync(trimmed).isDirectory()) {
        return { ok: false, error: '路径不是目录' };
    }

    const version = path.basename(trimmed);
    if (!VERSION_DIR_PATTERN.test(version)) {
        return {
            ok: false,
            error: `目录名 "${version}" 不是有效版本号（应为 yyyyMMddHHmmss，如 20260613234849）`,
        };
    }

    const manifestDir = path.join(trimmed, 'manifest');
    if (!fs.existsSync(manifestDir) || !fs.statSync(manifestDir).isDirectory()) {
        return { ok: false, error: '缺少 manifest/ 子目录，不是有效的远程版本目录' };
    }

    const manifestFiles = fs.readdirSync(manifestDir).filter((name) => name.endsWith('_version.json'));
    if (manifestFiles.length === 0) {
        return { ok: false, error: 'manifest/ 下未找到 *_version.json 文件' };
    }

    for (const file of manifestFiles) {
        const filePath = path.join(manifestDir, file);
        let parsed: unknown;
        try {
            parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
            return { ok: false, error: `${file} 不是有效的 JSON 文件` };
        }
        if (!parsed || typeof parsed !== 'object') {
            return { ok: false, error: `${file} 格式无效` };
        }
        const manifest = parsed as Record<string, unknown>;
        if (typeof manifest.version !== 'string' || !manifest.version) {
            return { ok: false, error: `${file} 缺少 version 字段` };
        }
        if (!manifest.assets || typeof manifest.assets !== 'object') {
            return { ok: false, error: `${file} 缺少 assets 字段` };
        }
        if (manifest.version !== version) {
            return {
                ok: false,
                error: `${file} 内 version（${manifest.version}）与目录名（${version}）不一致`,
            };
        }
    }

    return { ok: true, version, manifestCount: manifestFiles.length };
}
