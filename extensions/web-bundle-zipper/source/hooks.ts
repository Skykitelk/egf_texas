declare const Editor: {
    Dialog: {
        error(message: string, options?: { title?: string }): Promise<unknown>;
    };
};

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IBuildTaskOption } from '../@types/packages/builder/@types/public/options';
import { IBuildResult } from '../@types/packages/builder/@types/public/build-result';
import {
    MD5_REQUIRED_MESSAGE,
    PACKAGE_NAME,
    getPkgOptions,
    isExtensionEnabled,
    needsMd5CacheWarning,
} from './md5Check';
import { zipDirectoryWithDelete } from './zipUtils';
// import { zipDirectoryToFile, zipPublishSplit } from './zipUtils'; // 启用 web.zip 打包时取消注释

let settings: Record<string, any>;
let bundleVers: Record<string, string>;

function log(...arg: unknown[]) {
    return console.log(`[${PACKAGE_NAME}] `, ...arg);
}

async function ensureMd5CacheEnabled(options: IBuildTaskOption) {
    if (!needsMd5CacheWarning(options)) {
        return;
    }
    try {
        await Editor.Dialog.error(MD5_REQUIRED_MESSAGE, { title: 'H5 Bundle Zipper' });
    } catch {
        // 构建进程可能无法弹出对话框，仍通过 throw 终止构建
    }
    throw new Error(MD5_REQUIRED_MESSAGE);
}

export const throwError = true;

export async function load() {
    console.log(`[${PACKAGE_NAME}] Load in builder.`);
}

export async function onBeforeBuild(options: IBuildTaskOption) {
    await ensureMd5CacheEnabled(options);
}

export async function onBeforeBuildAssets(_options: IBuildTaskOption) {
    // log(`${PACKAGE_NAME}`, 'onBeforeBuildAssets');
}

export async function onAfterBuildAssets(_options: IBuildTaskOption) {
    // log(`${PACKAGE_NAME}`, 'onAfterBuildAssets');
}

export async function onBeforeCompressSettings(options: IBuildTaskOption, _result: IBuildResult) {
    const pkgOptions = getPkgOptions(options);
    log('onBeforeCompressSettings', pkgOptions);
}

export async function onAfterCompressSettings(_options: IBuildTaskOption, result: IBuildResult) {
    log('onAfterCompressSettings start');
    if (result.settings) {
        settings = result.settings;
    } else {
        const settingsString = fs.readFileSync(result.paths.settings).toString();
        settings = JSON.parse(settingsString);
    }
    bundleVers = settings.bundleVers || settings['assets'].bundleVers;
    const bundleCount = bundleVers ? Object.keys(bundleVers).length : 0;
    log('onAfterCompressSettings done', `bundleVers: ${bundleCount} bundles`);
}

/**
 * 压缩单个 Bundle 为 {bundle}.{ver}.zip（流式写入，低内存占用）
 */
async function zipBundle(rootPath: string, bundle: string, ver: string, deleteAfterZip: boolean) {
    let shouldDelete = deleteAfterZip;
    if (bundle === 'main' || bundle === 'internal' || bundle === 'resources') {
        shouldDelete = false;
    }
    const bundleDir = path.join(rootPath, bundle);
    const outZipPath = path.join(rootPath, `${bundle}.${ver}.zip`);
    const t0 = Date.now();
    log(`zip bundle start: ${bundle}.${ver}.zip`, shouldDelete ? '(delete source after)' : '(keep source)');
    await zipDirectoryWithDelete(bundleDir, outZipPath, bundle, shouldDelete);
    const sizeMb = (fs.statSync(outZipPath).size / 1024 / 1024).toFixed(2);
    log(`zip bundle done: ${bundle}.${ver}.zip`, `${sizeMb} MB`, `${Date.now() - t0}ms`);
}

/** 压缩 assets 目录下所有 Bundle */
async function zipAllBundles(rootPath: string, deleteAfterZip: boolean) {
    const names = Object.keys(bundleVers);
    log(`zip all bundles start: ${names.length} bundles`, `deleteAfterZip=${deleteAfterZip}`);
    const t0 = Date.now();
    const promises: Promise<void>[] = [];
    for (const bundle in bundleVers) {
        promises.push(zipBundle(rootPath, bundle, bundleVers[bundle], deleteAfterZip));
    }
    await Promise.all(promises);
    log(`zip all bundles done`, `${names.length} bundles`, `${Date.now() - t0}ms`);
}

