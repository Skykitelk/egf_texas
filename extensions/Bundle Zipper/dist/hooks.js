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
exports.unload = exports.onAfterBuild = exports.onAfterCompressSettings = exports.onBeforeCompressSettings = exports.onAfterBuildAssets = exports.onBeforeBuildAssets = exports.onBeforeBuild = exports.load = exports.throwError = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const jszip_1 = __importDefault(require("jszip"));
const crypto_1 = __importDefault(require("crypto"));
const PACKAGE_NAME = 'h5_bundle_zipper';
function log(...arg) {
    return console.log(`[${PACKAGE_NAME}] `, ...arg);
}
exports.throwError = true;
function load() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`[${PACKAGE_NAME}] Load in builder.`);
    });
}
exports.load = load;
function onBeforeBuild(options) {
    return __awaiter(this, void 0, void 0, function* () {
        //log(`${PACKAGE_NAME}`, 'onBeforeBuild', options);
    });
}
exports.onBeforeBuild = onBeforeBuild;
function onBeforeBuildAssets(options) {
    return __awaiter(this, void 0, void 0, function* () {
        //log(`${PACKAGE_NAME}`, 'onBeforeBuildAssets');
    });
}
exports.onBeforeBuildAssets = onBeforeBuildAssets;
function onAfterBuildAssets(options) {
    return __awaiter(this, void 0, void 0, function* () {
        //log(`${PACKAGE_NAME}`, 'onAfterBuildAssets');
    });
}
exports.onAfterBuildAssets = onAfterBuildAssets;
function onBeforeCompressSettings(options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        const pkgOptions = options.packages[PACKAGE_NAME];
        console.log(PACKAGE_NAME, 'onBeforeCompressSettings', pkgOptions);
    });
}
exports.onBeforeCompressSettings = onBeforeCompressSettings;
var settings;
var bundleVers;
function onAfterCompressSettings(options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(PACKAGE_NAME, 'onAfterCompressSettings');
        if (result.settings) {
            settings = result.settings;
        }
        else {
            const settingsString = fs_1.default.readFileSync(result.paths.settings).toString();
            settings = JSON.parse(settingsString);
        }
        log(`${PACKAGE_NAME}`, 'onAfterCompressSettings', settings);
        log(`${PACKAGE_NAME}`, 'onAfterCompressSettings', settings['assets']);
        bundleVers = settings.bundleVers || settings['assets'].bundleVers;
    });
}
exports.onAfterCompressSettings = onAfterCompressSettings;
/**
 * 循环遍历压缩文件夹到jszip中
 * @param jszip
 * @param nowPath
 * @param deleteAfterZip
 */
function loopZipDir(jszip, nowPath, deleteAfterZip = false) {
    const files = fs_1.default.readdirSync(nowPath);
    files.forEach((fileName, index) => {
        const filePath = path_1.default.join(nowPath, fileName);
        const fileStat = fs_1.default.statSync(filePath);
        if (fileStat.isDirectory()) {
            loopZipDir(jszip.folder(fileName), filePath, deleteAfterZip); //重新检索目录文件
            if (deleteAfterZip) {
                fs_1.default.rmdirSync(filePath);
            }
        }
        else {
            jszip.file(fileName, fs_1.default.readFileSync(filePath)); //压缩目录添加文件
            if (deleteAfterZip) {
                fs_1.default.unlinkSync(filePath);
            }
        }
    });
}
/**
 * 压缩Bundle
 * @param rootPath
 * @param bundle
 * @param ver
 * @param deleteAfterZip
 * @returns
 */
function zipBundle(rootPath, bundle, ver, deleteAfterZip) {
    return __awaiter(this, void 0, void 0, function* () {
        const bundleZip = new jszip_1.default();
        // 初始Bundle不删除
        if (bundle === 'main' || bundle === 'internal' || bundle === 'resources') {
            deleteAfterZip = false;
        }
        loopZipDir(bundleZip.folder(bundle), path_1.default.join(rootPath, bundle), deleteAfterZip);
        if (deleteAfterZip) {
            fs_1.default.rmdirSync(path_1.default.join(rootPath, bundle));
        }
        return new Promise((resolve, reject) => {
            const outPath = path_1.default.join(rootPath, bundle + '.' + ver + '.zip');
            const outStream = fs_1.default.createWriteStream(outPath);
            bundleZip.generateNodeStream({ streamFiles: true })
                .pipe(outStream)
                .on('finish', () => {
                console.info('生成压缩Bundle', bundle + '.' + ver + '.zip');
                resolve();
            })
                .on('error', (err) => {
                reject(err);
            });
        });
    });
}
/**
 * 压缩所有Bundle
 * @param rootPath
 * @param deleteAfterZip
 * @returns
 */
