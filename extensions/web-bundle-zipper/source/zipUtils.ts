import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

/** 流式压缩目录到 zip 文件，避免整包载入内存 */
export function zipDirectoryToFile(
    sourceDir: string,
    outZipPath: string,
    prefixInZip = '',
): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outZipPath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);

        archive.pipe(output);
        archive.directory(sourceDir, prefixInZip || false);
        archive.finalize();
    });
}

/** 递归删除目录 */
export function removeDir(dirPath: string) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

/** 压缩目录内文件，可选压缩后删除源文件 */
export async function zipDirectoryWithDelete(
    sourceDir: string,
    outZipPath: string,
    prefixInZip: string,
    deleteAfterZip: boolean,
) {
    await zipDirectoryToFile(sourceDir, outZipPath, prefixInZip);
    if (deleteAfterZip) {
        removeDir(sourceDir);
    }
}

/** 生成 web.zip（不含 assets 目录）与 cdn.zip（仅 assets） */
export async function zipPublishSplit(dest: string, webZipPath: string, cdnZipPath: string) {
    await zipWebWithoutAssets(dest, webZipPath);
    const assetsDir = path.join(dest, 'assets');
    if (fs.existsSync(assetsDir)) {
        await zipDirectoryToFile(assetsDir, cdnZipPath, 'assets');
    } else {
        await zipEmptyArchive(cdnZipPath);
    }
}

function zipWebWithoutAssets(dest: string, outZipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outZipPath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);

        for (const fileName of fs.readdirSync(dest)) {
            if (fileName === 'assets') {
                continue;
            }
            const filePath = path.join(dest, fileName);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                archive.directory(filePath, fileName);
            } else {
                archive.file(filePath, { name: fileName });
            }
        }

        archive.finalize();
    });
}

function zipEmptyArchive(outZipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outZipPath);
        const archive = archiver('zip', { zlib: { level: 6 } });
        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        archive.finalize();
    });
}
