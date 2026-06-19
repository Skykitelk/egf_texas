import fs from 'fs';
import path from 'path';
import fse from 'fs-extra';
import archiver from 'archiver';
import { INCREMENTAL_ONLY_BUNDLES, IProjectManifest, ProgressReporter } from './types';
import { resolveBuildDataRoot, toPosixPath } from './utils/paths';
import { md5File } from './utils/md5';

interface IFileEntry {
    key: string;
    absPath: string;
    size: number;
    md5: string;
}

interface IBundleTask {
    bundleName: string;
    entries: IFileEntry[];
    generateZip: boolean;
}

function createEntry(absPath: string, key: string): IFileEntry {
    const stat = fs.statSync(absPath);
    return {
        key: toPosixPath(key),
        absPath,
        size: stat.size,
        md5: md5File(absPath),
    };
}

function collectFilesInDir(dir: string, keyPrefix: string): IFileEntry[] {
    if (!fs.existsSync(dir)) {
        return [];
    }
    const entries: IFileEntry[] = [];
    const prefix = keyPrefix.endsWith('/') ? keyPrefix : `${keyPrefix}/`;

    function walk(current: string, rel: string) {
        for (const name of fs.readdirSync(current)) {
            const relPath = rel ? `${rel}/${name}` : name;
            const abs = path.join(current, name);
            const stat = fs.statSync(abs);
            if (stat.isDirectory()) {
                walk(abs, relPath);
            } else if (stat.isFile()) {
                entries.push(createEntry(abs, `${prefix}${toPosixPath(relPath)}`));
            }
        }
    }

    walk(dir, '');
    return entries;
}

function collectEngineFiles(dataRoot: string): IFileEntry[] {
    const entries: IFileEntry[] = [];

    function walk(current: string, rel: string) {
        for (const name of fs.readdirSync(current)) {
            if (!rel && name === 'assets') {
                continue;
            }
            const relPath = rel ? `${rel}/${name}` : name;
            const abs = path.join(current, name);
            const stat = fs.statSync(abs);
            if (stat.isDirectory()) {
                walk(abs, relPath);
            } else if (stat.isFile()) {
                entries.push(createEntry(abs, toPosixPath(relPath)));
            }
        }
    }

    walk(dataRoot, '');
    return entries;
}

function detectCustomBundles(assetsDir: string): string[] {
    if (!fs.existsSync(assetsDir)) {
        return [];
    }
    return fs.readdirSync(assetsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !INCREMENTAL_ONLY_BUNDLES.has(d.name))
        .map((d) => d.name);
}

function buildManifest(entries: IFileEntry[], version: string): IProjectManifest {
    const assets: IProjectManifest['assets'] = {};
    for (const entry of entries) {
        assets[entry.key] = {
            size: entry.size,
            md5: entry.md5,
            compressed: false,
        };
    }
    return { version, assets, searchPaths: [] };
}

async function copyEntry(entry: IFileEntry, versionDir: string): Promise<void> {
    const dest = path.join(versionDir, entry.key);
    await fse.ensureDir(path.dirname(dest));
    await fse.copy(entry.absPath, dest);
}

async function writeManifest(manifest: IProjectManifest, versionDir: string, manifestRelPath: string): Promise<void> {
    const dest = path.join(versionDir, manifestRelPath);
    await fse.ensureDir(path.dirname(dest));
    await fse.writeJson(dest, manifest, { spaces: 2 });
}

async function createBundleZip(bundleDir: string, zipDestPath: string): Promise<void> {
    await fse.ensureDir(path.dirname(zipDestPath));
    await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipDestPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.directory(bundleDir, false);
        archive.finalize();
    });
}

function resolveBundleTasks(dataRoot: string): IBundleTask[] {
    const assetsDir = path.join(dataRoot, 'assets');
    const tasks: IBundleTask[] = [];

    const engineEntries = collectEngineFiles(dataRoot);
    if (engineEntries.length > 0) {
        tasks.push({ bundleName: 'engine', entries: engineEntries, generateZip: false });
    }

    for (const bundleName of INCREMENTAL_ONLY_BUNDLES) {
        const entries = collectFilesInDir(path.join(assetsDir, bundleName), `assets/${bundleName}`);
        if (entries.length > 0) {
            tasks.push({ bundleName, entries, generateZip: false });
        }
    }

    for (const bundleName of detectCustomBundles(assetsDir)) {
        const entries = collectFilesInDir(path.join(assetsDir, bundleName), `assets/${bundleName}`);
        if (entries.length > 0) {
            tasks.push({ bundleName, entries, generateZip: true });
        }
    }

    if (tasks.length === 0) {
        throw new Error(`未找到可打包的热更新资源，请检查构建产物：${dataRoot}`);
    }

    return tasks;
}

export interface IGenerateRemoteOptions {
    versionOutputDir: string;
    buildAndroidPath: string;
    version: string;
}

export interface IGenerateRemoteResult {
    version: string;
    outputDir: string;
    bundles: string[];
    fileCount: number;
}

export async function generateRemoteVersion(
    options: IGenerateRemoteOptions,
    onProgress?: ProgressReporter,
): Promise<IGenerateRemoteResult> {
    const { versionOutputDir, buildAndroidPath, version } = options;
    const dataRoot = resolveBuildDataRoot(buildAndroidPath);

    if (!fs.existsSync(dataRoot)) {
        throw new Error(`构建产物目录不存在：${dataRoot}`);
    }

    const versionDir = path.join(versionOutputDir, version);
    await fse.ensureDir(versionOutputDir);
    await fse.emptyDir(versionDir);

    onProgress?.(0, '扫描 Bundle...');
    const tasks = resolveBundleTasks(dataRoot);
    const totalSteps = tasks.reduce((sum, t) => sum + t.entries.length + (t.generateZip ? 2 : 1), 0);
    let doneSteps = 0;

    const tick = (message: string) => {
        doneSteps += 1;
        onProgress?.(Math.min(99, Math.round((doneSteps / totalSteps) * 100)), message);
    };

    let fileCount = 0;
    const zipsMeta: Record<string, string> = {};

    for (const task of tasks) {
        for (const entry of task.entries) {
            await copyEntry(entry, versionDir);
            fileCount += 1;
            tick(`复制 ${task.bundleName}: ${entry.key}`);
        }

        const manifestRel = path.posix.join('manifest', `${task.bundleName}_version.json`);
        const manifest = buildManifest(task.entries, version);
        await writeManifest(manifest, versionDir, manifestRel);
        tick(`生成 manifest/${task.bundleName}_version.json`);

        if (task.generateZip) {
            const bundleDir = path.join(dataRoot, 'assets', task.bundleName);
            const zipRel = path.posix.join('zips', `${task.bundleName}.zip`);
            const zipAbs = path.join(versionDir, zipRel);
            await createBundleZip(bundleDir, zipAbs);
            zipsMeta[`${task.bundleName}.zip`] = md5File(zipAbs);
            tick(`生成 zips/${task.bundleName}.zip`);
        }
    }

    if (Object.keys(zipsMeta).length > 0) {
        const zipsJsonPath = path.join(versionDir, 'zips', 'zips.json');
        await fse.ensureDir(path.dirname(zipsJsonPath));
        await fse.writeJson(zipsJsonPath, zipsMeta, { spaces: 2 });
        tick('生成 zips/zips.json');
    }

    onProgress?.(100, '远程版本生成完成');
    return {
        version,
        outputDir: versionDir,
        bundles: tasks.map((t) => t.bundleName),
        fileCount,
    };
}
