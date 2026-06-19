/** MD5 元数据文件：须始终从本地上传，确保远程记录与本地一致 */
const MD5_RECORD_PATTERNS = [
    /^manifest\/[^/]+_version\.json$/,
    /^zips\/zips\.json$/,
];

export function isMd5RecordFile(relPath: string): boolean {
    return MD5_RECORD_PATTERNS.some((pattern) => pattern.test(relPath));
}
