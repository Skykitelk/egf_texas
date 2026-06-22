/**
 * HTTP管理器
 *
 * - 基于 fetch，支持 Web / 原生
 * - 支持全局 / 单次 baseUrl、默认 headers、超时、query 参数、JSON 请求体
 * - 仅导出本类，通过 `m.httpMgr` 访问
 *
 * @example
 * m.httpMgr.baseUrl = "https://api.example.com";
 * const user = await m.httpMgr.get<IUser>("/user/info", { id: 10001 });
 * await m.httpMgr.post("/user/login", { account: "test", password: "123456" });
 */
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type HttpResponseType = "json" | "text" | "arrayBuffer" | "blob";

type HttpQueryValue = string | number | boolean | null | undefined;

const SENSITIVE_HEADER_NAMES = [
    "authorization",
    "cookie",
    "proxy-authorization",
    "token",
    "x-auth-token",
    "x-access-token",
    "x-token",
] as const;

interface IHttpMgrConfig {
    /** 接口基础地址，例如 `https://api.example.com` */
    baseUrl?: string;
    /** 默认请求头 */
    headers?: Record<string, string>;
    /** 默认超时时间，单位毫秒，默认 10000 */
    timeout?: number;
}

interface IHttpRequestOptions {
    /** 接口基础地址，例如 `https://api.example.com` */
    baseUrl?: string;
    /** HTTP 方法，默认 GET */
    method?: HttpMethod;
    /** URL query 参数 */
    params?: Record<string, HttpQueryValue | HttpQueryValue[]>;
    /** 请求体；普通对象会自动 JSON.stringify */
    data?: unknown;
    /** 单次请求头，会覆盖同名默认 header */
    headers?: Record<string, string>;
    /** 单次请求超时时间，单位毫秒 */
    timeout?: number;
    /** 响应解析类型，默认 json */
    responseType?: HttpResponseType;
    /** 是否携带默认请求头，默认 true；跨域时会自动过滤敏感默认请求头 */
    useDefaultHeaders?: boolean;
    /** fetch 原生 credentials 配置 */
    credentials?: RequestCredentials;
}

interface IHttpErrorLike {
    status: number;
    statusText: string;
    url: string;
    body: unknown;
}

class HttpError extends Error implements IHttpErrorLike {
    status: number;
    statusText: string;
    url: string;
    body: unknown;

    constructor(status: number, statusText: string, url: string, body?: unknown) {
        super(`[HttpMgr] ${status} ${statusText}: ${url}`);
        this.name = "HttpError";
        this.status = status;
        this.statusText = statusText;
        this.url = url;
        this.body = body;
    }
}

/**
 * HTTP管理器
 */
export class HttpMgr implements egf.IModule {

    key = "httpMgr";

    private _baseUrl = "";
    private _headers: Record<string, string> = {};
    private _timeout = 10000;
    private _stopped = false;

    constructor(config?: IHttpMgrConfig) {
        if (config) {
            this.configure(config);
        }
    }

    onInit(): void {
        this._stopped = false;
    }

    onStop(): void {
        this._stopped = true;
    }

    /** 接口基础地址，末尾 `/` 会自动清理 */
    get baseUrl(): string {
        return this._baseUrl;
    }

    set baseUrl(value: string) {
        this._baseUrl = this._normalizeBaseUrl(value);
    }

    /** 默认超时时间，单位毫秒 */
    get timeout(): number {
        return this._timeout;
    }

    set timeout(value: number) {
        if (Number.isFinite(value) && value > 0) {
            this._timeout = value;
        }
    }

    /**
     * 批量配置 HTTP 管理器
     * @param config 配置项
     */
    configure(config: IHttpMgrConfig): void {
        if (config.baseUrl !== undefined) {
            this.baseUrl = config.baseUrl;
        }
        if (config.headers !== undefined) {
            this._headers = this._normalizeHeaders(config.headers);
        }
        if (config.timeout !== undefined) {
            this.timeout = config.timeout;
        }
    }

    /**
     * 设置默认请求头
     * @param key header 名称
     * @param value header 值；传 null / undefined 表示删除
     */
    setHeader(key: string, value: string | null | undefined): void {
        const headerKey = key?.trim();
        if (!headerKey) {
            return;
        }
        if (value === null || value === undefined) {
            this._deleteHeader(this._headers, headerKey);
            return;
        }
        this._setHeader(this._headers, headerKey, value);
    }

    /** 清空默认请求头 */
    clearHeaders(): void {
        this._headers = {};
    }

    /** 是否为 HTTP 非 2xx 错误 */
    isHttpError(err: unknown): err is IHttpErrorLike {
        return err instanceof HttpError;
    }

    /** 是否为请求超时错误 */
    isTimeoutError(err: unknown): boolean {
        return err instanceof Error && err.message.startsWith("[HttpMgr] request timeout:");
    }

