"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.zipDirectoryToFile = zipDirectoryToFile;
exports.removeDir = removeDir;
exports.zipPublishSplit = zipPublishSplit;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const archiver_1 = __importDefault(require("archiver"));
/** 流式压缩目录到 zip 文件，避免整包载入内存 */
function zipDirectoryToFile(sourceDir, outZipPath, prefixInZip = '') {
    return new Promise((resolve, reject) => {
        const output = fs_1.default.createWriteStream(outZipPath);
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 6 } });
        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(sourceDir, prefixInZip || false);
        archive.finalize();
    });
}
/** 递归删除目录 */
function removeDir(dirPath) {
    if (fs_1.default.existsSync(dirPath)) {
        fs_1.default.rmSync(dirPath, { recursive: true, force: true });
    }
}
/** 生成 web.zip（不含 assets 目录）与 cdn.zip（仅 assets） */
function zipPublishSplit(dest, webZipPath, cdnZipPath) {
    return __awaiter(this, void 0, void 0, function* () {
        yield zipWebWithoutAssets(dest, webZipPath);
        const assetsDir = path_1.default.join(dest, 'assets');
        if (fs_1.default.existsSync(assetsDir)) {
            yield zipDirectoryToFile(assetsDir, cdnZipPath, 'assets');
        }
        else {
            yield zipEmptyArchive(cdnZipPath);
        }
    });
}
function zipWebWithoutAssets(dest, outZipPath) {
    return new Promise((resolve, reject) => {
        const output = fs_1.default.createWriteStream(outZipPath);
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 6 } });
        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        for (const fileName of fs_1.default.readdirSync(dest)) {
            if (fileName === 'assets') {
                continue;
            }
            const filePath = path_1.default.join(dest, fileName);
            const stat = fs_1.default.statSync(filePath);
            if (stat.isDirectory()) {
                archive.directory(filePath, fileName);
            }
            else {
                archive.file(filePath, { name: fileName });
            }
        }
        archive.finalize();
    });
}
function zipEmptyArchive(outZipPath) {
    return new Promise((resolve, reject) => {
        const output = fs_1.default.createWriteStream(outZipPath);
        const archive = (0, archiver_1.default)('zip', { zlib: { level: 6 } });
        output.on('close', () => resolve());
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        archive.finalize();
    });
}
