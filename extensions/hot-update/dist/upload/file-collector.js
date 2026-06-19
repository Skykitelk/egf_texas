"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectVersionFiles = collectVersionFiles;
exports.toRelPath = toRelPath;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("../utils/paths");
function collectVersionFiles(versionDir) {
    const files = [];
    function walk(dir) {
        for (const name of fs_1.default.readdirSync(dir)) {
            const abs = path_1.default.join(dir, name);
            if (fs_1.default.statSync(abs).isDirectory()) {
                walk(abs);
            }
            else {
                files.push(abs);
            }
        }
    }
    walk(versionDir);
    return files;
}
function toRelPath(versionDir, absPath) {
    return (0, paths_1.toPosixPath)(path_1.default.relative(versionDir, absPath));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmlsZS1jb2xsZWN0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdXBsb2FkL2ZpbGUtY29sbGVjdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBSUEsa0RBZ0JDO0FBRUQsOEJBRUM7QUF4QkQsNENBQW9CO0FBQ3BCLGdEQUF3QjtBQUN4QiwwQ0FBNkM7QUFFN0MsU0FBZ0IsbUJBQW1CLENBQUMsVUFBa0I7SUFDbEQsTUFBTSxLQUFLLEdBQWEsRUFBRSxDQUFDO0lBRTNCLFNBQVMsSUFBSSxDQUFDLEdBQVc7UUFDckIsS0FBSyxNQUFNLElBQUksSUFBSSxZQUFFLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDckMsTUFBTSxHQUFHLEdBQUcsY0FBSSxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDakMsSUFBSSxZQUFFLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7Z0JBQ2pDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUNkLENBQUM7aUJBQU0sQ0FBQztnQkFDSixLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3BCLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUVELElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUNqQixPQUFPLEtBQUssQ0FBQztBQUNqQixDQUFDO0FBRUQsU0FBZ0IsU0FBUyxDQUFDLFVBQWtCLEVBQUUsT0FBZTtJQUN6RCxPQUFPLElBQUEsbUJBQVcsRUFBQyxjQUFJLENBQUMsUUFBUSxDQUFDLFVBQVUsRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQzNELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyB0b1Bvc2l4UGF0aCB9IGZyb20gJy4uL3V0aWxzL3BhdGhzJztcblxuZXhwb3J0IGZ1bmN0aW9uIGNvbGxlY3RWZXJzaW9uRmlsZXModmVyc2lvbkRpcjogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGZpbGVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZnVuY3Rpb24gd2FsayhkaXI6IHN0cmluZykge1xuICAgICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgZnMucmVhZGRpclN5bmMoZGlyKSkge1xuICAgICAgICAgICAgY29uc3QgYWJzID0gcGF0aC5qb2luKGRpciwgbmFtZSk7XG4gICAgICAgICAgICBpZiAoZnMuc3RhdFN5bmMoYWJzKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgICAgICAgd2FsayhhYnMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBmaWxlcy5wdXNoKGFicyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB3YWxrKHZlcnNpb25EaXIpO1xuICAgIHJldHVybiBmaWxlcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRvUmVsUGF0aCh2ZXJzaW9uRGlyOiBzdHJpbmcsIGFic1BhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRvUG9zaXhQYXRoKHBhdGgucmVsYXRpdmUodmVyc2lvbkRpciwgYWJzUGF0aCkpO1xufVxuIl19