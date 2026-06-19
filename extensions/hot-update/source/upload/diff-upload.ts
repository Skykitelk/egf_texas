import path from 'path';
import {
    DEFAULT_UPLOAD_CONCURRENCY,
    DEFAULT_UPLOAD_MAX_RETRIES,
    IDiffUploadOptions,
    IRemoteStorageProvider,
    IUploadStats,
    IUploadTask,
} from './upload-types';
import { buildLocalMd5Index } from './local-index';
import { planUploadTasks, summarizeTasks } from './upload-planner';
import { toRelPath } from './file-collector';
import { runConcurrent, withRetry } from './concurrent-pool';

export async function executeDiffUpload(
    provider: IRemoteStorageProvider,
    localVersionDir: string,
    options: Pick<IDiffUploadOptions, 'onProgress' | 'concurrency' | 'copyConcurrency' | 'maxRetries'> = {},
): Promise<IUploadStats> {
    const onProgress = options.onProgress;
    const concurrency = options.concurrency ?? DEFAULT_UPLOAD_CONCURRENCY;
    const copyConcurrency = options.copyConcurrency ?? Math.min(4, concurrency);
    const maxRetries = options.maxRetries ?? DEFAULT_UPLOAD_MAX_RETRIES;
    const targetVersion = path.basename(localVersionDir);

    // 1. 构建本地 MD5 索引（基准）
    onProgress?.(0, '构建本地 MD5 索引...');
    const { md5Map: localMd5Map, files } = buildLocalMd5Index(localVersionDir);
    if (files.length === 0) {
        throw new Error('版本目录为空，无法上传');
    }

    // 2. 拉取远程 MD5 索引（用于与本地逐文件比对）
    onProgress?.(2, '读取远程 version.json...');
    let remoteActiveVersion: string | null = null;
    let remoteMd5Map = new Map<string, string>();

    try {
        const versionJson = await provider.fetchVersionJson();
        if (versionJson?.version) {
            remoteActiveVersion = versionJson.version;
            onProgress?.(5, `远程当前版本：${remoteActiveVersion}，拉取远程 MD5 索引...`);
            try {
                remoteMd5Map = await provider.fetchRemoteMd5Index(remoteActiveVersion);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                onProgress?.(5, `远程 MD5 索引获取失败，未命中文件将本地上传：${msg}`);
                remoteMd5Map = new Map();
            }
        } else {
            onProgress?.(5, '远程无 version.json，全部文件将本地上传');
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        onProgress?.(5, `读取远程 version.json 失败，全部文件将本地上传：${msg}`);
    }

    // 3. 以本地文件 + 本地 MD5 为基准，逐文件比对远程 MD5，生成传输计划
    const tasks = planUploadTasks({
        files,
        targetVersion,
        localMd5Map,
        remoteActiveVersion,
        remoteMd5Map,
        toRelPath: (abs) => toRelPath(localVersionDir, abs),
    });

    const summary = summarizeTasks(tasks);
    onProgress?.(
        8,
        `计划（本地基准）：远程复制 ${summary.copy}，本地上传 ${summary.upload}（含 MD5 记录 ${summary.md5RecordUpload}），共 ${summary.total}`,
    );

    await provider.ensureVersionDir(targetVersion);

    const stats: IUploadStats = {
        total: tasks.length,
        copied: 0,
        uploaded: 0,
        copyFallback: 0,
        failed: 0,
    };

    const copyTasks = tasks.filter((t) => t.strategy === 'remote-copy');
    const uploadTasks = tasks.filter((t) => t.strategy === 'local-upload');

    let finished = 0;

    const report = (message: string) => {
        const percent = stats.total > 0 ? Math.min(98, Math.round((finished / stats.total) * 100)) : 98;
        onProgress?.(percent, message);
    };

    // 4. 执行远程复制（失败回退本地上传）
    const fallbackUploads: IUploadTask[] = [];

    await runConcurrent(copyTasks, async (task) => {
        report(`正在远程复制：${task.relPath}`);
        try {
            await withRetry(
                () => provider.remoteCopy(task.copyFromVersion!, task.relPath, targetVersion),
                maxRetries,
            );
            stats.copied += 1;
        } catch (err) {
            stats.copyFallback += 1;
            fallbackUploads.push({ ...task, strategy: 'local-upload' });
            const msg = err instanceof Error ? err.message : String(err);
            report(`远程复制失败，回退本地上传：${task.relPath} (${msg})`);
        } finally {
            finished += 1;
            report(`远程复制 (${stats.copied}/${copyTasks.length})：${task.relPath}`);
        }
    }, copyConcurrency);

    // 5. 执行本地上传（含 MD5 记录文件、变更文件、复制回退文件）
    const allUploadTasks = [...uploadTasks, ...fallbackUploads];
    const uploadErrors: string[] = [];

    await runConcurrent(allUploadTasks, async (task) => {
        report(`正在本地上传：${task.relPath}`);
        try {
            await withRetry(
                () => provider.localUpload(task.localPath, task.relPath, targetVersion),
                maxRetries,
            );
            stats.uploaded += 1;
        } catch (err) {
            stats.failed += 1;
            const msg = err instanceof Error ? err.message : String(err);
            uploadErrors.push(`${task.relPath}: ${msg}`);
            report(`上传失败：${task.relPath} (${msg})`);
        } finally {
            finished += 1;
            report(`本地上传 (${stats.uploaded}/${allUploadTasks.length})：${task.relPath}`);
        }
    }, concurrency);

    if (uploadErrors.length > 0) {
        throw new Error(
            `上传未完成，未更新 version.json：${uploadErrors.length} 个文件失败（成功复制 ${stats.copied}，上传 ${stats.uploaded}）\n${uploadErrors.slice(0, 5).join('\n')}`,
        );
    }

    // 6. 全部成功后，最后刷新远程 version.json
    onProgress?.(99, `全部文件处理成功，刷新远程 version.json → ${targetVersion}`);
    await withRetry(() => provider.writeVersionJson(targetVersion), maxRetries);

    onProgress?.(
        100,
        `完成：复制 ${stats.copied}，上传 ${stats.uploaded}，复制回退 ${stats.copyFallback}`,
    );

    return stats;
}
