import {
    Asset,
    assetManager,
    AssetManager,
    resources,
} from "cc";

interface ILoadAssetOptions {
    /** 是否走缓存与引用计数 */
    useCache: boolean;
}

interface IAssetLoadItem<TType extends typeof Asset = typeof Asset> {
    /** 资源路径（相对于 bundle） */
    path: string;
    /** 资源类型 */
    type: TType;
    /** bundle name */
    bundle: string;
}

type AssetOf<TItem extends IAssetLoadItem> =
    TItem["type"] extends { prototype: infer TAsset }
        ? TAsset extends Asset
            ? TAsset
            : Asset
        : Asset;

type AssetBatchResult<TItems extends readonly IAssetLoadItem[]> = {
    -readonly [K in keyof TItems]: AssetOf<TItems[K]> | null;
};

interface ICacheEntry {
    asset: Asset;
    refCount: number;
}

interface IInflightLoad {
    promise: Promise<Asset | null>;
}

/**
 * 资源管理器
 *
 * - 从 resources / Asset Bundle 加载资源
 * - 内存缓存 + 引用计数，支持 load / release 配对
 * - 同资源（bundle + path + type）并发加载去重
 * - 仅导出本类，通过 `m.assetMgr` 访问
 *
 * @example
 * const prefab = await m.assetMgr.load(
 *     { path: "prefabs/hero", type: Prefab, bundle: "resources" },
 *     { useCache: true },
 * );
 *
 * @example
 * const clip = await m.assetMgr.load(
 *     { path: "audio/bgm", type: AudioClip, bundle: "game" },
 *     { useCache: true },
 * );
 * m.assetMgr.release({ path: "audio/bgm", type: AudioClip, bundle: "game" });
 */
export class AssetMgr implements egf.IModule {

    /** 模块标识，固定值为 `"assetMgr"` */
    key = "assetMgr";

    private _cache = new Map<string, ICacheEntry>();
    private _cacheGenerations = new Map<string, number>();
    private _loadingPromises = new Map<string, IInflightLoad>();
    private _bundleCache = new Map<string, AssetManager.Bundle>();
    private _destroyed = false;

    /**
     * 模块初始化回调（egf.IModule）
     */
    onInit(_app?: egf.IApp): void {
        if (this._destroyed) {
            this._destroyed = false;
        }
        console.log("[AssetMgr] onInit");
    }

    /**
     * 模块卸载回调（egf.IModule）
     * 释放全部缓存引用
     */
    onStop(): void {
        this._destroyed = true;
        this.releaseAll();
        this._loadingPromises.clear();
        this._cacheGenerations.clear();
        this._bundleCache.clear();
        console.log("[AssetMgr] onStop");
    }

    /**
     * 加载单个资源
     * @param item 资源项，需明确传入 path / type / bundle
     * @param options 加载选项
     * @returns 资源实例；失败返回 null
     * @example
     * const prefab = await m.assetMgr.load(
     *     { path: "ui/home", type: Prefab, bundle: "resources" },
     *     { useCache: true },
     * );
     */
    load<TItem extends IAssetLoadItem>(
        item: TItem,
        options: ILoadAssetOptions,
    ): Promise<AssetOf<TItem> | null> {
        const normalized = this._normalizeLoadItem(item);
        if (!normalized) {
            return Promise.resolve(null);
        }
        if (this._destroyed) {
            return Promise.resolve(null);
        }

        const useCache = options.useCache;
        const cacheKey = this._cacheKey(normalized);

        if (useCache) {
            const cached = this._cache.get(cacheKey);
            if (cached) {
                cached.refCount++;
                return Promise.resolve(cached.asset as AssetOf<TItem>);
            }

            const inflight = this._loadingPromises.get(cacheKey);
            if (inflight) {
                return this._trackCachedRef<AssetOf<TItem>>(cacheKey, inflight.promise);
            }
        }

        const loadGen = this._cacheGenerations.get(cacheKey) ?? 0;
        const promise = this._doLoad<TItem>(
            normalized,
            useCache,
            cacheKey,
            loadGen,
        );
        if (useCache) {
            const entry: IInflightLoad = { promise: this._trackCachedRef(cacheKey, promise) };
            this._loadingPromises.set(cacheKey, entry);
            entry.promise.finally(() => {
                const current = this._loadingPromises.get(cacheKey);
                if (current === entry) {
                    this._loadingPromises.delete(cacheKey);
                }
            });
            return entry.promise as Promise<AssetOf<TItem> | null>;
        }
        return promise;
    }

