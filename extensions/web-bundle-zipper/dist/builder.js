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
exports.configs = void 0;
exports.load = load;
exports.unload = unload;
const md5Check_1 = require("./md5Check");
function load() {
}
function unload() {
}
exports.configs = {
    'web-mobile': {
        hooks: './hooks',
        panel: './panel',
        options: {
            ableExtension: {
                label: 'i18n:web_bundle_zipper.options.ableExtension',
                render: {
                    ui: 'ui-checkbox',
                },
                default: false,
                verifyRules: ['requireMd5Cache'],
            },
            appName: {
                label: 'i18n:web_bundle_zipper.options.appName',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '输入App名称',
                    },
                },
                default: 'AppFullName',
                verifyRules: ['require'],
            },
            appShortName: {
                label: 'i18n:web_bundle_zipper.options.appShortName',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '输入App简称',
                    },
                },
                default: 'ShortName',
                verifyRules: ['require'],
            },
            initBundles: {
                label: 'i18n:web_bundle_zipper.options.initBundles',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '输入启动缓存的Bundle(以逗号间隔)',
                    },
                },
                default: 'main,internal',
                verifyRules: ['require'],
            },
            deleteAfterZip: {
                label: 'i18n:web_bundle_zipper.options.deleteAfterZip',
                render: {
                    ui: 'ui-checkbox',
                },
                default: true,
            },
            cdnAddress: {
                label: 'i18n:web_bundle_zipper.options.cdnAddress',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '可选，资源加速地址',
                    },
                },
                verifyRules: ['http'],
            },
        },
        verifyRuleMap: {
            require: {
                message: 'can`t be empty',
                func(val) {
                    return !!(val && val.length);
                },
            },
            requireMd5Cache: {
                message: 'i18n:web_bundle_zipper.md5Required_msg',
                func(val, options) {
                    return __awaiter(this, void 0, void 0, function* () {
                        if (!val) {
                            return true;
                        }
                        if ((0, md5Check_1.isMd5CacheEnabled)(options)) {
                            return true;
                        }
                        try {
                            yield Editor.Dialog.error(md5Check_1.MD5_REQUIRED_MESSAGE, { title: 'H5 Bundle Zipper' });
                        }
                        catch (_a) {
                            // 忽略对话框异常，仍通过返回值阻止勾选
                        }
                        return false;
                    });
                },
            },
        },
    },
};
