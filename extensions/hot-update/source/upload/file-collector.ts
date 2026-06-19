import fs from 'fs';
import path from 'path';
import { toPosixPath } from '../utils/paths';

export function collectVersionFiles(versionDir: string): string[] {
    const files: string[] = [];

    function walk(dir: string) {
        for (const name of fs.readdirSync(dir)) {
            const abs = path.join(dir, name);
            if (fs.statSync(abs).isDirectory()) {
                walk(abs);
            } else {
                files.push(abs);
            }
        }
    }

    walk(versionDir);
    return files;
}

export function toRelPath(versionDir: string, absPath: string): string {
    return toPosixPath(path.relative(versionDir, absPath));
}
