import { IBuildTaskOption } from '../@types/packages/builder/@types/public/options';

export const PACKAGE_NAME = 'web_bundle_zipper';

export const MD5_REQUIRED_MESSAGE =
    '[H5 Bundle Zipper] 已启用 Bundle Zipper，请在构建面板勾选「MD5 Cache」选项。' +
    '插件依赖 MD5 生成的 Bundle 版本号来命名压缩包。';

interface PkgOptions {
    ableExtension?: boolean;
    appName: string;
    appShortName: string;
    initBundles: string;
    deleteAfterZip?: boolean;
    cdnAddress?: string;
}

export function getPkgOptions(options: IBuildTaskOption): PkgOptions | undefined {
    return options.packages?.[PACKAGE_NAME] as PkgOptions | undefined;
}

export function isExtensionEnabled(options: IBuildTaskOption): boolean {
    return !!getPkgOptions(options)?.ableExtension;
}

export function isMd5CacheEnabled(options: IBuildTaskOption): boolean {
    return !!options.md5Cache;
}

export function needsMd5CacheWarning(options: IBuildTaskOption): boolean {
    return isExtensionEnabled(options) && !isMd5CacheEnabled(options);
}
