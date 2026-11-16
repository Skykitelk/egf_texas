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
Object.defineProperty(exports, "__esModule", { value: true });
exports.update = update;
const md5Check_1 = require("./md5Check");
function resolveState(options, path, value) {
    var _a;
    const pkgOptions = (_a = options.packages) === null || _a === void 0 ? void 0 : _a[md5Check_1.PACKAGE_NAME];
    const isAbleChange = path.endsWith('ableExtension');
    const isMd5Change = path === 'md5Cache' || path.endsWith('.md5Cache');
    const ableExtension = isAbleChange ? !!value : !!(pkgOptions === null || pkgOptions === void 0 ? void 0 : pkgOptions.ableExtension);
    const md5Cache = isMd5Change ? !!value : !!options.md5Cache;
    return { ableExtension, md5Cache, isAbleChange, isMd5Change };
}
/**
 * 构建面板选项变更时立即校验 MD5 Cache
 */
function update(options, path, value) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const state = resolveState(options, path, value);
        if (!state.isAbleChange && !state.isMd5Change) {
            return;
        }
        const draftOptions = Object.assign(Object.assign({}, options), { md5Cache: state.md5Cache, packages: Object.assign(Object.assign({}, options.packages), { [md5Check_1.PACKAGE_NAME]: Object.assign(Object.assign({}, (_a = options.packages) === null || _a === void 0 ? void 0 : _a[md5Check_1.PACKAGE_NAME]), { ableExtension: state.ableExtension }) }) });
        if (!(0, md5Check_1.needsMd5CacheWarning)(draftOptions)) {
            return;
        }
        try {
            yield Editor.Dialog.error(md5Check_1.MD5_REQUIRED_MESSAGE, { title: 'H5 Bundle Zipper' });
        }
        catch (_b) {
            // 面板环境异常时忽略
        }
    });
}
