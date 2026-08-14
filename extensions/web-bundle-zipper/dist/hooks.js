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
exports.throwError = void 0;
exports.load = load;
exports.onBeforeBuild = onBeforeBuild;
exports.onBeforeBuildAssets = onBeforeBuildAssets;
exports.onAfterBuildAssets = onAfterBuildAssets;
exports.onBeforeCompressSettings = onBeforeCompressSettings;
exports.onAfterCompressSettings = onAfterCompressSettings;
exports.onAfterBuild = onAfterBuild;
exports.unload = unload;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const md5Check_1 = require("./md5Check");
const zipUtils_1 = require("./zipUtils");
// import { zipDirectoryToFile, zipPublishSplit } from './zipUtils'; // 启用 web.zip 打包时取消注释
let settings;
let bundleVers;
function log(...arg) {
    return console.log(`[${md5Check_1.PACKAGE_NAME}] `, ...arg);
}
function ensureMd5CacheEnabled(options) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!(0, md5Check_1.needsMd5CacheWarning)(options)) {
            return;
        }
        try {
            yield Editor.Dialog.error(md5Check_1.MD5_REQUIRED_MESSAGE, { title: 'H5 Bundle Zipper' });
        }
        catch (_a) {
            // 构建进程可能无法弹出对话框，仍通过 throw 终止构建
        }
        throw new Error(md5Check_1.MD5_REQUIRED_MESSAGE);
    });
}
exports.throwError = true;
function load() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`[${md5Check_1.PACKAGE_NAME}] Load in builder.`);
    });
}
function onBeforeBuild(options) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMd5CacheEnabled(options);
    });
}
function onBeforeBuildAssets(_options) {
    return __awaiter(this, void 0, void 0, function* () {
        // log(`${PACKAGE_NAME}`, 'onBeforeBuildAssets');
    });
}
function onAfterBuildAssets(_options) {
    return __awaiter(this, void 0, void 0, function* () {
        // log(`${PACKAGE_NAME}`, 'onAfterBuildAssets');
    });
}
function onBeforeCompressSettings(options, _result) {
    return __awaiter(this, void 0, void 0, function* () {
        const pkgOptions = (0, md5Check_1.getPkgOptions)(options);
        log('onBeforeCompressSettings', pkgOptions);
    });
}
function onAfterCompressSettings(_options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        log('onAfterCompressSettings start');
        if (result.settings) {
            settings = result.settings;
        }
        else {
            const settingsString = fs_1.default.readFileSync(result.paths.settings).toString();
            settings = JSON.parse(settingsString);
        }
        bundleVers = settings.bundleVers || settings['assets'].bundleVers;
        const bundleCount = bundleVers ? Object.keys(bundleVers).length : 0;
        log('onAfterCompressSettings done', `bundleVers: ${bundleCount} bundles`);
    });
}
/**
 * 压缩单个 Bundle 为 {bundle}.{ver}.zip（流式写入，低内存占用；始终保留源目录）
 */
