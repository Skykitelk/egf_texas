import {
    assetManager,
    AssetManager,
    resources,
    TextAsset,
} from "cc";

const TYPE_KEYWORDS = new Set([
    "int", "integer", "number", "float", "double",
    "string", "str", "bool", "boolean",
]);

interface ILoadCsvOptions {
    /**
     * 第二行是否为类型行
     * - `auto`（默认）：自动检测
     * - `true` / `false`：强制指定
     */
    typeRow?: boolean | "auto";
    /**
     * 第二行是否为英文字段名行（常见配表：中文表头 + 字段名 + 类型 + 数据）
     * - `auto`（默认）：第二行为标识符且第三行为类型行时自动启用
     * - `true` / `false`：强制指定
     */
    fieldRow?: boolean | "auto";
    /** 行主键列名，默认 `id`，若无该列则使用第一列 */
    keyField?: string;
    /** 是否跳过空行与 `#` 开头注释行，默认 true */
    skipComments?: boolean;
    /**
     * 类型转换失败时是否输出警告（非法数字/布尔等），默认 true
     */
    warnOnConvertError?: boolean;
}

interface ICsvTableItem {
    /** 表逻辑名（缓存键） */
    name: string;
    /** bundle name */
    bundle: string;
}

interface ICsvLoadItem extends ICsvTableItem {
    /** CSV 资源路径（相对 bundle，不含 `.csv` 扩展名） */
    path: string;
}

interface ICsvRow {
    readonly [field: string]: string | number | boolean;
}

interface ICsvTable {
    /** 表名（加载时的逻辑名） */
    readonly name: string;
    /** 列名 */
    readonly headers: readonly string[];
    /** 全部数据行 */
    readonly rows: readonly ICsvRow[];
    /**
     * 按主键获取一行
     * @param id 主键值
     */
    get(id: string | number): ICsvRow | null;
    /** 获取全部行 */
    getAll(): readonly ICsvRow[];
    /** 是否存在指定主键 */
    has(id: string | number): boolean;
    /** 遍历所有行 */
    forEach(callback: (row: ICsvRow, index: number) => void): void;
}

class CsvTable implements ICsvTable {
    readonly name: string;
    readonly headers: readonly string[];
    readonly rows: readonly ICsvRow[];

    private _keyField: string;
    private _rowMap = new Map<string, ICsvRow>();

    constructor(name: string, headers: string[], rows: ICsvRow[], keyField: string) {
        this.name = name;
        this.headers = [...headers];
        this.rows = rows;
        this._keyField = keyField;
        for (const row of rows) {
            const key = row[keyField];
            if (key !== undefined && key !== null && key !== "") {
                const strKey = String(key);
                if (this._rowMap.has(strKey)) {
                    throw new Error(`[CsvMgr] 表 "${name}" 主键重复: ${strKey}`);
                }
                this._rowMap.set(strKey, row);
            }
        }
    }

    get(id: string | number): ICsvRow | null {
        return this._rowMap.get(String(id)) ?? null;
    }

    getAll(): readonly ICsvRow[] {
        return this.rows;
    }

    has(id: string | number): boolean {
        return this._rowMap.has(String(id));
    }

    forEach(callback: (row: ICsvRow, index: number) => void): void {
        this.rows.forEach(callback);
    }
}

interface IInflightLoad {
    promise: Promise<ICsvTable | null>;
    sourceKey: string;
}

/**
 * CSV 管理器
 *
 * - 从 resources / Asset Bundle 加载 TextAsset 并解析
 * - 支持引号字段、注释行、类型行（常见配表：表头 + 类型 + 数据）
 * - 支持四行配表：中文表头 + 英文字段名 + 类型 + 数据（`fieldRow` 自动检测）
 * - 解析结果按表逻辑名缓存；同名同来源命中缓存，来源变更时重新加载并告警
 * - 仅导出本类，通过 `m.csvMgr` 访问
 *
 * @example
 * // 加载并查询（路径相对 bundle，不含扩展名）
 * const table = await m.csvMgr.load({ name: "hero", path: "config/hero", bundle: "resources" });
 * const hero = table?.get(1001);
 *
 * @example
 * // 直接解析字符串
 * const table = m.csvMgr.parse({ name: "hero", bundle: "resources" }, csvText, { typeRow: true });
 */
