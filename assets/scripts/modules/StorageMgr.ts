import { sys } from "cc";
import { AES, Utf8 } from "crypto-es";

const STORAGE_VERSION = 1;
const PLAIN_PREFIX = "P1:";
const ENCRYPT_PREFIX = "E1:";

const DEFAULT_PREFIX = "egf_";
const DEFAULT_SECRET_KEY = "egf_texas";
const MAX_DOMAIN_LENGTH = 64;
const DOMAIN_PATTERN = /^[a-zA-Z0-9_-]+$/;

type StorageValueType = "string" | "number" | "boolean" | "object" | "null";

interface IStorageEnvelope {
    v: number;
    t: StorageValueType;
    d: unknown;
}

interface IStorageMgrConfig {
    /** 存储键前缀，用于隔离本游戏数据，默认 `egf_` */
    prefix?: string;
    /** AES 加密密钥 */
    secretKey?: string;
    /** 是否默认加密写入，默认 false */
    encrypt?: boolean;
    /** 是否启用内存缓存，默认 true */
    memoryCache?: boolean;
}

type StorageDomain = string | null | undefined;

interface ISetStorageOptions {
    /** 是否加密本条数据；未指定时使用全局 encrypt 配置 */
    encrypt?: boolean;
}

/**
 * 存储管理器
 *
 * - 基于 Cocos `sys.localStorage`，支持 Web / 原生
 * - 自动 JSON 序列化，支持 string / number / boolean / object
 * - 可选 AES 加密（全局或单条）
 * - 支持 domain 作用域隔离（多账号存档）
 * - 仅导出本类，通过 `m.storageMgr` 访问
 * - 逻辑键不得以 `__` 开头（系统保留）
 * 
 * @description
 * 类级：基础读写、domain 作用域、加密 3 个综合示例
 * @description
 * 配置：constructor、prefix、encrypt、setSecretKey、memoryCacheEnabled
 * @description
 * 写入：set / setString / setNumber / setBoolean / setObject / setBatch
 * @description
 * 读取：get / getString / getNumber / getBoolean / getObject / getArray / getBatch
 * @description
 * 管理：has / remove / removeBatch / keys / clear / clearMemoryCache
 * 
 * @example
 * // 基础读写
 * m.storageMgr.setString("player_name", "Alice");
 * m.storageMgr.setObject("settings", { music: true, sfx: false });
 * const name = m.storageMgr.getString("player_name");
 * const settings = m.storageMgr.getObject("settings");
 *
 * @example
 * // 多账号隔离
 * m.storageMgr.setNumber("coin", 999, undefined, "player_10001");
 * const coin = m.storageMgr.getNumber("coin", 0, "player_10001");
 *
 * @example
 * // 加密敏感数据
 * m.storageMgr.encrypt = true;
 * m.storageMgr.set("token", "secret-token");
 * m.storageMgr.set("pay_info", { id: 1 }, { encrypt: true }); // 单条加密
 */
export class StorageMgr implements egf.IModule {

    /** 模块标识，用于 egf 模块系统注册，固定值为 `"storageMgr"` */
    key = "storageMgr";

    private _prefix = DEFAULT_PREFIX;
    private _secretKey = DEFAULT_SECRET_KEY;
    private _encrypt = false;
    private _memoryCacheEnabled = true;

    private _cache = new Map<string, string | null>();
    private _destroyed = false;

    private static readonly INDEX_KEY = "__sys__.index";
    /** 旧版索引键，仅用于迁移 */
    private static readonly LEGACY_INDEX_KEY = "__index__";

    /**
     * @param config 可选初始化配置（也可在 onInit 前通过属性 setter 修改）
     * @example
     * new StorageMgr({
     *     prefix: "texas_",
     *     secretKey: "your-secret",
     *     encrypt: false,
     *     memoryCache: true,
     * });
     */
    constructor(config?: IStorageMgrConfig) {
        if (config) {
            this._applyConfig(config);
        }
    }