    /** 是否为响应 JSON 解析错误 */
    isJsonParseError(err: unknown): boolean {
        return err instanceof Error && err.message.startsWith("[HttpMgr] JSON parse failed:");
    }

    /** 是否为请求体 JSON 序列化错误 */
    isJsonSerializeError(err: unknown): boolean {
        return err instanceof Error && err.message.startsWith("[HttpMgr] JSON serialize failed:");
    }

    /**
     * 发起通用 HTTP 请求
     * @param url 接口地址；相对路径会拼接 baseUrl
     * @param options 请求配置
     */
    async request<T = unknown>(url: string, options: IHttpRequestOptions = {}): Promise<T> {
        if (this._stopped) {
            throw new Error("[HttpMgr] module has stopped");
        }

        const requestUrl = this._buildUrl(url, options.params, options.baseUrl);
        const method = options.method ?? "GET";
        const headers = this._buildHeaders(
            requestUrl,
            options.baseUrl,
            options.headers,
            options.useDefaultHeaders,
        );
        const init: RequestInit = {
            method,
            headers,
            credentials: options.credentials,
        };

        if (options.data !== undefined && method !== "GET") {
            init.body = this._buildBody(options.data, headers);
        }

        const response = await this._fetchWithTimeout(requestUrl, init, options.timeout ?? this._timeout);
        if (this._stopped) {
            throw new Error("[HttpMgr] module has stopped");
        }
        if (!response.ok) {
            throw await this._createHttpError(response, requestUrl);
        }
        return await this._parseResponse<T>(response, options.responseType ?? "json", requestUrl);
    }

    get<T = unknown>(
        url: string,
        params?: IHttpRequestOptions["params"],
        options: Omit<IHttpRequestOptions, "method" | "params" | "data"> = {},
    ): Promise<T> {
        return this.request<T>(url, { ...options, method: "GET", params });
    }

    post<T = unknown>(
        url: string,
        data?: unknown,
        options: Omit<IHttpRequestOptions, "method" | "data"> = {},
    ): Promise<T> {
        return this.request<T>(url, { ...options, method: "POST", data });
    }

    put<T = unknown>(
        url: string,
        data?: unknown,
        options: Omit<IHttpRequestOptions, "method" | "data"> = {},
    ): Promise<T> {
        return this.request<T>(url, { ...options, method: "PUT", data });
    }

    patch<T = unknown>(
        url: string,
        data?: unknown,
        options: Omit<IHttpRequestOptions, "method" | "data"> = {},
    ): Promise<T> {
        return this.request<T>(url, { ...options, method: "PATCH", data });
    }

    delete<T = unknown>(
        url: string,
        data?: unknown,
        options: Omit<IHttpRequestOptions, "method" | "data"> = {},
    ): Promise<T> {
        return this.request<T>(url, { ...options, method: "DELETE", data });
    }

    private _normalizeBaseUrl(url: string): string {
        const trimmed = url?.trim() ?? "";
        return trimmed.replace(/\/+$/, "");
    }

    private _buildUrl(
        url: string,
        params?: IHttpRequestOptions["params"],
        requestBaseUrl?: string,
    ): string {
        const trimmedUrl = url?.trim();
        if (!trimmedUrl) {
            throw new Error("[HttpMgr] url 不能为空");
        }

        const hasProtocol = /^https?:\/\//i.test(trimmedUrl);
        const baseUrl = requestBaseUrl === undefined
            ? this._baseUrl
            : this._normalizeBaseUrl(requestBaseUrl);
        if (!hasProtocol && !baseUrl) {
            throw new Error("[HttpMgr] 相对路径需要配置 baseUrl 或单次 options.baseUrl");
        }
        const base = hasProtocol || !baseUrl
            ? trimmedUrl
            : `${baseUrl}/${trimmedUrl.replace(/^\/+/, "")}`;
        const query = this._stringifyParams(params);
        if (!query) {
            return base;
        }
        return `${base}${base.includes("?") ? "&" : "?"}${query}`;
    }

    private _stringifyParams(params?: IHttpRequestOptions["params"]): string {
        if (!params) {
            return "";
        }
        const parts: string[] = [];
        for (const [key, value] of Object.entries(params)) {
            const values = Array.isArray(value) ? value : [value];
            for (const item of values) {
                if (item === undefined || item === null) {
                    continue;
                }
                parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
            }
        }
        return parts.join("&");
    }

