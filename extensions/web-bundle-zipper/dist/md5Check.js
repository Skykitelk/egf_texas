"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MD5_REQUIRED_MESSAGE = exports.PACKAGE_NAME = void 0;
exports.getPkgOptions = getPkgOptions;
exports.isExtensionEnabled = isExtensionEnabled;
exports.isMd5CacheEnabled = isMd5CacheEnabled;
exports.needsMd5CacheWarning = needsMd5CacheWarning;
exports.PACKAGE_NAME = 'web_bundle_zipper';
exports.MD5_REQUIRED_MESSAGE = '[H5 Bundle Zipper] 已启用 Bundle Zipper，请在构建面板勾选「MD5 Cache」选项。' +
    '插件依赖 MD5 生成的 Bundle 版本号来命名压缩包。';
function getPkgOptions(options) {
    var _a;
    return (_a = options.packages) === null || _a === void 0 ? void 0 : _a[exports.PACKAGE_NAME];
}
function isExtensionEnabled(options) {
    var _a;
    return !!((_a = getPkgOptions(options)) === null || _a === void 0 ? void 0 : _a.ableExtension);
}
function isMd5CacheEnabled(options) {
    return !!options.md5Cache;
}
function needsMd5CacheWarning(options) {
    return isExtensionEnabled(options) && !isMd5CacheEnabled(options);
}
