import crypto from 'crypto';
import fs from 'fs';

export function md5File(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
}

export function md5Buffer(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
}
