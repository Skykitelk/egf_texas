"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configs = exports.unload = exports.load = void 0;
function load() {
}
exports.load = load;
function unload() {
}
exports.unload = unload;
exports.configs = {
    'web-mobile': {
        hooks: './hooks',
        options: {
            disableExtension: {
                label: 'i18n:h5_bundle_zipper.options.disableExtension',
                render: {
                    ui: 'ui-checkbox'
                },
                default: false,
            },
            appName: {
                label: 'i18n:h5_bundle_zipper.options.appName',
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
                label: 'i18n:h5_bundle_zipper.options.appShortName',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '输入App简称',
                    },
                },
                default: 'ShortName',
                verifyRules: ['require'],
            },
            visitRoute: {
                label: 'i18n:h5_bundle_zipper.options.visitRoute',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '输入访问路由（必须以/开头和结尾）',
                    },
                },
                default: '/web-mobile/',
                verifyRules: ['require', 'ruleRoute']
            },
            initBundles: {
                label: 'i18n:h5_bundle_zipper.options.initBundles',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '输入启动缓存的Bundle(以逗号间隔)',
                    },
                },
                default: 'main',
                verifyRules: ['require']
            },
            deleteAfterZip: {
                label: 'i18n:h5_bundle_zipper.options.deleteAfterZip',
                render: {
                    ui: 'ui-checkbox'
                },
                default: true,
            },
            cdnAddress: {
                label: 'i18n:h5_bundle_zipper.options.cdnAddress',
                render: {
                    ui: 'ui-input',
                    attributes: {
                        placeholder: '可选，资源加速地址',
                    },
                },
                verifyRules: ['http'],
            }
        },
        verifyRuleMap: {
            require: {
                message: 'can`t be empty',
                func(val, option) {
                    if (val && val.length) {
                        return true;
                    }
                    return false;
                }
            },
            ruleRoute: {
                message: 'i18n:h5_bundle_zipper.ruleRoute_msg',
                func(val, option) {
                    if (val.startsWith('/') && val.endsWith('/')) {
                        return true;
                    }
                    return false;
                }
            }
        }
    },
};