/** 取内容 MD5 前 6 位，用于 lib/ 运行时文件名缓存破坏 */
function easymd5(content: string) {
    const hash = crypto.createHash('md5');
    const md5 = hash.update(content).digest('hex');
    return md5.substring(0, 6).toLowerCase();
}

function libHashedFilename(stem: string, ext: string, content: string) {
    return `${stem}.${easymd5(content)}${ext}`;
}

const COCOS_ENGINE_MARKER = '<!-- COCOS_ENGINE_ENTRY -->';

function findCocosScriptStart(indexHtml: string, bodyStart: number) {
    const markerIndex = indexHtml.indexOf(COCOS_ENGINE_MARKER, bodyStart);
    if (markerIndex >= 0) {
        return markerIndex;
    }
    const systemImportIndex = indexHtml.indexOf('System.import(', bodyStart);
    if (systemImportIndex < 0) {
        return -1;
    }
    const scriptOpenIndex = indexHtml.lastIndexOf('<script', systemImportIndex);
    return scriptOpenIndex >= bodyStart ? scriptOpenIndex : systemImportIndex;
}

function resolveHashedAsset(buildDir: string, fileName: string) {
    const dot = fileName.lastIndexOf('.');
    if (dot < 0) {
        return fileName;
    }
    const base = fileName.slice(0, dot);
    const ext = fileName.slice(dot);
    try {
        const hit = fs
            .readdirSync(buildDir)
            .find((name) => name.startsWith(`${base}.`) && name.endsWith(ext) && name !== fileName);
        return hit || fileName;
    } catch {
        return fileName;
    }
}

function patchSplashLogoPaths(indexHtml: string, buildDir: string) {
    const logo2File = resolveHashedAsset(buildDir, 'logo2.png');
    const logoFile = resolveHashedAsset(buildDir, 'logo.png');
    return indexHtml.replace(/logo2\.png/g, logo2File).replace(/logo\.png/g, logoFile);
}

function normalizeInitBundles(value: string) {
    const initBundles = value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    const result = ['resources'];
    for (const bundleName of initBundles) {
        if (result.indexOf(bundleName) < 0) {
            result.push(bundleName);
        }
    }
    return result;
}