export class CsvMgr implements egf.IModule {

    /** 模块标识，固定值为 `"csvMgr"` */
    key = "csvMgr";

    private _tables = new Map<string, ICsvTable>();
    private _tableSources = new Map<string, string>();
    private _tableGenerations = new Map<string, number>();
    private _loadingPromises = new Map<string, IInflightLoad>();
    private _bundleCache = new Map<string, AssetManager.Bundle>();
    private _destroyed = false;

    /**
     * 模块初始化回调（egf.IModule）
     * @param _app 应用实例
     */
    onInit(_app?: egf.IApp): void {
        if (this._destroyed) {
            this._destroyed = false;
        }
        console.log("CsvMgr onInit");
    }

    /**
     * 模块卸载回调（egf.IModule）
     * 清空内存缓存，并清理本模块缓存的 bundle 引用
     */
    onStop(): void {
        this._destroyed = true;
        this._tables.clear();
        this._tableSources.clear();
        this._tableGenerations.clear();
        this._loadingPromises.clear();
        this._releaseLoadedBundles();
        console.log("CsvMgr onStop");
    }

    /**
     * 异步加载并解析 CSV
     * @param item CSV 资源项（name + path + bundle）
     * @param options 加载与解析选项
     * @returns 解析后的表；失败返回 null
     * @example
     * const heroTable = await m.csvMgr.load({ name: "hero", path: "config/hero", bundle: "resources" });
     * const row = heroTable?.get(1);
     */
    async load(
        item: ICsvLoadItem,
        options: ILoadCsvOptions = {},
    ): Promise<ICsvTable | null> {
        const normalized = this._normalizeLoadItem(item);
        if (!normalized) {
            return null;
        }
        const tableName = normalized.name;
        const tableKey = this._tableKey(normalized);
        if (this._destroyed) {
            return null;
        }
        const sourceKey = this._sourceKey(normalized, options);
        const cached = this._tables.get(tableKey);
        if (cached && this._tableSources.get(tableKey) === sourceKey) {
            return cached;
        }
        if (cached) {
            console.warn(
                `[CsvMgr] 表 "${tableKey}" 已缓存为不同来源，将重新加载: `
                + `${this._tableSources.get(tableKey)} -> ${sourceKey}`,
            );
            this._tables.delete(tableKey);
            this._tableSources.delete(tableKey);
        }

        const inflight = this._loadingPromises.get(tableKey);
        if (inflight?.sourceKey === sourceKey) {
            return inflight.promise;
        }
        if (inflight) {
            console.warn(
                `[CsvMgr] 表 "${tableKey}" 进行中的加载来源与本次不一致，将取消并重新加载: `
                + `${inflight.sourceKey} -> ${sourceKey}`,
            );
            this._cancelInflight(tableKey);
        }

        const loadGen = this._bumpGeneration(tableKey);
        const entry: IInflightLoad = {
            promise: Promise.resolve(null),
            sourceKey,
        };
        entry.promise = this._doLoad(normalized, options, sourceKey, loadGen).finally(() => {
            const current = this._loadingPromises.get(tableKey);
            if (current === entry) {
                this._loadingPromises.delete(tableKey);
            }
        });
        this._loadingPromises.set(tableKey, entry);
        return entry.promise;
    }