function zipAllBundles(rootPath, deleteAfterZip) {
    return __awaiter(this, void 0, void 0, function* () {
        for (const bundle in bundleVers) {
            yield zipBundle(rootPath, bundle, bundleVers[bundle], deleteAfterZip);
        }
    });
}
function easymd5(content) {
    const hash = crypto_1.default.createHash('md5');
    const md5 = hash.update(content).digest('hex');
    return md5.substring(0, 6).toLowerCase();
}
function onAfterBuild(options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        const pkgOptions = options.packages[PACKAGE_NAME];
        if (pkgOptions.disableExtension) {
            return;
        }
        console.log(PACKAGE_NAME, 'onAfterBuild', result.paths);
        // copy image files
        fs_1.default.mkdirSync(path_1.default.join(result.dest, 'img/'));
        const paths = fs_1.default.readdirSync(path_1.default.join(__dirname, '../files/img/'));
        for (let v of paths) {
            fs_1.default.copyFileSync(path_1.default.join(__dirname, '../files/img/' + v), path_1.default.join(result.dest, 'img/' + v));
        }
        // copy lib files
        fs_1.default.mkdirSync(path_1.default.join(result.dest, 'lib/'));
        fs_1.default.copyFileSync(path_1.default.join(__dirname, '../files/lib/sww.js'), path_1.default.join(result.dest, 'lib/sww.js'));
        fs_1.default.copyFileSync(path_1.default.join(__dirname, '../files/lib/jszip.min.js'), path_1.default.join(result.dest, 'lib/jszip.min.js'));
        // make webmanifest
        const webmanifest = {
            "name": pkgOptions.appName,
            "short_name": pkgOptions.appShortName,
            "display": "fullscreen",
            "scope": pkgOptions.visitRoute,
            "start_url": pkgOptions.visitRoute + "index.html",
            "theme_color": "#313131",
            "background_color": "#313131",
            "icons": [
                {
                    "src": "img/icon144.png",
                    "sizes": "144x144",
                    "type": "image/png"
                }
            ]
        };
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'manifest.webmanifest'), JSON.stringify(webmanifest));
        // 处理html
        let indexHtml = fs_1.default.readFileSync(path_1.default.join(result.dest, 'index.html')).toString();
        // head
        indexHtml = indexHtml.replace(/<title.*title>/, '<title>' + pkgOptions.appName + '</title>\n\
  <meta HTTP-EQUIV="pragma" CONTENT="no-cache">\n\
  <meta HTTP-EQUIV="Cache-Control" CONTENT="no-cache, no-store, must-revalidate">\n\
  <meta http-equiv="Cache" content="no-cache">\n\
  <meta HTTP-EQUIV="expires" CONTENT="0">\n\
  <meta name="apple-touch-fullscreen" content="yes"/>\n\
  <link rel="apple-touch-icon" sizes="57x57" href="img/icon57.png"/>\n\
  <link rel="apple-touch-icon" sizes="72x72" href="img/icon72.png"/>\n\
  <link rel="apple-touch-icon" sizes="114x114" href="img/icon114.png"/>\n\
  <link rel="apple-touch-icon" sizes="144x144" href="img/icon144.png"/>\n\
  <link href="img/page-icon.png" rel="shortcut icon"/>\n\
  <link rel="manifest" href="manifest.webmanifest">');
        // progressbar
        // const progressBar = '<div id="splash" style="position: absolute;top: 0;left: 0;width: 100%;height: 100%;">\n  <div class="progress-bar stripes"><span style="width: 0%"></span>\n  </div>\n</div>\n';
        // sw register
        const initBundles = pkgOptions.initBundles.split(',');
        var swregister = fs_1.default.readFileSync(path_1.default.join(__dirname, '../files/lib/sw_register.js')).toString();
        const bodyStart = indexHtml.indexOf('<body>');
        // 脚本开始位置
        const scriptStart = indexHtml.indexOf('<!-- ', bodyStart);
        // 脚本结束位置
        const scriptEnd = indexHtml.lastIndexOf('</body>') - 1;
        // 脚本部分代码
        const scriptHtml = indexHtml.substring(scriptStart, scriptEnd);
        // 启动脚本
        const srcJSFiles = scriptHtml.match(/src="src[^ ]+\.js"/g);
        const srcJSONFiles = scriptHtml.match(/src="src[^ ]+\.json"/g);
        const srcImportFiles = scriptHtml.match(/System\.import.*/g);
        let jsArray = '[';
        for (const v of srcJSFiles) {
            const jsFileName = v.substring('src="'.length, v.length - 1);
            if (jsArray.length > 1) {
                jsArray += ',';
            }
            jsArray += '"' + jsFileName + '"';
        }
        jsArray += ']';
        let configjs = '<script type="text/javascript">\n\
var initBundles = ' + JSON.stringify(initBundles) + ';\n\
window.initBundles = initBundles;\n\
var allBundles = ' + JSON.stringify(bundleVers) + ';\n\
window.allBundles = allBundles;\n\
var swPath = "' + pkgOptions.visitRoute + 'sw.js";\n\
var writeJS = [];\n\
var writeJSON = "";\n\
var writeImport = "";\n\
var visitRoute = "' + pkgOptions.visitRoute + '";\n\
</script>\n';
        configjs = configjs.replace('var writeJS = [];', 'var writeJS = ' + jsArray + ';');
        if (srcJSONFiles[0]) {
            const jsonFileName = srcJSONFiles[0].substring('src="'.length, srcJSONFiles[0].length - 1);
            configjs = configjs.replace('var writeJSON = "";', 'var writeJSON = \'' + jsonFileName + '\';');
        }
        if (srcImportFiles[0]) {
            configjs = configjs.replace('var writeImport = "";', 'var writeImport = "' + srcImportFiles[0] + '";');
        }
        indexHtml = indexHtml.replace(scriptHtml, configjs + '<script type="text/javascript">\n' + swregister + '\n</script>');
        // 重新写入index.html
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'index.html'), indexHtml);
        // 压缩所有Bundle
        yield zipAllBundles(path_1.default.join(result.dest, 'assets'), pkgOptions.deleteAfterZip);
        // 压缩根目录文件及文件夹
        let indexjs = 'index.js';
        const files = fs_1.default.readdirSync(result.dest);
        files.forEach(function (fileName, index) {
            if (fileName.startsWith('index') && fileName.endsWith('.js')) {
                indexjs = fileName;
            }
        });
        /*
        const rootMatchRule = {
            files: [path.basename(result.paths.applicationJS), indexjs],
            folders: ['cocos-js', 'src']
        
        const rootHash = await zipRootFiles(result.dest, rootMatchRule.files, rootMatchRule.folders, pkgOptions.deleteAfterZip);
        */
        // 生成zipcacher
        const cacherCode = fs_1.default.readFileSync(path_1.default.join(__dirname, '../files/lib/zipcacher.js')).toString();
        const md5 = easymd5(cacherCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/zipcacher' + md5 + '.js'), cacherCode);
        const cdnAddress = pkgOptions.cdnAddress || '';
        const time = Date.now();
        // 生成sw.js
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'sw.js'), 'importScripts("./lib/sww.js");\n\
importScripts("./lib/zipcacher' + md5 + '.js");\n\
const distDir = "' + pkgOptions.visitRoute + '";\n\
const worker = new self.ServiceWorkerWare();\n\
const cdnUrl = "' + cdnAddress + '";\n\
const ver_time = "' + time + '";\n\
worker.use(new BundleAsyncCacher(distDir, cdnUrl, ' + pkgOptions.deleteAfterZip + '));\n\
worker.init();\n');
        // 生成发布包
        if (!pkgOptions.cdnAddress) {
            // 无加速站
            const webZip = new jszip_1.default();
            loopZipDir(webZip, result.dest);
            yield new Promise((resolve, reject) => {
                const outStream = fs_1.default.createWriteStream(path_1.default.join(result.dest, '../web.zip'));
                webZip.generateNodeStream({ streamFiles: true })
                    .pipe(outStream)
                    .on('finish', () => {
                    console.info('生成发布包', 'web.zip');
                    resolve();
                })
                    .on('error', (err) => {
                    reject(err);
                });
            });
        }
        else {
            // 区分发布
            const webZip = new jszip_1.default();
            const cdnZip = new jszip_1.default();
            const files = fs_1.default.readdirSync(result.dest);
            files.forEach(function (fileName, index) {
                const filePath = path_1.default.join(result.dest, fileName);
                const file = fs_1.default.statSync(filePath);
                if (file.isDirectory()) {
                    if (fileName == 'assets') {
                        loopZipDir(cdnZip.folder(fileName), filePath);
                    }
                    else {
                        loopZipDir(webZip.folder(fileName), filePath);
                    }
                }
                else {
                    webZip.file(fileName, fs_1.default.readFileSync(filePath));
                }
            });
            yield new Promise((resolve, reject) => {
                const outStream = fs_1.default.createWriteStream(path_1.default.join(result.dest, '../web.zip'));
                webZip.generateNodeStream({ streamFiles: true })
                    .pipe(outStream)
                    .on('finish', () => {
                    console.info('生成发布包', 'web.zip');
                    resolve();
                })
                    .on('error', (err) => {
                    reject(err);
                });
            });
            yield new Promise((resolve, reject) => {
                const outStream = fs_1.default.createWriteStream(path_1.default.join(result.dest, '../cdn.zip'));
                cdnZip.generateNodeStream({ streamFiles: true })
                    .pipe(outStream)
                    .on('finish', () => {
                    console.info('生成资源包', 'cdn.zip');
                    resolve();
                })
                    .on('error', (err) => {
                    reject(err);
                });
            });
        }
    });
}
exports.onAfterBuild = onAfterBuild;
function unload() {
    console.log(`[${PACKAGE_NAME}] Unload in builder.`);
}
exports.unload = unload;