export async function onAfterBuild(options: IBuildTaskOption, result: IBuildResult) {
    const buildT0 = Date.now();
    const pkgOptions = getPkgOptions(options);
    if (!isExtensionEnabled(options)) {
        log('onAfterBuild skipped: extension disabled');
        return;
    }

    await ensureMd5CacheEnabled(options);

    log('onAfterBuild start', result.dest);
    log('build options', {
        appName: pkgOptions!.appName,
        initBundles: pkgOptions!.initBundles,
        deleteAfterZip: pkgOptions!.deleteAfterZip,
        cdnAddress: pkgOptions!.cdnAddress || '(same origin)',
    });

    // 复制 PWA 图标
    log('copy PWA icons...');
    fs.mkdirSync(path.join(result.dest, 'img/'));
    const imgPaths = fs.readdirSync(path.join(__dirname, '../files/img/'));
    for (const fileName of imgPaths) {
        fs.copyFileSync(
            path.join(__dirname, '../files/img/' + fileName),
            path.join(result.dest, 'img/' + fileName),
        );
    }
    log('copy PWA icons done', `${imgPaths.length} files`);

    // lib/ 目录在下方按内容 hash 写入运行时脚本
    fs.mkdirSync(path.join(result.dest, 'lib/'));

    // 生成 PWA manifest（scope/start_url 使用相对路径，适配任意部署目录）
    const webmanifest = {
        name: pkgOptions!.appName,
        short_name: pkgOptions!.appShortName,
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
    fs.writeFileSync(
        path.join(result.dest, 'manifest.webmanifest'),
        JSON.stringify(webmanifest),
    );
    log('write manifest.webmanifest');

    // 改写 index.html：注入 PWA meta、进度条、SW 注册脚本
    log('patch index.html...');
    let indexHtml = fs.readFileSync(path.join(result.dest, 'index.html')).toString();
    indexHtml = indexHtml.replace(
        /<title>[\s\S]*?<\/title>/,
        `<title>${pkgOptions!.appName}</title>
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
  <link rel="manifest" href="manifest.webmanifest">`,
    );

    const initBundles = normalizeInitBundles(pkgOptions!.initBundles);

    for (const bundleName of initBundles) {
        if (!bundleVers[bundleName]) {
            log('warn: initBundle not in bundleVers, runtime network fallback:', bundleName);
        }
    }
    log('initBundles', initBundles);

    const swregister = fs
        .readFileSync(path.join(__dirname, '../files/sw_register.js'))
        .toString();

    const bodyStart = indexHtml.indexOf('<body>');
    const scriptStart = findCocosScriptStart(indexHtml, bodyStart);
    const scriptEnd = indexHtml.lastIndexOf('</body>');
    if (bodyStart < 0 || scriptStart < 0 || scriptEnd < 0) {
        throw new Error('[H5 Bundle Zipper] index.html structure not recognized, cannot inject scripts');
    }
    const scriptHtml = indexHtml.substring(scriptStart, scriptEnd);

    const srcJSFiles = scriptHtml.match(/src="[^"]+\.js"/g) || [];
    const srcJSONFiles = scriptHtml.match(/src="[^"]+\.json"/g);
    const srcImportFiles = scriptHtml.match(/System\.import\([^)]+\)/g);

    let jsArray = '[';
    for (const v of srcJSFiles) {
        const jsFileName = v.substring('src="'.length, v.length - 1);
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
        throw new Error(
            '[H5 Bundle Zipper] No Cocos engine scripts (src/*.js) found in index.html; cannot inject startup scripts',
        );
    }

    if (!srcJSONFiles?.[0]) {
        throw new Error(
            '[H5 Bundle Zipper] No SystemJS import map (src/*.json) found in index.html',
        );
    }

    if (!srcImportFiles?.[0]) {
        throw new Error(
            '[H5 Bundle Zipper] No System.import(...) entry found in index.html',
        );
    }

    const cdnAddress = (pkgOptions!.cdnAddress || '').replace(/\/+$/, '');

    // 生成带 hash 的 zipcacher 脚本（须在 swVersion 计算前完成）
    const cacherCode = fs
        .readFileSync(path.join(__dirname, '../files/zipcacher.js'))
        .toString();
    const cacherHash = easymd5(cacherCode);
    const coreCode = fs
        .readFileSync(path.join(__dirname, '../files/bundle_cache_core.js'))
        .toString();
    const pageCacherCode = fs
        .readFileSync(path.join(__dirname, '../files/page_cacher.js'))
        .toString();
    const swRegisterCode = fs
        .readFileSync(path.join(__dirname, '../files/sw_register.js'))
        .toString();
    const fflateCode = fs
        .readFileSync(path.join(__dirname, '../files/fflate.min.js'))
        .toString();
    const storageAdapterCode = fs
        .readFileSync(path.join(__dirname, '../files/storage_adapter.js'))
        .toString();
    const runtimeUpdateUiCode = fs
        .readFileSync(path.join(__dirname, '../files/runtime_update_ui.js'))
        .toString();
    const runtimeUpdateUiCssCode = fs
        .readFileSync(path.join(__dirname, '../files/runtime_update_ui.css'))
        .toString();
    const pwaInstallCode = fs
        .readFileSync(path.join(__dirname, '../files/pwa_install.js'))
        .toString();
    // runtimeVersion 仅表示插件运行时脚本变更（不含引擎/站点资源）
    const runtimeVersion = easymd5(
        cacherHash +
            easymd5(coreCode) +
            easymd5(pageCacherCode) +
            easymd5(swRegisterCode) +
            easymd5(fflateCode) +
            easymd5(storageAdapterCode) +
            easymd5(runtimeUpdateUiCode) +
            easymd5(runtimeUpdateUiCssCode) +
            easymd5(pwaInstallCode),
    );

    const libFflate = libHashedFilename('fflate', '.js', fflateCode);
    const libStorageAdapter = libHashedFilename('storage_adapter', '.js', storageAdapterCode);
    const libBundleCacheCore = libHashedFilename('bundle_cache_core', '.js', coreCode);
    const libPageCacher = libHashedFilename('page_cacher', '.js', pageCacherCode);
    const libRuntimeUpdateUi = libHashedFilename('runtime_update_ui', '.js', runtimeUpdateUiCode);
    const libPwaInstall = libHashedFilename('pwa_install', '.js', pwaInstallCode);
    const libRuntimeUpdateUiCss = libHashedFilename('runtime_update_ui', '.css', runtimeUpdateUiCssCode);
    const libZipcacher = `zipcacher${cacherHash}.js`;

    let configjs =
        '<link rel="stylesheet" href="lib/' +
        libRuntimeUpdateUiCss +
        '">\n' +
        '<script type="text/javascript">\n' +
        `var initBundles = ${JSON.stringify(initBundles)};\n` +
        `var allBundles = ${JSON.stringify(bundleVers)};\n` +
        `var runtimeVersion = ${JSON.stringify(runtimeVersion)};\n` +
        `var swVersion = ${JSON.stringify(runtimeVersion)};\n` +
        `var cdnAddress = ${JSON.stringify(cdnAddress)};\n` +
        'var writeJS = [];\n' +
        'var writeJSON = "";\n' +
        'var writeImport = "";\n' +
        '</script>\n' +
        `<script src="lib/${libFflate}"></script>\n` +
        `<script src="lib/${libStorageAdapter}"></script>\n` +
        `<script src="lib/${libBundleCacheCore}"></script>\n` +
        `<script src="lib/${libPageCacher}"></script>\n` +
        `<script src="lib/${libRuntimeUpdateUi}"></script>\n` +
        `<script src="lib/${libPwaInstall}"></script>\n`;

    configjs = configjs.replace('var writeJS = [];', `var writeJS = ${jsArray};`);
    if (srcJSONFiles?.[0]) {
        const jsonFileName = srcJSONFiles[0].substring('src="'.length, srcJSONFiles[0].length - 1);
        configjs = configjs.replace('var writeJSON = "";', `var writeJSON = ${JSON.stringify(jsonFileName)};`);
    }
    if (srcImportFiles?.[0]) {
        configjs = configjs.replace(
            'var writeImport = "";',
            `var writeImport = ${JSON.stringify(srcImportFiles[0])};`,
        );
    }

    indexHtml = indexHtml.replace(
        scriptHtml,
        configjs + '<script type="text/javascript">\n' + swregister + '\n</script>',
    );
    indexHtml = patchSplashLogoPaths(indexHtml, result.dest);
    fs.writeFileSync(path.join(result.dest, 'index.html'), indexHtml);
    log('patch index.html done', `writeJS=${jsArray}`, `writeJSON=${srcJSONFiles?.[0] || 'none'}`);

    // 压缩所有 Bundle
    await zipAllBundles(path.join(result.dest, 'assets'), !!pkgOptions!.deleteAfterZip);

    fs.writeFileSync(path.join(result.dest, 'lib/' + libFflate), fflateCode);
    fs.writeFileSync(path.join(result.dest, 'lib/' + libStorageAdapter), storageAdapterCode);
    fs.writeFileSync(path.join(result.dest, 'lib/' + libBundleCacheCore), coreCode);
    fs.writeFileSync(path.join(result.dest, 'lib/' + libPageCacher), pageCacherCode);
    fs.writeFileSync(path.join(result.dest, 'lib/' + libRuntimeUpdateUi), runtimeUpdateUiCode);
    fs.writeFileSync(path.join(result.dest, 'lib/' + libRuntimeUpdateUiCss), runtimeUpdateUiCssCode);
    fs.writeFileSync(path.join(result.dest, 'lib/' + libPwaInstall), pwaInstallCode);
    fs.writeFileSync(path.join(result.dest, 'lib/' + libZipcacher), cacherCode);
    log(
        'write runtime scripts',
        `runtimeVersion=${runtimeVersion}`,
        libZipcacher,
        libBundleCacheCore,
    );

    // distDir 由 SW 根据 sw.js 所在目录自动解析
    fs.writeFileSync(
        path.join(result.dest, 'sw.js'),
        `const BUNDLE_ZIPPER_SW_VERSION = "${runtimeVersion}";
importScripts("./lib/${libFflate}", "./lib/${libBundleCacheCore}", "./lib/${libZipcacher}");
BundleZipperSW.init({ cdnUrl: ${JSON.stringify(cdnAddress)}, swVersion: "${runtimeVersion}", knownBundles: ${JSON.stringify(bundleVers)} });
`,
    );
    log('write sw.js');
    log('skip web.zip pack (disabled for large projects)');
    log('onAfterBuild done', `${Date.now() - buildT0}ms`, result.dest);
}

export function unload() {
    console.log(`[${PACKAGE_NAME}] Unload in builder.`);
}