    private _buildHeaders(
        requestUrl: string,
        requestBaseUrl: string | undefined,
        headers?: Record<string, string>,
        useDefaultHeaders = true,
    ): Record<string, string> {
        const result: Record<string, string> = {};
        if (useDefaultHeaders) {
            const keepSensitiveHeaders = this._shouldKeepSensitiveHeaders(requestUrl, requestBaseUrl);
            for (const [key, value] of Object.entries(this._headers)) {
                if (!keepSensitiveHeaders && this._isSensitiveHeader(key)) {
                    continue;
                }
                this._setHeader(result, key, value);
            }
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
            this._setHeader(result, key, value);
        }
        return result;
    }

    private _buildBody(data: unknown, headers: Record<string, string>): BodyInit {
        if (this._isBodyInit(data)) {
            return data;
        }

        if (!this._hasHeader(headers, "content-type")) {
            headers["Content-Type"] = "application/json";
        }
        try {
            return JSON.stringify(data);
        } catch {
            throw new Error("[HttpMgr] JSON serialize failed: request body is not serializable");
        }
    }

    private _hasHeader(headers: Record<string, string>, key: string): boolean {
        const lowerKey = key.toLowerCase();
        return Object.keys(headers).some((headerKey) => headerKey.toLowerCase() === lowerKey);
    }

    private _normalizeHeaders(headers: Record<string, string>): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [key, value] of Object.entries(headers)) {
            this._setHeader(result, key, value);
        }
        return result;
    }

    private _setHeader(headers: Record<string, string>, key: string, value: string): void {
        const headerKey = key?.trim();
        if (!headerKey) {
            return;
        }
        this._deleteHeader(headers, headerKey);
        headers[headerKey] = value;
    }

    private _deleteHeader(headers: Record<string, string>, key: string): void {
        const lowerKey = key.toLowerCase();
        for (const headerKey of Object.keys(headers)) {
            if (headerKey.toLowerCase() === lowerKey) {
                delete headers[headerKey];
            }
        }
    }

    private _isSensitiveHeader(key: string): boolean {
        const lowerKey = key.toLowerCase();
        return SENSITIVE_HEADER_NAMES.includes(lowerKey as typeof SENSITIVE_HEADER_NAMES[number]);
    }

    private _shouldKeepSensitiveHeaders(requestUrl: string, requestBaseUrl?: string): boolean {
        const requestOrigin = this._getUrlOrigin(requestUrl);
        if (!requestOrigin) {
            return true;
        }

        const globalOrigin = this._getUrlOrigin(this._baseUrl);
        if (globalOrigin) {
            return requestOrigin === globalOrigin;
        }

        if (requestBaseUrl !== undefined) {
            const requestBaseOrigin = this._getUrlOrigin(this._normalizeBaseUrl(requestBaseUrl));
            if (requestBaseOrigin) {
                return requestOrigin === requestBaseOrigin;
            }
        }

        return false;
    }

    private _getUrlOrigin(url: string): string | null {
        const match = /^https?:\/\/[^/]+/i.exec(url?.trim() ?? "");
        return match ? match[0].toLowerCase() : null;
    }

    private _isBodyInit(data: unknown): data is BodyInit {
        if (typeof data === "string") {
            return true;
        }
        if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
            return true;
        }
        if (typeof Uint8Array !== "undefined" && data instanceof Uint8Array) {
            return true;
        }
        if (typeof FormData !== "undefined" && data instanceof FormData) {
            return true;
        }
        if (typeof Blob !== "undefined" && data instanceof Blob) {
            return true;
        }
        if (typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams) {
            return true;
        }
        return false;
    }

    private _fetchWithTimeout(url: string, init: RequestInit, timeout: number): Promise<Response> {
        if (timeout <= 0) {
            return fetch(url, init);
        }
        return new Promise<Response>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(new Error(`[HttpMgr] request timeout: ${url}`));
            }, timeout);

            fetch(url, init)
                .then((response) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    resolve(response);
                })
                .catch((err) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    private async _createHttpError(response: Response, url: string): Promise<HttpError> {
        let body: unknown = null;
        try {
            const text = await response.text();
            body = this._tryParseJson(text) ?? text;
        } catch {
            body = null;
        }
        return new HttpError(response.status, response.statusText, url, body);
    }

    private async _parseResponse<T>(response: Response, responseType: HttpResponseType, url: string): Promise<T> {
        if (response.status === 204) {
            return null as T;
        }

        if (responseType === "text") {
            return await response.text() as T;
        }
        if (responseType === "arrayBuffer") {
            return await response.arrayBuffer() as T;
        }
        if (responseType === "blob") {
            return await response.blob() as T;
        }

        const text = await response.text();
        if (!text) {
            return null as T;
        }
        try {
            return JSON.parse(text) as T;
        } catch (err) {
            throw new Error(`[HttpMgr] JSON parse failed: ${url}, body: ${this._clipText(text)}`);
        }
    }

    private _clipText(text: string, maxLength = 300): string {
        return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
    }

    private _tryParseJson(text: string): unknown | null {
        if (!text) {
            return null;
        }
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
}