function zipBundle(rootPath, bundle, ver) {
    return __awaiter(this, void 0, void 0, function* () {
        const bundleDir = path_1.default.join(rootPath, bundle);
        const outZipPath = path_1.default.join(rootPath, `${bundle}.${ver}.zip`);
        const t0 = Date.now();
        log(`zip bundle start: ${bundle}.${ver}.zip`);
        yield (0, zipUtils_1.zipDirectoryToFile)(bundleDir, outZipPath, bundle);
        const sizeMb = (fs_1.default.statSync(outZipPath).size / 1024 / 1024).toFixed(2);
        log(`zip bundle done: ${bundle}.${ver}.zip`, `${sizeMb} MB`, `${Date.now() - t0}ms`);
    });
}
/** 压缩 assets 目录下所有 Bundle */
function zipAllBundles(rootPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const names = Object.keys(bundleVers);
        log(`zip all bundles start: ${names.length} bundles`);
        const t0 = Date.now();
        const promises = [];
        for (const bundle in bundleVers) {
            promises.push(zipBundle(rootPath, bundle, bundleVers[bundle]));
        }
        yield Promise.all(promises);
        log(`zip all bundles done`, `${names.length} bundles`, `${Date.now() - t0}ms`);
    });
}
/** 取内容 MD5 前 6 位，用于 lib/ 运行时文件名缓存破坏 */
function easymd5(content) {
    const hash = crypto_1.default.createHash('md5');
    const md5 = hash.update(content).digest('hex');
    return md5.substring(0, 6).toLowerCase();
}
function libHashedFilename(stem, ext, content) {
    return `${stem}.${easymd5(content)}${ext}`;
}
const COCOS_ENGINE_MARKER = '<!-- COCOS_ENGINE_ENTRY -->';
function findCocosScriptStart(indexHtml, bodyStart) {
    const markerIndex = indexHtml.indexOf(COCOS_ENGINE_MARKER, bodyStart);
    if (markerIndex >= 0) {
        return markerIndex;
    }
    // Creator 默认模板：先加载 src/*.js，再 System.import；必须从第一个 src 脚本（或 Polyfills 注释）起截
    const polyfillComment = indexHtml.indexOf('<!-- Polyfills bundle.', bodyStart);
    if (polyfillComment >= 0) {
        return polyfillComment;
    }
    const bodyHtml = indexHtml.substring(bodyStart);
    const srcScriptMatch = bodyHtml.match(/<script[^>]*\ssrc=["'](?:\.\/)?src\/[^"']+\.js["'][^>]*>/i);
    if (srcScriptMatch && typeof srcScriptMatch.index === 'number') {
        return bodyStart + srcScriptMatch.index;
    }
    const systemImportIndex = indexHtml.indexOf('System.import(', bodyStart);
    if (systemImportIndex < 0) {
        return -1;
    }
    const scriptOpenIndex = indexHtml.lastIndexOf('<script', systemImportIndex);
    return scriptOpenIndex >= bodyStart ? scriptOpenIndex : systemImportIndex;
}
function resolveHashedAsset(buildDir, fileName) {
    const dot = fileName.lastIndexOf('.');
    if (dot < 0) {
        return fileName;
    }
    const base = fileName.slice(0, dot);
    const ext = fileName.slice(dot);
    try {
        const hit = fs_1.default
            .readdirSync(buildDir)
            .find((name) => name.startsWith(`${base}.`) && name.endsWith(ext) && name !== fileName);
        return hit || fileName;
    }
    catch (_a) {
        return fileName;
    }
}
function patchSplashLogoPaths(indexHtml, buildDir) {
    const logo2File = resolveHashedAsset(buildDir, 'logo2.png');
    const logoFile = resolveHashedAsset(buildDir, 'logo.png');
    return indexHtml.replace(/logo2\.png/g, logo2File).replace(/logo\.png/g, logoFile);
}
/** 刘海屏 safe-area 依赖 viewport-fit=cover */
function ensureViewportFitCover(indexHtml) {
    if (/viewport-fit\s*=\s*cover/i.test(indexHtml)) {
        return indexHtml;
    }
    if (/<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i.test(indexHtml)) {
        return indexHtml.replace(/(<meta[^>]+name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'])([^"']*)(["'][^>]*>)/i, (_m, prefix, content, suffix) => {
            const trimmed = String(content || '')
                .trim()
                .replace(/[,;]\s*$/, '');
            return `${prefix}${trimmed}${trimmed ? ',' : ''}viewport-fit=cover${suffix}`;
        });
    }
    return indexHtml.replace(/<meta name="apple-touch-fullscreen" content="yes"\/>/, `<meta name="apple-touch-fullscreen" content="yes"/>
  <meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,viewport-fit=cover"/>`);
}
function normalizeInitBundles(value) {
    const initBundles = value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    const result = [];
    for (const bundleName of initBundles) {
        if (result.indexOf(bundleName) < 0) {
            result.push(bundleName);
        }
    }
    return result;
}
function onAfterBuild(options, result) {
    return __awaiter(this, void 0, void 0, function* () {
        const buildT0 = Date.now();
        const pkgOptions = (0, md5Check_1.getPkgOptions)(options);
        if (!(0, md5Check_1.isExtensionEnabled)(options)) {
            log('onAfterBuild skipped: extension disabled');
            return;
        }
        yield ensureMd5CacheEnabled(options);
        log('onAfterBuild start', result.dest);
        log('build options', {
            appName: pkgOptions.appName,
            initBundles: pkgOptions.initBundles,
            cdnAddress: pkgOptions.cdnAddress || '(same origin)',
        });
        // 复制 PWA 图标
        log('copy PWA icons...');
        fs_1.default.mkdirSync(path_1.default.join(result.dest, 'img/'), { recursive: true });
        const imgPaths = fs_1.default.readdirSync(path_1.default.join(__dirname, '../files/img/'));
        for (const fileName of imgPaths) {
            fs_1.default.copyFileSync(path_1.default.join(__dirname, '../files/img/' + fileName), path_1.default.join(result.dest, 'img/' + fileName));
        }
        log('copy PWA icons done', `${imgPaths.length} files`);
        // lib/ 目录在下方按内容 hash 写入运行时脚本
        fs_1.default.mkdirSync(path_1.default.join(result.dest, 'lib/'), { recursive: true });
        // 生成 PWA manifest（scope/start_url 使用相对路径，适配任意部署目录）
        const webmanifest = {
            name: pkgOptions.appName,
            short_name: pkgOptions.appShortName,
            id: './',
            display: 'fullscreen',
            scope: './',
            start_url: './index.html',
            theme_color: '#313131',
            background_color: '#313131',
            icons: [
                {
                    src: 'img/icon144.png',
                    sizes: '144x144',
                    type: 'image/png',
                },
                {
                    src: 'img/icon144.png',
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                },
                {
                    src: 'img/icon144.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                },
            ],
        };
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'manifest.webmanifest'), JSON.stringify(webmanifest));
        log('write manifest.webmanifest');
        // 改写 index.html：注入 PWA meta、进度条、SW 注册脚本
        log('patch index.html...');
        let indexHtml = fs_1.default.readFileSync(path_1.default.join(result.dest, 'index.html')).toString();
        indexHtml = indexHtml.replace(/<title>[\s\S]*?<\/title>/, `<title>${pkgOptions.appName}</title>
  <meta HTTP-EQUIV="pragma" CONTENT="no-cache">
  <meta HTTP-EQUIV="Cache-Control" CONTENT="no-cache, no-store, must-revalidate">
  <meta http-equiv="Cache" content="no-cache">
  <meta HTTP-EQUIV="expires" CONTENT="0">
  <meta name="apple-touch-fullscreen" content="yes"/>
  <link rel="apple-touch-icon" sizes="57x57" href="img/icon57.png"/>
  <link rel="apple-touch-icon" sizes="72x72" href="img/icon72.png"/>
  <link rel="apple-touch-icon" sizes="114x114" href="img/icon114.png"/>
  <link rel="apple-touch-icon" sizes="144x144" href="img/icon144.png"/>
  <link href="img/page-icon.png" rel="shortcut icon"/>
  <link rel="manifest" href="manifest.webmanifest">`);
        const initBundles = normalizeInitBundles(pkgOptions.initBundles);
        for (const bundleName of initBundles) {
            if (!bundleVers[bundleName]) {
                log('warn: initBundle not in bundleVers, runtime network fallback:', bundleName);
            }
        }
        log('initBundles', initBundles);
        const bootstrapCode = fs_1.default.readFileSync(path_1.default.join(__dirname, '../files/bootstrap.js')).toString();
        const bodyStart = indexHtml.indexOf('<body>');
        const scriptStart = findCocosScriptStart(indexHtml, bodyStart >= 0 ? bodyStart : 0);
        const scriptEnd = indexHtml.lastIndexOf('</body>');
        if (bodyStart < 0 || scriptStart < 0 || scriptEnd < 0 || scriptStart >= scriptEnd) {
            throw new Error('[H5 Bundle Zipper] index.html structure not recognized, cannot inject scripts' +
                ` (bodyStart=${bodyStart}, scriptStart=${scriptStart}, scriptEnd=${scriptEnd})`);
        }
        const scriptHtml = indexHtml.substring(scriptStart, scriptEnd);
        // 从整个 body 扫描引擎脚本，避免截取起点偏后导致漏掉 src/*.js
        const scanHtml = indexHtml.substring(bodyStart, scriptEnd);
        const srcJSFiles = scanHtml.match(/src=["']([^"']+\.js)["']/g) || [];
        const srcJSONFiles = scanHtml.match(/src=["']([^"']+\.json)["']/g);
        const srcImportFiles = scanHtml.match(/System\.import\([^)]+\)/g);
        let jsArray = '[';
        for (const v of srcJSFiles) {
            const quote = v.includes("'") ? "'" : '"';
            const jsFileName = v.substring(`src=${quote}`.length, v.length - 1);
            if (!jsFileName.startsWith('src/') && !jsFileName.startsWith('./src/')) {
                continue;
            }
            if (jsArray.length > 1) {
                jsArray += ',';
            }
            jsArray += `"${jsFileName}"`;
        }
        jsArray += ']';
        if (jsArray === '[]') {
            const preview = scanHtml.replace(/\s+/g, ' ').slice(0, 300);
            throw new Error('[H5 Bundle Zipper] No Cocos engine scripts (src/*.js) found in index.html; cannot inject startup scripts. body preview: ' +
                preview);
        }
        if (!(srcJSONFiles === null || srcJSONFiles === void 0 ? void 0 : srcJSONFiles[0])) {
            throw new Error('[H5 Bundle Zipper] No SystemJS import map (src/*.json) found in index.html');
        }
        if (!(srcImportFiles === null || srcImportFiles === void 0 ? void 0 : srcImportFiles[0])) {
            throw new Error('[H5 Bundle Zipper] No System.import(...) entry found in index.html');
        }
        // 取第一个匹配到的路径（兼容单双引号）
        const firstJsonAttr = srcJSONFiles[0];
        const jsonQuote = firstJsonAttr.includes("'") ? "'" : '"';
        const jsonFileName = firstJsonAttr.substring(`src=${jsonQuote}`.length, firstJsonAttr.length - 1);
        const cdnAddress = (pkgOptions.cdnAddress || '').replace(/\/+$/, '');
        const cacherCode = fs_1.default.readFileSync(path_1.default.join(__dirname, '../files/zipcacher.js')).toString();
        const cacherHash = easymd5(cacherCode);
        const runtimeCode = fs_1.default.readFileSync(path_1.default.join(__dirname, '../files/bundle_runtime.js')).toString();
        const installerCode = fs_1.default
            .readFileSync(path_1.default.join(__dirname, '../files/bundle_installer.js'))
            .toString();
        const networkCode = fs_1.default
            .readFileSync(path_1.default.join(__dirname, '../files/network_intercept.js'))
            .toString();
        const fflateCode = fs_1.default.readFileSync(path_1.default.join(__dirname, '../files/fflate.min.js')).toString();
        const storageAdapterCode = fs_1.default
            .readFileSync(path_1.default.join(__dirname, '../files/storage_adapter.js'))
            .toString();
        const runtimeUpdateUiCode = fs_1.default
            .readFileSync(path_1.default.join(__dirname, '../files/runtime_update_ui.js'))
            .toString();
        const runtimeUpdateUiCssCode = fs_1.default
            .readFileSync(path_1.default.join(__dirname, '../files/runtime_update_ui.css'))
            .toString();
        const pwaInstallCode = fs_1.default.readFileSync(path_1.default.join(__dirname, '../files/pwa_install.js')).toString();
        // runtimeVersion 仅表示插件运行时脚本变更（不含引擎/站点资源）
        const runtimeVersion = easymd5(cacherHash +
            easymd5(runtimeCode) +
            easymd5(installerCode) +
            easymd5(networkCode) +
            easymd5(bootstrapCode) +
            easymd5(fflateCode) +
            easymd5(storageAdapterCode) +
            easymd5(runtimeUpdateUiCode) +
            easymd5(runtimeUpdateUiCssCode) +
            easymd5(pwaInstallCode));
        // 发布版本：runtime + bundleVers + initBundles；用于 index.html ?bzv= 缓存破坏
        const publishVersion = easymd5(runtimeVersion + JSON.stringify(bundleVers) + JSON.stringify(initBundles));
        const libFflate = libHashedFilename('fflate', '.js', fflateCode);
        const libRuntime = libHashedFilename('bundle_runtime', '.js', runtimeCode);
        const libStorageAdapter = libHashedFilename('storage_adapter', '.js', storageAdapterCode);
        const libInstaller = libHashedFilename('bundle_installer', '.js', installerCode);
        const libNetwork = libHashedFilename('network_intercept', '.js', networkCode);
        const libRuntimeUpdateUi = libHashedFilename('runtime_update_ui', '.js', runtimeUpdateUiCode);
        const libPwaInstall = libHashedFilename('pwa_install', '.js', pwaInstallCode);
        const libRuntimeUpdateUiCss = libHashedFilename('runtime_update_ui', '.css', runtimeUpdateUiCssCode);
        const libZipcacher = libHashedFilename('zipcacher', '.js', cacherCode);
        let configjs = '<link rel="stylesheet" href="lib/' +
            libRuntimeUpdateUiCss +
            '">\n' +
            '<script type="text/javascript">\n' +
            'window.WebBundleZipper = window.WebBundleZipper || {};\n' +
            `(function (W) {\n` +
            `  W.initBundles = ${JSON.stringify(initBundles)};\n` +
            `  W.allBundles = ${JSON.stringify(bundleVers)};\n` +
            `  W.runtimeVersion = ${JSON.stringify(runtimeVersion)};\n` +
            `  W.swVersion = ${JSON.stringify(runtimeVersion)};\n` +
            `  W.publishVersion = ${JSON.stringify(publishVersion)};\n` +
            `  W.cdnAddress = ${JSON.stringify(cdnAddress)};\n` +
            '  W.writeJS = [];\n' +
            '  W.writeJSON = "";\n' +
            '  W.writeImport = "";\n' +
            '})(window.WebBundleZipper);\n' +
            '</script>\n' +
            `<script src="lib/${libFflate}"></script>\n` +
            `<script src="lib/${libRuntime}"></script>\n` +
            `<script src="lib/${libStorageAdapter}"></script>\n` +
            `<script src="lib/${libInstaller}"></script>\n` +
            `<script src="lib/${libNetwork}"></script>\n` +
            `<script src="lib/${libRuntimeUpdateUi}"></script>\n` +
            `<script src="lib/${libPwaInstall}"></script>\n`;
        configjs = configjs.replace('W.writeJS = [];', `W.writeJS = ${jsArray};`);
        configjs = configjs.replace('W.writeJSON = "";', `W.writeJSON = ${JSON.stringify(jsonFileName)};`);
        if (srcImportFiles === null || srcImportFiles === void 0 ? void 0 : srcImportFiles[0]) {
            configjs = configjs.replace('W.writeImport = "";', `W.writeImport = ${JSON.stringify(srcImportFiles[0])};`);
        }
        indexHtml = indexHtml.replace(scriptHtml, configjs + '<script type="text/javascript">\n' + bootstrapCode + '\n</script>');
        indexHtml = patchSplashLogoPaths(indexHtml, result.dest);
        indexHtml = ensureViewportFitCover(indexHtml);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'index.html'), indexHtml);
        log('patch index.html done', `writeJS=${jsArray}`, `writeJSON=${jsonFileName}`);
        // 压缩所有 Bundle
        yield zipAllBundles(path_1.default.join(result.dest, 'assets'));
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libFflate), fflateCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libRuntime), runtimeCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libStorageAdapter), storageAdapterCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libInstaller), installerCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libNetwork), networkCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libRuntimeUpdateUi), runtimeUpdateUiCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libRuntimeUpdateUiCss), runtimeUpdateUiCssCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libPwaInstall), pwaInstallCode);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'lib/' + libZipcacher), cacherCode);
        log('write runtime scripts', `runtimeVersion=${runtimeVersion}`, libZipcacher, libInstaller);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'bz-publish.json'), JSON.stringify({
            v: publishVersion,
            runtimeVersion,
            initBundles,
            allBundles: bundleVers,
            builtAt: Date.now(),
        }, null, 2));
        log('write bz-publish.json', `publishVersion=${publishVersion}`);
        fs_1.default.writeFileSync(path_1.default.join(result.dest, 'sw.js'), `const BUNDLE_ZIPPER_SW_VERSION = "${runtimeVersion}";
const BUNDLE_ZIPPER_PUBLISH_VERSION = "${publishVersion}";
importScripts("./lib/${libFflate}", "./lib/${libRuntime}", "./lib/${libStorageAdapter}", "./lib/${libZipcacher}");
(self.WebBundleZipper = self.WebBundleZipper || {}).SW.init({ swVersion: "${runtimeVersion}", knownBundles: ${JSON.stringify(bundleVers)}, initBundles: ${JSON.stringify(initBundles)} });
`);
        log('write sw.js');
        log('skip web.zip pack (disabled for large projects)');
        log('onAfterBuild done', `${Date.now() - buildT0}ms`, result.dest);
    });
}
function unload() {
    console.log(`[${md5Check_1.PACKAGE_NAME}] Unload in builder.`);
}