    /**
     * 批量加载 CSV
     * @param items CSV 资源项列表
     * @param options 共用加载选项
     * @returns 表名到表的映射（加载失败的表不会出现在结果中）
     * @example
     * const tables = await m.csvMgr.loadBatch([
     *     { name: "hero", path: "config/hero", bundle: "resources" },
     *     { name: "item", path: "config/item", bundle: "resources" },
     * ]);
     */
    async loadBatch(
        items: ICsvLoadItem[],
        options: ILoadCsvOptions = {},
    ): Promise<Record<string, ICsvTable>> {
        const result: Record<string, ICsvTable> = {};
        const seenItems = new Map<string, ICsvLoadItem>();

        for (const item of items) {
            const normalized = this._normalizeLoadItem(item);
            if (!normalized) {
                continue;
            }
            const tableKey = this._tableKey(normalized);
            if (seenItems.has(tableKey)) {
                console.warn(
                    `[CsvMgr] loadBatch 表重复: "${tableKey}"，`
                    + `路径 "${normalized.path}" 将被忽略（保留 "${seenItems.get(tableKey)?.path}"）`,
                );
                continue;
            }
            seenItems.set(tableKey, normalized);
        }

        await Promise.all([...seenItems.values()].map(async (item) => {
            const table = await this.load(item, options);
            if (table) {
                result[this._tableKey(item)] = table;
            }
        }));
        return result;
    }

    /**
     * 解析 CSV 文本并缓存
     * @param item 表项（name + bundle）
     * @param text CSV 原始文本
     * @param options 解析选项
     * @returns 解析后的表；失败返回 null
     * @example
     * const table = m.csvMgr.parse({ name: "skill", bundle: "resources" }, text, { keyField: "skillId" });
     */
    parse(
        item: ICsvTableItem,
        text: string,
        options: ILoadCsvOptions = {},
    ): ICsvTable | null {
        const normalized = this._normalizeTableItem(item);
        if (!normalized || this._destroyed) {
            return null;
        }
        const tableName = normalized.name;
        const tableKey = this._tableKey(normalized);

        if (this._loadingPromises.has(tableKey)) {
            console.warn(`[CsvMgr] 表 "${tableKey}" parse 将取消进行中的加载`);
            this._cancelInflight(tableKey);
        }

        this._tables.delete(tableKey);
        this._tableSources.delete(tableKey);

        const sourceKey = `inline://${tableKey}|${this._parseOptionsKey(options)}`;
        const parseGen = this._bumpGeneration(tableKey);
        return this._parseAndCache(tableKey, tableName, text, options, sourceKey, parseGen);
    }

    /**
     * 获取已缓存的表
     * @param item 表项（name + bundle）
     * @returns 表实例；未加载返回 null
     * @example
     * const heroTable = m.csvMgr.getTable({ name: "hero", bundle: "resources" });
     */
    getTable(item: ICsvTableItem): ICsvTable | null {
        const normalized = this._normalizeTableItem(item);
        if (!normalized) {
            return null;
        }
        return this._tables.get(this._tableKey(normalized)) ?? null;
    }

    /**
     * 按主键获取一行（需已 load / parse）
     * @param item 表项（name + bundle）
     * @param id 主键
     * @returns 行数据；表或行不存在时返回 null
     * @example
     * const hero = m.csvMgr.getRow({ name: "hero", bundle: "resources" }, 1001);
     */
    getRow(item: ICsvTableItem, id: string | number): ICsvRow | null {
        return this.getTable(item)?.get(id) ?? null;
    }

    /**
     * 获取表的全部行
     * @param item 表项（name + bundle）
     * @returns 行数组；表不存在时返回空数组
     * @example
     * const allHeroes = m.csvMgr.getRows({ name: "hero", bundle: "resources" });
     */
    getRows(item: ICsvTableItem): readonly ICsvRow[] {
        return this.getTable(item)?.getAll() ?? [];
    }

    /**
     * 表是否已加载
     * @param item 表项（name + bundle）
     */
    hasTable(item: ICsvTableItem): boolean {
        const normalized = this._normalizeTableItem(item);
        return normalized ? this._tables.has(this._tableKey(normalized)) : false;
    }