    /**
     * 批量加载资源
     * @param items 资源列表
     * @returns 与入参顺序对应的资源数组，失败项为 null
     * @example
     * const [hero, item] = await m.assetMgr.loadBatch([
     *     { path: "prefabs/hero", type: Prefab, bundle: "resources" },
     *     { path: "prefabs/item", type: Prefab, bundle: "resources" },
     * ]);
     */
    async loadBatch<TItems extends readonly IAssetLoadItem[]>(
        items: TItems,
    ): Promise<AssetBatchResult<TItems>> {
        const assets = await Promise.all(items.map((item) => this.load(item, { useCache: true })));
        return assets as AssetBatchResult<TItems>;
    }

    /**
     * 获取已缓存资源（不增加引用计数）
     * @param item 资源项，需明确传入 path / type / bundle
     */
    get<TItem extends IAssetLoadItem>(item: TItem): AssetOf<TItem> | null {
        const cacheKey = this._resolveCacheKey(item);
        if (!cacheKey) {
            return null;
        }
        return (this._cache.get(cacheKey)?.asset as AssetOf<TItem>) ?? null;
    }

    /**
     * 资源是否已缓存
     * @param item 资源项，需明确传入 path / type / bundle
     */
    has(item: IAssetLoadItem): boolean {
        const cacheKey = this._resolveCacheKey(item);
        return cacheKey ? this._cache.has(cacheKey) : false;
    }

    /**
     * 释放资源引用；引用计数归零时从缓存移除并 decRef
     * @param item 资源项，需明确传入 path / type / bundle
     * @returns 是否成功释放一次引用
     * @example
     * m.assetMgr.release({ path: "ui/home", type: Prefab, bundle: "resources" });
     */
    release(item: IAssetLoadItem): boolean {
        const cacheKey = this._resolveCacheKey(item);
        if (!cacheKey) {
            return false;
        }
        return this._releaseByCacheKey(cacheKey);
    }

    /**
     * 批量释放资源引用
     * @param items 资源列表，结构与 loadBatch 入参一致
     * @returns 与入参顺序对应的释放结果
     * @example
     * const results = m.assetMgr.releaseBatch([
     *     { path: "prefabs/hero", type: Prefab, bundle: "resources" },
     *     { path: "prefabs/item", type: Prefab, bundle: "resources" },
     * ]);
     */
    releaseBatch(items: IAssetLoadItem[]): boolean[] {
        return items.map((item) => this.release(item));
    }

    /**
     * 释放全部缓存资源
     */
    releaseAll(): void {
        const keys = new Set([
            ...this._cache.keys(),
            ...this._loadingPromises.keys(),
        ]);
        for (const cacheKey of keys) {
            this._bumpGeneration(cacheKey);
        }
        for (const entry of this._cache.values()) {
            this._forceReleaseAsset(entry.asset);
        }
        this._cache.clear();
        this._loadingPromises.clear();
    }

    private async _doLoad<TItem extends IAssetLoadItem>(
        item: TItem,
        useCache: boolean,
        cacheKey: string,
        loadGen: number,
    ): Promise<AssetOf<TItem> | null> {
        const asset = await this._loadFromEngine<TItem>(item);
        if (!asset) {
            return null;
        }
        if (this._destroyed) {
            asset.decRef();
            return null;
        }
        if (!useCache) {
            return asset;
        }
        if ((this._cacheGenerations.get(cacheKey) ?? 0) !== loadGen) {
            asset.decRef();
            return null;
        }
        const existing = this._cache.get(cacheKey);
        if (existing) {
            asset.decRef();
            return existing.asset as AssetOf<TItem>;
        }
        asset.addRef();
        this._cache.set(cacheKey, { asset, refCount: 0 });
        return asset;
    }

    private _trackCachedRef<T extends Asset>(
        cacheKey: string,
        promise: Promise<Asset | null>,
    ): Promise<T | null> {
        return promise.then((asset) => {
            if (asset) {
                this._acquireCached(cacheKey);
            }
            return asset as T | null;
        });
    }

