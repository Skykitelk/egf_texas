import { IBuildTaskOption } from '../@types/packages/builder/@types/public/options';
import { MD5_REQUIRED_MESSAGE, PACKAGE_NAME, needsMd5CacheWarning } from './md5Check';

declare const Editor: {
    Dialog: {
        error(message: string, options?: { title?: string }): Promise<unknown>;
    };
};

function resolveState(options: IBuildTaskOption, path: string, value: unknown) {
    const pkgOptions = options.packages?.[PACKAGE_NAME] as { ableExtension?: boolean } | undefined;
    const isAbleChange = path.endsWith('ableExtension');
    const isMd5Change = path === 'md5Cache' || path.endsWith('.md5Cache');

    const ableExtension = isAbleChange ? !!value : !!pkgOptions?.ableExtension;
    const md5Cache = isMd5Change ? !!value : !!options.md5Cache;

    return { ableExtension, md5Cache, isAbleChange, isMd5Change };
}

/**
 * 构建面板选项变更时立即校验 MD5 Cache
 */
export async function update(options: IBuildTaskOption, path: string, value: unknown) {
    const state = resolveState(options, path, value);
    if (!state.isAbleChange && !state.isMd5Change) {
        return;
    }

    const draftOptions: IBuildTaskOption = {
        ...options,
        md5Cache: state.md5Cache,
        packages: {
            ...options.packages,
            [PACKAGE_NAME]: {
                ...(options.packages?.[PACKAGE_NAME] as object),
                ableExtension: state.ableExtension,
            },
        },
    };

    if (!needsMd5CacheWarning(draftOptions)) {
        return;
    }

    try {
        await Editor.Dialog.error(MD5_REQUIRED_MESSAGE, { title: 'H5 Bundle Zipper' });
    } catch {
        // 面板环境异常时忽略
    }
}