    /**
     * 模块初始化回调（egf.IModule）
     * @param _app 应用实例
     * @example
     * // 由框架自动调用，业务侧一般无需手动调用
     * // m.storageMgr.onInit(app);
     */
    onInit(_app?: egf.IApp): void {
        if (this._destroyed) {
            this._destroyed = false;
        }
    }

    /**
     * 模块卸载回调（egf.IModule）
     * 清空内存缓存，不删除 localStorage 数据
     * @example
     * // 由框架自动调用
     * // m.storageMgr.onStop();
     */
    onStop(): void {
        this._destroyed = true;
        this._cache.clear();
    }

    // ── 配置 ─────────────────────────────────────────────

    /** 当前存储键前缀（不含 domain 部分） */
    get prefix(): string {
        return this._prefix;
    }

    /**
     * 设置存储键前缀，最小长度 1
     * @param value 前缀字符串
     * @example
     * m.storageMgr.prefix = "texas_"; // 实际存储键形如 texas_xxx
     */
    set prefix(value: string) {
        const next = value?.trim();
        if (!next) {
            return;
        }
        this._prefix = next.endsWith("_") ? next : `${next}_`;
        this._cache.clear();
    }

    /** 是否默认加密新写入的数据 */
    get encrypt(): boolean {
        return this._encrypt;
    }

    /**
     * 设置是否默认加密新写入的数据
     * @param value true 开启默认加密
     * @example
     * m.storageMgr.encrypt = true;
     * m.storageMgr.set("token", "abc"); // 自动加密
     */
    set encrypt(value: boolean) {
        this._encrypt = value;
    }

    /** 是否启用内存读缓存 */
    get memoryCacheEnabled(): boolean {
        return this._memoryCacheEnabled;
    }

    /**
     * 设置是否启用内存读缓存
     * @param value true 启用缓存
     * @example
     * m.storageMgr.memoryCacheEnabled = false; // 关闭缓存，每次直读 localStorage
     */
    set memoryCacheEnabled(value: boolean) {
        this._memoryCacheEnabled = value;
        if (!value) {
            this._cache.clear();
        }
    }

    /**
     * 设置 AES 加密密钥（修改后仅影响新写入数据）
     * @param key 密钥字符串，不能为空
     * @example
     * m.storageMgr.setSecretKey("my-game-secret");
     */
    setSecretKey(key: string): void {
        const trimmed = key?.trim();
        if (!trimmed) {
            return;
        }
        this._secretKey = trimmed;
    }

    // ── 写入 ─────────────────────────────────────────────

    /**
     * 写入任意可序列化值
     * @param key 逻辑键名（不含前缀）
     * @param value 支持 string / number / boolean / object / null；传 undefined 等效于 remove(key)
     * @param options.encrypt 是否加密本条；未指定时使用全局 encrypt
     * @param domain 作用域；不传表示全局域
     * @returns 是否写入成功
     * @example
     * m.storageMgr.set("last_login", Date.now());
     * m.storageMgr.set("profile", { name: "Bob", vip: 2 }, undefined, "10001");
     * m.storageMgr.set("token", "xxx", { encrypt: true });
     */
    set(
        key: string,
        value: unknown,
        options: ISetStorageOptions = {},
        domain?: StorageDomain,
    ): boolean {
        if (this._destroyed) {
            return false;
        }
        const logicKey = this._normalizeKey(key);
        if (!logicKey) {
            return false;
        }
        if (value === undefined) {
            return this.remove(key, domain);
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
            console.warn(`[StorageMgr] set 失败: 数字不能为 NaN / Infinity (${logicKey})`);
            return false;
        }
        try {
            const envelope = this._createEnvelope(value);
            const json = JSON.stringify(envelope);
            const useEncrypt = options.encrypt ?? this._encrypt;
            const stored = useEncrypt
                ? ENCRYPT_PREFIX + this._encryptText(json)
                : PLAIN_PREFIX + json;
            return this._writeRaw(logicKey, stored, domain);
        } catch (err) {
            console.warn(`[StorageMgr] set 失败: ${logicKey}`, err);
            return false;
        }
    }