    /**
     * 移除内存中的表缓存并取消进行中的加载（不释放 TextAsset）
     * @param item 表项（name + bundle）
     * @returns 是否移除了缓存或取消了加载
     * @example
     * m.csvMgr.release({ name: "hero", bundle: "resources" });
     */
    release(item: ICsvTableItem): boolean {
        const normalized = this._normalizeTableItem(item);
        if (!normalized) {
            return false;
        }
        const tableKey = this._tableKey(normalized);
        const hadTable = this._tables.has(tableKey);
        const hadInflight = this._loadingPromises.has(tableKey);
        if (!hadTable && !hadInflight) {
            return false;
        }
        this._tables.delete(tableKey);
        this._tableSources.delete(tableKey);
        this._bumpGeneration(tableKey);
        this._loadingPromises.delete(tableKey);
        if (!this._tables.has(tableKey) && !this._loadingPromises.has(tableKey)) {
            this._tableGenerations.delete(tableKey);
        }
        return true;
    }

    /**
     * 清空全部表缓存并取消全部进行中的加载
     */
    releaseAll(): void {
        const allNames = new Set([
            ...this._tables.keys(),
            ...this._loadingPromises.keys(),
        ]);
        for (const tableName of allNames) {
            this._bumpGeneration(tableName);
        }
        this._tables.clear();
        this._tableSources.clear();
        this._loadingPromises.clear();
        this._tableGenerations.clear();
    }

    // ── 内部：加载 ───────────────────────────────────────

    private async _doLoad(
        item: ICsvLoadItem,
        options: ILoadCsvOptions,
        sourceKey: string,
        loadGen: number,
    ): Promise<ICsvTable | null> {
        const text = await this._loadText(item);
        if (text === null || this._destroyed) {
            return null;
        }
        const tableKey = this._tableKey(item);
        if ((this._tableGenerations.get(tableKey) ?? 0) !== loadGen) {
            return null;
        }
        return this._parseAndCache(tableKey, item.name, text, options, sourceKey, loadGen);
    }

    private _bumpGeneration(tableName: string): number {
        const next = (this._tableGenerations.get(tableName) ?? 0) + 1;
        this._tableGenerations.set(tableName, next);
        return next;
    }

    private _cancelInflight(tableName: string): void {
        this._loadingPromises.delete(tableName);
    }

    private _parseAndCache(
        tableKey: string,
        tableName: string,
        text: string,
        options: ILoadCsvOptions,
        sourceKey: string,
        loadGen?: number,
    ): ICsvTable | null {
        if (this._destroyed) {
            return null;
        }
        if (loadGen !== undefined && (this._tableGenerations.get(tableKey) ?? 0) !== loadGen) {
            return null;
        }
        try {
            const table = this._parseText(tableName, text, options);
            if (!table) {
                return null;
            }
            if (!this._setTable(tableKey, sourceKey, table, loadGen)) {
                return null;
            }
            return table;
        } catch (err) {
            console.warn(`[CsvMgr] parse 失败: ${tableName}`, err);
            return null;
        }
    }

    private _setTable(
        tableKey: string,
        sourceKey: string,
        table: ICsvTable,
        expectedGen?: number,
    ): boolean {
        if (expectedGen !== undefined) {
            const currentGen = this._tableGenerations.get(tableKey) ?? 0;
            if (currentGen !== expectedGen) {
                return false;
            }
        }
        const prevSource = this._tableSources.get(tableKey);
        if (prevSource && prevSource !== sourceKey) {
            console.warn(
                `[CsvMgr] 表 "${tableKey}" 来源不一致，将使用新数据: ${prevSource} -> ${sourceKey}`,
            );
        }
        this._tables.set(tableKey, table);
        this._tableSources.set(tableKey, sourceKey);
        return true;
    }

