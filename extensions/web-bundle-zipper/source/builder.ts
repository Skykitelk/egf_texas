import { IBuildTaskOption } from '../@types/packages/builder/@types/public/options';
import { MD5_REQUIRED_MESSAGE, isMd5CacheEnabled } from './md5Check';

declare const Editor: {
    Dialog: {
        error(message: string, options?: { title?: string }): Promise<unknown>;
    };
};

export function load() {
}

export function unload() {
}

export const configs = {
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
                func(val: string) {
                    return !!(val && val.length);
                },
            },
            requireMd5Cache: {
                message: 'i18n:web_bundle_zipper.md5Required_msg',
                async func(val: boolean, options: IBuildTaskOption) {
                    if (!val) {
                        return true;
                    }
                    if (isMd5CacheEnabled(options)) {
                        return true;
                    }
                    try {
                        await Editor.Dialog.error(MD5_REQUIRED_MESSAGE, { title: 'H5 Bundle Zipper' });
                    } catch {
                        // 忽略对话框异常，仍通过返回值阻止勾选
                    }
                    return false;
                },
            },
        },
    },
};