    /**
     * 写入字符串
     * @param key 逻辑键名
     * @param value 字符串值
     * @param options 写入选项
     * @returns 是否写入成功
     * @example
     * m.storageMgr.setString("player_name", "Alice");
     */
    setString(
        key: string,
        value: string,
        options?: ISetStorageOptions,
        domain?: StorageDomain,
    ): boolean {
        return this.set(key, value, options, domain);
    }

    /**
     * 写入数字
     * @param key 逻辑键名
     * @param value 数字值
     * @param options 写入选项
     * @returns 是否写入成功
     * @example
     * m.storageMgr.setNumber("coin", 999);
     */
    setNumber(
        key: string,
        value: number,
        options?: ISetStorageOptions,
        domain?: StorageDomain,
    ): boolean {
        return this.set(key, value, options, domain);
    }

    /**
     * 写入布尔值
     * @param key 逻辑键名
     * @param value 布尔值
     * @param options 写入选项
     * @returns 是否写入成功
     * @example
     * m.storageMgr.setBoolean("tutorial_done", true);
     */
    setBoolean(
        key: string,
        value: boolean,
        options?: ISetStorageOptions,
        domain?: StorageDomain,
    ): boolean {
        return this.set(key, value, options, domain);
    }

    /**
     * 写入对象（自动 JSON 序列化）
     * @param key 逻辑键名
     * @param value 对象值
     * @param options 写入选项
     * @returns 是否写入成功
     * @example
     * m.storageMgr.setObject("settings", { music: true, sfx: false, volume: 0.8 });
     */
    setObject<T extends object>(
        key: string,
        value: T,
        options?: ISetStorageOptions,
        domain?: StorageDomain,
    ): boolean {
        return this.set(key, value, options, domain);
    }

    /**
     * 批量写入
     * @param entries 键值对字典
     * @param options 写入选项（应用于每一条）
     * @returns 是否全部写入成功
     * @example
     * m.storageMgr.setBatch({ level: 10, exp: 2500, coin: 999 });
     */
    setBatch(
        entries: Record<string, unknown>,
        options?: ISetStorageOptions,
        domain?: StorageDomain,
    ): boolean {
        let ok = true;
        for (const [key, value] of Object.entries(entries)) {
            if (!this.set(key, value, options, domain)) {
                ok = false;
            }
        }
        return ok;
    }

    // ── 读取 ─────────────────────────────────────────────

    /**
     * 读取并反序列化值
     * @param key 逻辑键名
     * @param defaultValue 键不存在或数据损坏时的默认值
     * @param domain 作用域；不传表示全局域
     * @returns 反序列化后的值或 defaultValue
     * @example
     * const loginAt = m.storageMgr.get<number>("last_login", 0);
     * const profile = m.storageMgr.get<{ name: string }>("profile");
     */
    get<T = unknown>(key: string, defaultValue?: T, domain?: StorageDomain): T | null | undefined {
        if (this._destroyed) {
            return defaultValue;
        }
        const logicKey = this._normalizeKey(key);
        if (!logicKey) {
            return defaultValue;
        }
        const envelope = this._readEnvelope(logicKey, domain);
        if (!envelope) {
            return defaultValue;
        }
        if (envelope.t === "null") {
            return null;
        }
        return envelope.d as T;
    }

    /**
     * 读取字符串
     * @param key 逻辑键名
     * @param defaultValue 默认值，默认 `""`
     * @returns 字符串值
     * @example
     * const name = m.storageMgr.getString("player_name", "Guest");
     */
    getString(key: string, defaultValue = "", domain?: StorageDomain): string {
        const value = this.get<string>(key, undefined, domain);
        return typeof value === "string" ? value : defaultValue;
    }

    /**
     * 读取数字
     * @param key 逻辑键名
     * @param defaultValue 默认值，默认 0
     * @returns 数字值
     * @example
     * const coin = m.storageMgr.getNumber("coin", 0);
     */
    getNumber(key: string, defaultValue = 0, domain?: StorageDomain): number {
        const value = this.get<number>(key, undefined, domain);
        return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
    }