    private _loadText(item: ICsvLoadItem): Promise<string | null> {
        if (this._destroyed) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            const onLoaded = (err: Error | null, asset: TextAsset | null) => {
                if (this._destroyed) {
                    asset?.decRef();
                    resolve(null);
                    return;
                }
                if (err || !asset) {
                    console.warn(`[CsvMgr] 加载失败: ${item.bundle}://${item.path}`, err);
                    resolve(null);
                    return;
                }
                const text = asset.text ?? "";
                asset.decRef();
                resolve(text);
            };

            if (item.bundle === "resources") {
                resources.load(item.path, TextAsset, onLoaded);
                return;
            }

            const cachedBundle = this._bundleCache.get(item.bundle);
            if (cachedBundle) {
                cachedBundle.load(item.path, TextAsset, onLoaded);
                return;
            }

            assetManager.loadBundle(item.bundle, (err, b) => {
                if (this._destroyed) {
                    resolve(null);
                    return;
                }
                if (err || !b) {
                    console.warn(`[CsvMgr] Bundle 加载失败: ${item.bundle}`, err);
                    resolve(null);
                    return;
                }
                this._bundleCache.set(item.bundle, b);
                b.load(item.path, TextAsset, onLoaded);
            });
        });
    }

    // ── 内部：解析 ───────────────────────────────────────

    private _parseText(
        name: string,
        text: string,
        options: ILoadCsvOptions,
    ): ICsvTable | null {
        const skipComments = options.skipComments ?? true;
        const warnOnConvertError = options.warnOnConvertError ?? true;
        const strippedText = text.length > 0 && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
        const rawRows = this._splitRows(strippedText, name);
        const dataLines: string[][] = [];
        const dataLineNumbers: number[] = [];

        let sourceLineNo = 0;
        for (const line of rawRows) {
            sourceLineNo++;
            if (!line.trim()) {
                continue;
            }
            if (skipComments && line.trimStart().startsWith("#")) {
                continue;
            }
            dataLines.push(this._parseLine(line));
            dataLineNumbers.push(sourceLineNo);
        }

        if (dataLines.length === 0) {
            console.warn(`[CsvMgr] CSV 无有效数据: ${name}`);
            return null;
        }

        const headers = dataLines[0].map((h) => h.trim().replace(/^\uFEFF/, ""));
        if (headers.length === 0 || headers.every((h) => !h)) {
            console.warn(`[CsvMgr] CSV 表头无效: ${name}`);
            return null;
        }

        const columnCount = headers.length;
        const fieldRowMode = options.fieldRow ?? "auto";
        const typeRowMode = options.typeRow ?? "auto";

        let fieldHeaders = headers;
        let typeRowIndex = -1;
        let dataStartIndex = 1;

        const useFieldRow = fieldRowMode === true
            || (fieldRowMode === "auto"
                && dataLines.length > 1
                && this._isFieldNameRow(dataLines[1], columnCount));

        if (useFieldRow) {
            fieldHeaders = dataLines[1].map((h) => h.trim());
            dataStartIndex = 2;

            if (dataLines.length > 2) {
                const typeRowCells = dataLines[2];
                const useTypeRow = typeRowMode === "auto"
                    ? this._isTypeRow(typeRowCells, columnCount)
                    : typeRowMode === true;
                if (useTypeRow) {
                    typeRowIndex = 2;
                    dataStartIndex = 3;
                }
            }
        } else if (dataLines.length > 1) {
            const secondRow = dataLines[1];
            const useTypeRow = typeRowMode === "auto"
                ? this._isTypeRow(secondRow, columnCount)
                : typeRowMode === true;
            if (useTypeRow) {
                typeRowIndex = 1;
                dataStartIndex = 2;
            }
        }

        const seenHeaders = new Set<string>();
        for (const header of fieldHeaders) {
            if (!header) {
                continue;
            }
            if (seenHeaders.has(header)) {
                console.warn(`[CsvMgr] 表 "${name}" 列名重复: ${header}`);
            }
            seenHeaders.add(header);
        }

        const types = typeRowIndex >= 0
            ? dataLines[typeRowIndex].map((t) => t.trim().toLowerCase())
            : fieldHeaders.map(() => "string");

        if (typeRowIndex >= 0) {
            types.forEach((typeName, col) => {
                if (typeName && !TYPE_KEYWORDS.has(typeName)) {
                    const colName = fieldHeaders[col] || `第 ${col + 1} 列`;
                    console.warn(
                        `[CsvMgr] 表 "${name}" 类型行字段 "${colName}" 未知类型: `
                        + `${dataLines[typeRowIndex][col]}`,
                    );
                }
            });
        }

        const rows: ICsvRow[] = [];
        for (let i = dataStartIndex; i < dataLines.length; i++) {
            const cells = dataLines[i];
            if (cells.every((c) => !c.trim())) {
                continue;
            }
            const row: Record<string, string | number | boolean> = {};
            const csvLineNo = dataLineNumbers[i];
            for (let col = 0; col < fieldHeaders.length; col++) {
                const field = fieldHeaders[col];
                if (!field) {
                    continue;
                }
                const raw = col < cells.length ? cells[col] : "";
                row[field] = this._convertValue(raw, types[col] ?? "string", warnOnConvertError ? {
                    table: name,
                    field,
                    line: csvLineNo,
                } : undefined);
            }
            rows.push(row as ICsvRow);
        }

        const keyField = this._resolveKeyField(name, fieldHeaders, options.keyField);
        return new CsvTable(name, fieldHeaders, rows, keyField);
    }

    /**
     * 将 CSV 文本拆成逻辑行（支持引号内换行）
     */
    private _splitRows(text: string, tableName?: string): string[] {
        const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const rows: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < normalized.length; i++) {
            const ch = normalized[i];
            if (ch === "\"") {
                if (inQuotes && normalized[i + 1] === "\"") {
                    current += "\"\"";
                    i++;
                } else {
                    inQuotes = !inQuotes;
                    current += ch;
                }
                continue;
            }
            if (ch === "\n" && !inQuotes) {
                rows.push(current);
                current = "";
                continue;
            }
            current += ch;
        }
        if (current.length > 0 || rows.length > 0) {
            rows.push(current);
        }
        if (inQuotes) {
            const prefix = tableName ? `表 "${tableName}" ` : "";
            console.warn(`[CsvMgr] ${prefix}CSV 存在未闭合引号，可能影响解析结果`);
        }
        return rows;
    }

    /**
     * 解析单行 CSV（支持双引号包裹字段）
     */
    private _parseLine(line: string): string[] {
        const cells: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === "\"") {
                if (inQuotes && line[i + 1] === "\"") {
                    current += "\"";
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }
            if (ch === "," && !inQuotes) {
                cells.push(current);
                current = "";
                continue;
            }
            current += ch;
        }
        cells.push(current);
        return cells;
    }

    private _isFieldNameRow(cells: string[], headerCount: number): boolean {
        if (cells.length === 0 || cells.length !== headerCount) {
            return false;
        }
        if (this._isTypeRow(cells, headerCount)) {
            return false;
        }
        return cells.every((cell) => {
            const value = cell.trim();
            return value !== "" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
        });
    }

    private _isTypeRow(cells: string[], headerCount: number): boolean {
        if (cells.length === 0 || cells.length !== headerCount) {
            return false;
        }
        return cells.every((cell) => TYPE_KEYWORDS.has(cell.trim().toLowerCase()));
    }

    private _convertValue(
        raw: string,
        type: string,
        ctx?: { table: string; field: string; line: number },
    ): string | number | boolean {
        const trimmed = raw.trim();
        const t = (type || "string").toLowerCase();
        const warn = (message: string) => {
            if (!ctx) {
                return;
            }
            console.warn(
                `[CsvMgr] 表 "${ctx.table}" 第 ${ctx.line} 行字段 "${ctx.field}" ${message}`,
            );
        };

        if (t === "int" || t === "integer") {
            if (trimmed === "") {
                return 0;
            }
            if (!/^-?\d+$/.test(trimmed)) {
                warn(`无法解析为整数: "${raw}"，已回退为 0`);
                return 0;
            }
            return parseInt(trimmed, 10);
        }
        if (t === "number" || t === "float" || t === "double") {
            if (trimmed === "") {
                return 0;
            }
            const n = parseFloat(trimmed);
            if (!Number.isFinite(n)) {
                warn(`无法解析为数字: "${raw}"，已回退为 0`);
                return 0;
            }
            return n;
        }
        if (t === "bool" || t === "boolean") {
            if (trimmed === "1" || trimmed.toLowerCase() === "true") {
                return true;
            }
            if (trimmed === "0" || trimmed.toLowerCase() === "false" || trimmed === "") {
                return false;
            }
            warn(`无法解析为布尔: "${raw}"，已回退为 false`);
            return false;
        }
        if (t === "string" || t === "str") {
            return trimmed;
        }
        return trimmed;
    }

    private _resolveKeyField(tableName: string, headers: string[], preferred?: string): string {
        const fallback = headers.includes("id")
            ? "id"
            : (headers.find((h) => !!h) ?? "");

        if (preferred) {
            if (headers.includes(preferred)) {
                return preferred;
            }
            console.warn(
                `[CsvMgr] 表 "${tableName}" 指定主键列 "${preferred}" 不存在，`
                + `已回退为 "${fallback || "（无）"}"`,
            );
        }
        if (!fallback) {
            console.warn(`[CsvMgr] 表 "${tableName}" 无有效主键列`);
        }
        return fallback;
    }

    private _normalizeName(name: string): string | null {
        const trimmed = name?.trim();
        if (!trimmed) {
            console.warn("[CsvMgr] 表名不能为空");
            return null;
        }
        return trimmed;
    }

    private _normalizeTableItem(item: ICsvTableItem): ICsvTableItem | null {
        const name = this._normalizeName(item?.name);
        if (!name) {
            return null;
        }
        const bundle = item.bundle?.trim();
        if (!bundle) {
            console.warn(`[CsvMgr] bundle 不能为空: ${name}`);
            return null;
        }
        return { name, bundle };
    }

    private _normalizeLoadItem(item: ICsvLoadItem): ICsvLoadItem | null {
        const tableItem = this._normalizeTableItem(item);
        if (!tableItem) {
            return null;
        }
        const path = item.path?.trim();
        if (!path) {
            console.warn(`[CsvMgr] path 不能为空: ${tableItem.name}`);
            return null;
        }
        return { ...tableItem, path };
    }

    private _tableKey(item: ICsvTableItem): string {
        return `${item.bundle}://${item.name}`;
    }

    private _parseOptionsKey(options: ILoadCsvOptions): string {
        const typeRow = options.typeRow ?? "auto";
        const fieldRow = options.fieldRow ?? "auto";
        const keyField = options.keyField ?? "";
        const skipComments = options.skipComments ?? true;
        const warnOnConvertError = options.warnOnConvertError ?? true;
        return `tr:${typeRow}|fr:${fieldRow}|kf:${keyField}|sc:${skipComments}|woc:${warnOnConvertError}`;
    }

    private _sourceKey(
        item: ICsvLoadItem,
        options: ILoadCsvOptions,
    ): string {
        return `${item.bundle}://${item.path}|${this._parseOptionsKey(options)}`;
    }

    private _releaseLoadedBundles(): void {
        // Bundle 生命周期由 Cocos/AssetMgr 统一管理，这里只清理本模块的引用。
        this._bundleCache.clear();
    }
}
