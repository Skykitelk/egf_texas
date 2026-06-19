"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLocalMd5Index = buildLocalMd5Index;
exports.buildMd5IndexFromVersionDir = buildMd5IndexFromVersionDir;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const md5_1 = require("../utils/md5");
const file_collector_1 = require("./file-collector");
function loadManifestAssets(manifestDir, out) {
    if (!fs_1.default.existsSync(manifestDir)) {
        return;
    }
    for (const name of fs_1.default.readdirSync(manifestDir)) {
        if (!name.endsWith('_version.json')) {
            continue;
        }
        const abs = path_1.default.join(manifestDir, name);
        try {
            const manifest = JSON.parse(fs_1.default.readFileSync(abs, 'utf-8'));
            if (!manifest.assets) {
                continue;
            }
            for (const [key, item] of Object.entries(manifest.assets)) {
                if (item === null || item === void 0 ? void 0 : item.md5) {
                    out.set(key, item.md5);
                }
            }
        }
        catch (_a) {
            // 忽略损坏 manifest，后续按文件 md5 兜底
        }
    }
}
function loadZipsJson(zipsJsonPath, out) {
    if (!fs_1.default.existsSync(zipsJsonPath)) {
        return;
    }
    try {
        const data = JSON.parse(fs_1.default.readFileSync(zipsJsonPath, 'utf-8'));
        for (const [zipName, md5] of Object.entries(data)) {
            if (typeof md5 === 'string' && md5) {
                out.set(`zips/${zipName}`, md5);
            }
        }
    }
    catch (_a) {
        // zips.json 无效时回退到文件 md5
    }
}
/** 优先使用 manifest / zips.json 中的 md5，对其余文件现场计算；以本地磁盘文件为全集 */
function buildLocalMd5Index(versionDir) {
    const md5Map = new Map();
    const manifestDir = path_1.default.join(versionDir, 'manifest');
    const zipsJsonPath = path_1.default.join(versionDir, 'zips', 'zips.json');
    // manifest assets 与 zips.json 中的 md5（用于资源文件比对）
    loadManifestAssets(manifestDir, md5Map);
    loadZipsJson(zipsJsonPath, md5Map);
    const files = (0, file_collector_1.collectVersionFiles)(versionDir);
    for (const absPath of files) {
        const rel = (0, file_collector_1.toRelPath)(versionDir, absPath);
        // 每个本地文件都写入 md5Map，manifest/zips.json 文件本身用实际文件 md5
        md5Map.set(rel, (0, md5_1.md5File)(absPath));
    }
    return { md5Map, files };
}
/** 从本地版本目录构建远程索引（manifest assets + zips.json + manifest 文件 md5） */
function buildMd5IndexFromVersionDir(versionDir) {
    return buildLocalMd5Index(versionDir).md5Map;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9jYWwtaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zb3VyY2UvdXBsb2FkL2xvY2FsLWluZGV4LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBc0RBLGdEQWlCQztBQUdELGtFQUVDO0FBNUVELDRDQUFvQjtBQUNwQixnREFBd0I7QUFFeEIsc0NBQXVDO0FBQ3ZDLHFEQUFrRTtBQVFsRSxTQUFTLGtCQUFrQixDQUFDLFdBQW1CLEVBQUUsR0FBd0I7SUFDckUsSUFBSSxDQUFDLFlBQUUsQ0FBQyxVQUFVLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztRQUM5QixPQUFPO0lBQ1gsQ0FBQztJQUNELEtBQUssTUFBTSxJQUFJLElBQUksWUFBRSxDQUFDLFdBQVcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO1FBQzdDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxFQUFFLENBQUM7WUFDbEMsU0FBUztRQUNiLENBQUM7UUFDRCxNQUFNLEdBQUcsR0FBRyxjQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUN6QyxJQUFJLENBQUM7WUFDRCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFlBQUUsQ0FBQyxZQUFZLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxDQUFxQixDQUFDO1lBQy9FLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ25CLFNBQVM7WUFDYixDQUFDO1lBQ0QsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7Z0JBQ3hELElBQUksSUFBSSxhQUFKLElBQUksdUJBQUosSUFBSSxDQUFFLEdBQUcsRUFBRSxDQUFDO29CQUNaLEdBQUcsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDM0IsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO1FBQUMsV0FBTSxDQUFDO1lBQ0wsNkJBQTZCO1FBQ2pDLENBQUM7SUFDTCxDQUFDO0FBQ0wsQ0FBQztBQUVELFNBQVMsWUFBWSxDQUFDLFlBQW9CLEVBQUUsR0FBd0I7SUFDaEUsSUFBSSxDQUFDLFlBQUUsQ0FBQyxVQUFVLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztRQUMvQixPQUFPO0lBQ1gsQ0FBQztJQUNELElBQUksQ0FBQztRQUNELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsWUFBRSxDQUFDLFlBQVksQ0FBQyxZQUFZLEVBQUUsT0FBTyxDQUFDLENBQTJCLENBQUM7UUFDMUYsS0FBSyxNQUFNLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxJQUFJLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNoRCxJQUFJLE9BQU8sR0FBRyxLQUFLLFFBQVEsSUFBSSxHQUFHLEVBQUUsQ0FBQztnQkFDakMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxRQUFRLE9BQU8sRUFBRSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQ3BDLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUFDLFdBQU0sQ0FBQztRQUNMLHlCQUF5QjtJQUM3QixDQUFDO0FBQ0wsQ0FBQztBQUVELDREQUE0RDtBQUM1RCxTQUFnQixrQkFBa0IsQ0FBQyxVQUFrQjtJQUNqRCxNQUFNLE1BQU0sR0FBRyxJQUFJLEdBQUcsRUFBa0IsQ0FBQztJQUN6QyxNQUFNLFdBQVcsR0FBRyxjQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxVQUFVLENBQUMsQ0FBQztJQUN0RCxNQUFNLFlBQVksR0FBRyxjQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUM7SUFFaEUsK0NBQStDO0lBQy9DLGtCQUFrQixDQUFDLFdBQVcsRUFBRSxNQUFNLENBQUMsQ0FBQztJQUN4QyxZQUFZLENBQUMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBRW5DLE1BQU0sS0FBSyxHQUFHLElBQUEsb0NBQW1CLEVBQUMsVUFBVSxDQUFDLENBQUM7SUFDOUMsS0FBSyxNQUFNLE9BQU8sSUFBSSxLQUFLLEVBQUUsQ0FBQztRQUMxQixNQUFNLEdBQUcsR0FBRyxJQUFBLDBCQUFTLEVBQUMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQzNDLG9EQUFvRDtRQUNwRCxNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxJQUFBLGFBQU8sRUFBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO0lBQ3RDLENBQUM7SUFFRCxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxDQUFDO0FBQzdCLENBQUM7QUFFRCxtRUFBbUU7QUFDbkUsU0FBZ0IsMkJBQTJCLENBQUMsVUFBa0I7SUFDMUQsT0FBTyxrQkFBa0IsQ0FBQyxVQUFVLENBQUMsQ0FBQyxNQUFNLENBQUM7QUFDakQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IElQcm9qZWN0TWFuaWZlc3QgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBtZDVGaWxlIH0gZnJvbSAnLi4vdXRpbHMvbWQ1JztcbmltcG9ydCB7IGNvbGxlY3RWZXJzaW9uRmlsZXMsIHRvUmVsUGF0aCB9IGZyb20gJy4vZmlsZS1jb2xsZWN0b3InO1xuXG5leHBvcnQgaW50ZXJmYWNlIElMb2NhbE1kNUluZGV4IHtcbiAgICAvKiogcmVsUGF0aCDihpIgbWQ1ICovXG4gICAgbWQ1TWFwOiBNYXA8c3RyaW5nLCBzdHJpbmc+O1xuICAgIGZpbGVzOiBzdHJpbmdbXTtcbn1cblxuZnVuY3Rpb24gbG9hZE1hbmlmZXN0QXNzZXRzKG1hbmlmZXN0RGlyOiBzdHJpbmcsIG91dDogTWFwPHN0cmluZywgc3RyaW5nPikge1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhtYW5pZmVzdERpcikpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgZnMucmVhZGRpclN5bmMobWFuaWZlc3REaXIpKSB7XG4gICAgICAgIGlmICghbmFtZS5lbmRzV2l0aCgnX3ZlcnNpb24uanNvbicpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBhYnMgPSBwYXRoLmpvaW4obWFuaWZlc3REaXIsIG5hbWUpO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgbWFuaWZlc3QgPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyhhYnMsICd1dGYtOCcpKSBhcyBJUHJvamVjdE1hbmlmZXN0O1xuICAgICAgICAgICAgaWYgKCFtYW5pZmVzdC5hc3NldHMpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGZvciAoY29uc3QgW2tleSwgaXRlbV0gb2YgT2JqZWN0LmVudHJpZXMobWFuaWZlc3QuYXNzZXRzKSkge1xuICAgICAgICAgICAgICAgIGlmIChpdGVtPy5tZDUpIHtcbiAgICAgICAgICAgICAgICAgICAgb3V0LnNldChrZXksIGl0ZW0ubWQ1KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgLy8g5b+955Wl5o2f5Z2PIG1hbmlmZXN077yM5ZCO57ut5oyJ5paH5Lu2IG1kNSDlhZzlupVcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gbG9hZFppcHNKc29uKHppcHNKc29uUGF0aDogc3RyaW5nLCBvdXQ6IE1hcDxzdHJpbmcsIHN0cmluZz4pIHtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMoemlwc0pzb25QYXRoKSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyh6aXBzSnNvblBhdGgsICd1dGYtOCcpKSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAgICAgICBmb3IgKGNvbnN0IFt6aXBOYW1lLCBtZDVdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEpKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIG1kNSA9PT0gJ3N0cmluZycgJiYgbWQ1KSB7XG4gICAgICAgICAgICAgICAgb3V0LnNldChgemlwcy8ke3ppcE5hbWV9YCwgbWQ1KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyB6aXBzLmpzb24g5peg5pWI5pe25Zue6YCA5Yiw5paH5Lu2IG1kNVxuICAgIH1cbn1cblxuLyoqIOS8mOWFiOS9v+eUqCBtYW5pZmVzdCAvIHppcHMuanNvbiDkuK3nmoQgbWQ177yM5a+55YW25L2Z5paH5Lu2546w5Zy66K6h566X77yb5Lul5pys5Zyw56OB55uY5paH5Lu25Li65YWo6ZuGICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRMb2NhbE1kNUluZGV4KHZlcnNpb25EaXI6IHN0cmluZyk6IElMb2NhbE1kNUluZGV4IHtcbiAgICBjb25zdCBtZDVNYXAgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICAgIGNvbnN0IG1hbmlmZXN0RGlyID0gcGF0aC5qb2luKHZlcnNpb25EaXIsICdtYW5pZmVzdCcpO1xuICAgIGNvbnN0IHppcHNKc29uUGF0aCA9IHBhdGguam9pbih2ZXJzaW9uRGlyLCAnemlwcycsICd6aXBzLmpzb24nKTtcblxuICAgIC8vIG1hbmlmZXN0IGFzc2V0cyDkuI4gemlwcy5qc29uIOS4reeahCBtZDXvvIjnlKjkuo7otYTmupDmlofku7bmr5Tlr7nvvIlcbiAgICBsb2FkTWFuaWZlc3RBc3NldHMobWFuaWZlc3REaXIsIG1kNU1hcCk7XG4gICAgbG9hZFppcHNKc29uKHppcHNKc29uUGF0aCwgbWQ1TWFwKTtcblxuICAgIGNvbnN0IGZpbGVzID0gY29sbGVjdFZlcnNpb25GaWxlcyh2ZXJzaW9uRGlyKTtcbiAgICBmb3IgKGNvbnN0IGFic1BhdGggb2YgZmlsZXMpIHtcbiAgICAgICAgY29uc3QgcmVsID0gdG9SZWxQYXRoKHZlcnNpb25EaXIsIGFic1BhdGgpO1xuICAgICAgICAvLyDmr4/kuKrmnKzlnLDmlofku7bpg73lhpnlhaUgbWQ1TWFw77yMbWFuaWZlc3Qvemlwcy5qc29uIOaWh+S7tuacrOi6q+eUqOWunumZheaWh+S7tiBtZDVcbiAgICAgICAgbWQ1TWFwLnNldChyZWwsIG1kNUZpbGUoYWJzUGF0aCkpO1xuICAgIH1cblxuICAgIHJldHVybiB7IG1kNU1hcCwgZmlsZXMgfTtcbn1cblxuLyoqIOS7juacrOWcsOeJiOacrOebruW9leaehOW7uui/nOeoi+e0ouW8le+8iG1hbmlmZXN0IGFzc2V0cyArIHppcHMuanNvbiArIG1hbmlmZXN0IOaWh+S7tiBtZDXvvIkgKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZE1kNUluZGV4RnJvbVZlcnNpb25EaXIodmVyc2lvbkRpcjogc3RyaW5nKTogTWFwPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIGJ1aWxkTG9jYWxNZDVJbmRleCh2ZXJzaW9uRGlyKS5tZDVNYXA7XG59XG4iXX0=