    /**
     * 读取布尔值
     * @param key 逻辑键名
     * @param defaultValue 默认值，默认 false
     * @returns 布尔值
     * @example
     * const done = m.storageMgr.getBoolean("tutorial_done", false);
     */
    getBoolean(key: string, defaultValue = false, domain?: StorageDomain): boolean {
        const value = this.get<boolean>(key, undefined, domain);
        return typeof value === "boolean" ? value : defaultValue;
    }

    /**
     * 读取对象
     * @param key 逻辑键名
     * @param defaultValue 默认值，默认 null
     * @returns 对象或 defaultValue
     * @example
     * interface ISettings { music: boolean; sfx: boolean }
     * const settings = m.storageMgr.getObject<ISettings>("settings", { music: true, sfx: true });
     */
    getObject<T extends object>(
        key: string,
        defaultValue: T | null = null,
        domain?: StorageDomain,
    ): T | null {
        const value = this.get<T>(key, undefined, domain);
        if (value !== null && typeof value === "object") {
            return value;
        }
        return defaultValue;
    }

    /**
     * 读取数组
     * @param key 逻辑键名
     * @param defaultValue 默认值，默认 `[]`
     * @returns 数组或 defaultValue
     * @example
     * const ids = m.storageMgr.getArray<number>("completed_levels", []);
     */
    getArray<T>(key: string, defaultValue: T[] = [], domain?: StorageDomain): T[] {
        const value = this.get<unknown>(key, undefined, domain);
        return Array.isArray(value) ? (value as T[]) : defaultValue;
    }

    /**
     * 批量读取
     * @param keys 逻辑键名列表
     * @returns 键值对字典（不存在的键不会出现在结果中）
     * @example
     * const data = m.storageMgr.getBatch<number>(["level", "exp", "coin"]);
     * // { level: 10, exp: 2500, coin: 999 }
     */
    getBatch<T = unknown>(keys: string[], domain?: StorageDomain): Record<string, T> {
        if (this._destroyed) {
            return {};
        }
        const result: Record<string, T> = {};
        for (const key of keys) {
            const logicKey = this._normalizeKey(key);
            if (!logicKey) {
                continue;
            }
            const envelope = this._readEnvelope(logicKey, domain);
            if (envelope) {
                result[key] = envelope.d as T;
            }
        }
        return result;
    }

    // ── 管理 ─────────────────────────────────────────────

    /**
     * 判断键是否存在
     * @param key 逻辑键名
     * @returns 存在返回 true
     * @example
     * if (m.storageMgr.has("player_name")) { ... }
     */
    has(key: string, domain?: StorageDomain): boolean {
        if (this._destroyed) {
            return false;
        }
        const logicKey = this._normalizeKey(key);
        if (!logicKey) {
            return false;
        }
        return this._readRaw(logicKey, domain) !== null;
    }

    /**
     * 删除指定键
     * @param key 逻辑键名
     * @returns 是否删除成功；键不存在时视为成功；模块已卸载或发生异常时返回 false
     * @example
     * m.storageMgr.remove("temp_token");
     */
    remove(key: string, domain?: StorageDomain): boolean {
        if (this._destroyed) {
            return false;
        }
        const logicKey = this._normalizeKey(key);
        if (!logicKey) {
            return false;
        }
        const storageKey = this._buildStorageKey(logicKey, domain);
        if (!storageKey) {
            return false;
        }
        try {
            if (this._readRaw(logicKey, domain) === null) {
                return true;
            }
            sys.localStorage.removeItem(storageKey);
            this._cache.delete(storageKey);
            this._removeIndexKey(logicKey, domain);
            return true;
        } catch (err) {
            console.warn(`[StorageMgr] remove 失败: ${logicKey}`, err);
            return false;
        }
    }

    /**
     * 批量删除
     * @param keys 逻辑键名列表
     * @returns 是否全部删除成功
     * @example
     * m.storageMgr.removeBatch(["temp_a", "temp_b"]);
     */
    removeBatch(keys: string[], domain?: StorageDomain): boolean {
        let ok = true;
        for (const key of keys) {
            if (!this.remove(key, domain)) {
                ok = false;
            }
        }
        return ok;
    }