    private _acquireCached(cacheKey: string): void {
        const entry = this._cache.get(cacheKey);
        if (entry) {
            entry.refCount++;
            return;
        }
        console.warn(`[AssetMgr] 缓存引用失败，资源可能已释放: ${cacheKey}`);
    }

    private _loadFromEngine<TItem extends IAssetLoadItem>(
        item: TItem,
    ): Promise<AssetOf<TItem> | null> {
        if (this._destroyed) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            const onLoaded = (err: Error | null, asset: Asset | null) => {
                if (this._destroyed) {
                    asset?.decRef();
                    resolve(null);
                    return;
                }
                if (err || !asset) {
                    console.warn(`[AssetMgr] 加载失败: ${item.bundle}://${item.path}`, err);
                    resolve(null);
                    return;
                }
                resolve(asset as AssetOf<TItem>);
            };

            if (item.bundle === "resources") {
                resources.load(item.path, item.type, onLoaded);
                return;
            }

            const cachedBundle = this._bundleCache.get(item.bundle);
            if (cachedBundle) {
                cachedBundle.load(item.path, item.type, onLoaded);
                return;
            }

            assetManager.loadBundle(item.bundle, (err, b) => {
                if (this._destroyed) {
                    resolve(null);
                    return;
                }
                if (err || !b) {
                    console.warn(`[AssetMgr] Bundle 加载失败: ${item.bundle}`, err);
                    resolve(null);
                    return;
                }
                this._bundleCache.set(item.bundle, b);
                b.load(item.path, item.type, onLoaded);
            });
        });
    }

    private _bumpGeneration(cacheKey: string): number {
        const next = (this._cacheGenerations.get(cacheKey) ?? 0) + 1;
        this._cacheGenerations.set(cacheKey, next);
        return next;
    }

    private _releaseByCacheKey(cacheKey: string): boolean {
        const entry = this._cache.get(cacheKey);
        if (entry) {
            if (entry.refCount <= 0) {
                console.warn(`[AssetMgr] 重复释放: ${cacheKey}`);
                return false;
            }
            entry.refCount--;
            if (entry.refCount <= 0) {
                this._forceReleaseAsset(entry.asset);
                this._cache.delete(cacheKey);
                this._bumpGeneration(cacheKey);
                this._loadingPromises.delete(cacheKey);
            }
            return true;
        }
        if (this._loadingPromises.has(cacheKey)) {
            this._bumpGeneration(cacheKey);
            this._loadingPromises.delete(cacheKey);
            return true;
        }
        return false;
    }

    private _forceReleaseAsset(asset: Asset): void {
        let remaining = asset.refCount;
        while (asset.refCount > 0 && remaining > 0) {
            asset.decRef();
            remaining--;
        }
        if (asset.refCount > 0) {
            console.warn(`[AssetMgr] 强制释放资源失败，仍有引用: ${asset.name}`, asset.refCount);
        }
    }

    private _cacheKey(item: IAssetLoadItem): string {
        const typeName = this._typeKey(item.type);
        return `${item.bundle}://${item.path}|${typeName}`;
    }

    private _typeKey(type: typeof Asset): string {
        const ccType = type as typeof Asset & { __classname__?: string };
        return ccType.__classname__ || type.name || "Asset";
    }

    private _resolveCacheKey(item: IAssetLoadItem): string | null {
        const normalized = this._normalizeLoadItem(item);
        return normalized ? this._cacheKey(normalized) : null;
    }

    private _normalizeLoadItem<TItem extends IAssetLoadItem>(item: TItem): TItem | null {
        const path = item?.path?.trim();
        if (!path) {
            console.warn("[AssetMgr] path 不能为空");
            return null;
        }
        const bundle = item.bundle?.trim();
        if (!bundle) {
            console.warn(`[AssetMgr] bundle 不能为空: ${path}`);
            return null;
        }
        if (!item.type) {
            console.warn(`[AssetMgr] type 不能为空: ${bundle}://${path}`);
            return null;
        }
        return {
            path,
            type: item.type,
            bundle,
        } as TItem;
    }
}
