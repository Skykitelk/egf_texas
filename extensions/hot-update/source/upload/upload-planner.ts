import { IUploadTask, UploadStrategy } from './upload-types';
import { isMd5RecordFile } from './md5-record-files';

/**
 * 以本地文件列表 + 本地 MD5 索引为基准，逐文件与远程 MD5 索引比对，决定传输策略。
 * 仅两种策略：本地上传 或 远程复制（无跳过）。
 */
export function planUploadTasks(options: {
    files: string[];
    targetVersion: string;
    localMd5Map: Map<string, string>;
    remoteActiveVersion: string | null;
    remoteMd5Map: Map<string, string>;
    toRelPath: (absPath: string) => string;
}): IUploadTask[] {
    const {
        files,
        targetVersion,
        localMd5Map,
        remoteActiveVersion,
        remoteMd5Map,
        toRelPath,
    } = options;

    const tasks: IUploadTask[] = [];
    const canRemoteCopy = !!remoteActiveVersion && remoteActiveVersion !== targetVersion;

    for (const absPath of files) {
        const relPath = toRelPath(absPath);
        const localMd5 = localMd5Map.get(relPath);
        if (!localMd5) {
            continue;
        }

        const remoteMd5 = remoteMd5Map.get(relPath);
        let strategy: UploadStrategy = 'local-upload';

        if (isMd5RecordFile(relPath)) {
            strategy = 'local-upload';
        } else if (canRemoteCopy && remoteMd5 === localMd5) {
            strategy = 'remote-copy';
        }

        tasks.push({
            relPath,
            localPath: absPath,
            localMd5,
            strategy,
            copyFromVersion: strategy === 'remote-copy' ? remoteActiveVersion! : undefined,
        });
    }

    return tasks;
}

export function summarizeTasks(tasks: IUploadTask[]) {
    let copy = 0;
    let upload = 0;
    let md5RecordUpload = 0;
    for (const task of tasks) {
        if (task.strategy === 'remote-copy') {
            copy += 1;
        } else {
            upload += 1;
            if (isMd5RecordFile(task.relPath)) {
                md5RecordUpload += 1;
            }
        }
    }
    return { copy, upload, md5RecordUpload, total: tasks.length };
}