    /**
     * 列出指定 domain 下所有逻辑键名（不含前缀与 domain）
     * @param domain 作用域；不传表示全局域
     * @returns 逻辑键名数组
     * @example
     * const allKeys = m.storageMgr.keys();
     * // ["player_name", "coin", "settings", ...]
     */
    keys(domain?: StorageDomain): string[] {
        if (this._destroyed) {
            return [];
        }
        const index = this._readIndex(domain);
        return [...index];
    }

    /**
     * 清空指定 domain 下所有数据（仅删除带本管理器前缀的键）
     * @param domain 作用域；不传表示全局域
     * @returns 是否清空成功
     * @example
     * m.storageMgr.clear(); // 清空全局域
     * m.storageMgr.clear("player_10001"); // 清空指定作用域
     */
    clear(domain?: StorageDomain): boolean {
        if (this._destroyed) {
            return false;
        }
        const allKeys = this.keys(domain);
        let ok = this.removeBatch(allKeys, domain);
        const indexKey = this._buildStorageKey(StorageMgr.INDEX_KEY, domain);
        if (!indexKey) {
            return false;
        }
        try {
            sys.localStorage.removeItem(indexKey);
            this._cache.delete(indexKey);
        } catch {
            ok = false;
        }
        return ok;
    }

    /**
     * 清空内存缓存，不影响 localStorage
     * @param domain 作用域；不传表示清空全部内存缓存
     * @example
     * m.storageMgr.clearMemoryCache(); // 下次读取会重新从 localStorage 加载
     */
    clearMemoryCache(domain?: StorageDomain): void {
        if (domain === undefined) {
            this._cache.clear();
            return;
        }
        const storagePrefix = this._buildStoragePrefix(domain);
        if (!storagePrefix) {
            return;
        }
        for (const key of [...this._cache.keys()]) {
            if (key.startsWith(storagePrefix)) {
                this._cache.delete(key);
            }
        }
    }

    // ── 内部：配置与键 ───────────────────────────────────

    private _applyConfig(config: IStorageMgrConfig): void {
        if (config.prefix !== undefined) {
            this.prefix = config.prefix;
        }
        if (config.secretKey !== undefined) {
            this.setSecretKey(config.secretKey);
        }
        if (config.encrypt !== undefined) {
            this._encrypt = config.encrypt;
        }
        if (config.memoryCache !== undefined) {
            this.memoryCacheEnabled = config.memoryCache;
        }
    }

    private _normalizeKey(key: string): string | null {
        const trimmed = key?.trim();
        if (!trimmed) {
            console.warn("[StorageMgr] key 不能为空");
            return null;
        }
        if (this._isReservedKey(trimmed)) {
            console.warn(`[StorageMgr] 保留键不可使用: ${trimmed}`);
            return null;
        }
        return trimmed;
    }

    private _isReservedKey(key: string): boolean {
        return key.startsWith("__");
    }

    private _normalizeDomain(domain: StorageDomain): string | null | false {
        if (domain === undefined || domain === null || domain.trim() === "") {
            return null;
        }
        const trimmed = domain.trim();
        if (!trimmed) {
            return null;
        }
        if (trimmed.length > MAX_DOMAIN_LENGTH) {
            console.warn(`[StorageMgr] domain 过长（最大 ${MAX_DOMAIN_LENGTH}）`);
            return false;
        }
        if (!DOMAIN_PATTERN.test(trimmed)) {
            console.warn("[StorageMgr] domain 仅允许字母、数字、下划线、连字符");
            return false;
        }
        return trimmed;
    }

    private _buildStoragePrefix(domain: StorageDomain): string | null {
        const normalizedDomain = this._normalizeDomain(domain);
        if (normalizedDomain === false) {
            return null;
        }
        const domainPart = normalizedDomain ? `d_${normalizedDomain}_` : "";
        return `${this._prefix}${domainPart}`;
    }

    private _buildStorageKey(logicKey: string, domain: StorageDomain): string | null {
        const prefix = this._buildStoragePrefix(domain);
        return prefix ? `${prefix}${logicKey}` : null;
    }

    // ── 内部：序列化 ─────────────────────────────────────

    private _createEnvelope(value: unknown): IStorageEnvelope {
        if (value === null) {
            return { v: STORAGE_VERSION, t: "null", d: null };
        }
        const type = typeof value;
        if (type === "string" || type === "number" || type === "boolean") {
            return { v: STORAGE_VERSION, t: type, d: value };
        }
        if (type === "object") {
            return { v: STORAGE_VERSION, t: "object", d: value };
        }
        return {
            v: STORAGE_VERSION,
            t: "string",
            d: String(value),
        };
    }

    private _parseEnvelope(json: string): IStorageEnvelope | null {
        try {
            const parsed = JSON.parse(json) as IStorageEnvelope;
            if (!parsed || typeof parsed !== "object" || parsed.v !== STORAGE_VERSION) {
                return null;
            }
            if (!parsed.t || !("d" in parsed)) {
                return null;
            }
            if (!this._validateEnvelopeType(parsed)) {
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    }

    private _validateEnvelopeType(envelope: IStorageEnvelope): boolean {
        const { t, d } = envelope;
        switch (t) {
            case "null":
                return d === null;
            case "string":
                return typeof d === "string";
            case "number":
                return typeof d === "number";
            case "boolean":
                return typeof d === "boolean";
            case "object":
                return d !== null && typeof d === "object";
            default:
                return false;
        }
    }

    private _readEnvelope(logicKey: string, domain: StorageDomain): IStorageEnvelope | null {
        const raw = this._readRaw(logicKey, domain);
        if (raw === null) {
            return null;
        }

        let json: string | null = null;
        if (raw.startsWith(ENCRYPT_PREFIX)) {
            json = this._decryptText(raw.slice(ENCRYPT_PREFIX.length));
        } else if (raw.startsWith(PLAIN_PREFIX)) {
            json = raw.slice(PLAIN_PREFIX.length);
        } else {
            // 兼容旧版纯 JSON 或明文
            json = raw;
        }

        const envelope = json ? this._parseEnvelope(json) : null;
        if (!envelope) {
            console.warn(`[StorageMgr] 数据损坏，已自动清理: ${logicKey}`);
            this._purgeCorruptEntry(logicKey, domain);
            return null;
        }
        return envelope;
    }

    private _purgeCorruptEntry(logicKey: string, domain: StorageDomain): void {
        const storageKey = this._buildStorageKey(logicKey, domain);
        if (!storageKey) {
            return;
        }
        try {
            sys.localStorage.removeItem(storageKey);
            this._cache.delete(storageKey);
            this._removeIndexKey(logicKey, domain);
        } catch (err) {
            console.warn(`[StorageMgr] 清理损坏数据失败: ${logicKey}`, err);
        }
    }

    // ── 内部：读写 localStorage ──────────────────────────

    private _readRaw(logicKey: string, domain: StorageDomain): string | null {
        const storageKey = this._buildStorageKey(logicKey, domain);
        if (!storageKey) {
            return null;
        }
        if (this._memoryCacheEnabled && this._cache.has(storageKey)) {
            return this._cache.get(storageKey) ?? null;
        }
        try {
            const value = sys.localStorage.getItem(storageKey);
            const normalized = value === "" ? null : value;
            if (this._memoryCacheEnabled) {
                this._cache.set(storageKey, normalized);
            }
            return normalized;
        } catch (err) {
            console.warn(`[StorageMgr] getItem 失败: ${logicKey}`, err);
            return null;
        }
    }

    private _writeRaw(logicKey: string, value: string, domain: StorageDomain): boolean {
        if (this._destroyed) {
            return false;
        }
        const storageKey = this._buildStorageKey(logicKey, domain);
        if (!storageKey) {
            return false;
        }
        let previous: string | null = null;
        try {
            previous = sys.localStorage.getItem(storageKey);
            if (previous === "") {
                previous = null;
            }
        } catch {
            previous = null;
        }

        try {
            sys.localStorage.setItem(storageKey, value);
            if (!this._addIndexKey(logicKey, domain)) {
                if (previous === null) {
                    sys.localStorage.removeItem(storageKey);
                } else {
                    sys.localStorage.setItem(storageKey, previous);
                }
                this._cache.delete(storageKey);
                return false;
            }
            if (this._memoryCacheEnabled) {
                this._cache.set(storageKey, value);
            }
            return true;
        } catch (err) {
            console.warn(`[StorageMgr] setItem 失败: ${logicKey}`, err);
            return false;
        }
    }

    private _readIndex(domain: StorageDomain): Set<string> {
        const index = this._readIndexByLogicKey(StorageMgr.INDEX_KEY, domain);
        if (index.size > 0) {
            return index;
        }
        const legacy = this._readIndexByLogicKey(StorageMgr.LEGACY_INDEX_KEY, domain);
        if (legacy.size === 0) {
            return index;
        }
        if (this._saveIndex(legacy, domain)) {
            this._purgeStorageEntry(StorageMgr.LEGACY_INDEX_KEY, domain);
        }
        return legacy;
    }

    private _readIndexByLogicKey(indexLogicKey: string, domain: StorageDomain): Set<string> {
        const storageKey = this._buildStorageKey(indexLogicKey, domain);
        if (!storageKey) {
            return new Set();
        }
        if (this._memoryCacheEnabled && this._cache.has(storageKey)) {
            return this._parseIndex(this._cache.get(storageKey));
        }
        try {
            const raw = sys.localStorage.getItem(storageKey);
            if (this._memoryCacheEnabled) {
                this._cache.set(storageKey, raw === "" ? null : raw);
            }
            return this._parseIndex(raw);
        } catch {
            return new Set();
        }
    }

    private _purgeStorageEntry(logicKey: string, domain: StorageDomain): void {
        const storageKey = this._buildStorageKey(logicKey, domain);
        if (!storageKey) {
            return;
        }
        try {
            sys.localStorage.removeItem(storageKey);
            this._cache.delete(storageKey);
        } catch {
            // ignore
        }
    }

    private _parseIndex(raw: string | null | undefined): Set<string> {
        if (!raw) {
            return new Set();
        }
        try {
            const list = JSON.parse(raw) as string[];
            if (!Array.isArray(list)) {
                return new Set();
            }
            return new Set(
                list.filter((k) => {
                    if (typeof k !== "string" || !k.trim()) {
                        return false;
                    }
                    return !this._isReservedKey(k.trim());
                }),
            );
        } catch {
            return new Set();
        }
    }

    private _saveIndex(index: Set<string>, domain: StorageDomain): boolean {
        const storageKey = this._buildStorageKey(StorageMgr.INDEX_KEY, domain);
        if (!storageKey) {
            return false;
        }
        const json = JSON.stringify([...index]);
        try {
            sys.localStorage.setItem(storageKey, json);
            if (this._memoryCacheEnabled) {
                this._cache.set(storageKey, json);
            }
            return true;
        } catch (err) {
            console.warn("[StorageMgr] 索引保存失败", err);
            return false;
        }
    }

    private _addIndexKey(logicKey: string, domain: StorageDomain): boolean {
        if (this._isReservedKey(logicKey)) {
            return false;
        }
        const index = this._readIndex(domain);
        if (index.has(logicKey)) {
            return true;
        }
        index.add(logicKey);
        return this._saveIndex(index, domain);
    }

    private _removeIndexKey(logicKey: string, domain: StorageDomain): void {
        const index = this._readIndex(domain);
        if (index.delete(logicKey)) {
            this._saveIndex(index, domain);
        }
    }

    // ── 内部：加密 ───────────────────────────────────────

    private _encryptText(plain: string): string {
        return AES.encrypt(plain, this._secretKey).toString();
    }

    private _decryptText(cipher: string): string | null {
        try {
            const result = AES.decrypt(cipher, this._secretKey).toString(Utf8);
            return result || null;
        } catch (err) {
            console.warn("[StorageMgr] 解密失败", err);
            return null;
        }
    }
}
