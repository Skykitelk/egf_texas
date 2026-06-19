import { sys } from "cc";

/** 日志级别（数值越大越严重） */
enum LogLevel {
    LOG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

const LOG_LABELS = ["LOG", "INFO", "WARN", "ERROR"] as const;

const LOG_COLORS = [
    "#81C784",
    "#64B5F6",
    "#FFB74D",
    "#E57373",
] as const;

/**
 * 日志管理器
 *
 * - Web 端彩色前缀 + 时间戳
 * - 原生端纯文本前缀 + 时间戳
 * - 生产环境默认仅输出 warn / error
 * - 仅导出本类，通过 `m.logMgr` 访问
 *
 * @example
 * m.logMgr.info("player login", uid);
 * m.logMgr.setProduction(true);
 */
export class LogMgr implements egf.IModule {
    key = "logMgr";

    private _isProduction = false;
    private _minLevel = LogLevel.LOG;

    /**
     * 模块初始化回调（egf.IModule）
     */
    onInit(): void {
        console.log("LogMgr onInit");
    }

    /**
     * 模块卸载回调（egf.IModule）
     */
    onStop(): void {
        console.log("LogMgr onStop");
    }

    /**
     * 设置是否为生产环境
     * 生产环境下 log / info 不输出，warn / error 仍会输出
     * @param prod 是否为生产环境
     * @example
     * m.logMgr.setProduction(!sys.isBrowser);
     */
    public setProduction(prod: boolean): void {
        this._isProduction = prod;
    }

    /**
     * 当前是否为生产环境
     */
    public isProduction(): boolean {
        return this._isProduction;
    }

    /**
     * 设置最低输出级别（低于该级别的日志将被忽略）
     * @param level 最低级别。 级别顺序：log < info < warn < error
     * @example
     * m.logMgr.setMinLevel("warn");
     */
    public setMinLevel(level: "log" | "info" | "warn" | "error"): void {
        const map: Record<string, LogLevel> = {
            log: LogLevel.LOG,
            info: LogLevel.INFO,
            warn: LogLevel.WARN,
            error: LogLevel.ERROR,
        };
        this._minLevel = map[level] ?? LogLevel.LOG;
    }

    /**
     * 打印普通日志
     * @param args 日志内容
     */
    public log(...args: unknown[]): void {
        this._print(LogLevel.LOG, args);
    }

    /**
     * 打印信息日志
     * @param args 日志内容
     */
    public info(...args: unknown[]): void {
        this._print(LogLevel.INFO, args);
    }

    /**
     * 打印警告日志
     * @param args 日志内容
     */
    public warn(...args: unknown[]): void {
        this._print(LogLevel.WARN, args);
    }

    /**
     * 打印错误日志
     * @param args 日志内容
     */
    public error(...args: unknown[]): void {
        this._print(LogLevel.ERROR, args);
    }

    private _shouldPrint(level: LogLevel): boolean {
        if (level < this._minLevel) {
            return false;
        }
        if (this._isProduction && level < LogLevel.WARN) {
            return false;
        }
        return true;
    }

    private _pad(num: number, len: number): string {
        let s = `${num}`;
        while (s.length < len) {
            s = `0${s}`;
        }
        return s;
    }

    private _formatTime(): string {
        const now = new Date();
        const h = this._pad(now.getHours(), 2);
        const m = this._pad(now.getMinutes(), 2);
        const s = this._pad(now.getSeconds(), 2);
        const ms = this._pad(now.getMilliseconds(), 3);
        return `${h}:${m}:${s}.${ms}`;
    }

    private _buildPrefix(level: LogLevel): string {
        return `[${LOG_LABELS[level]}][${this._formatTime()}]`;
    }

    private _print(level: LogLevel, args: unknown[]): void {
        if (!this._shouldPrint(level)) {
            return;
        }

        const label = LOG_LABELS[level];
        const color = LOG_COLORS[level];
        const timePrefix = this._buildPrefix(level);

        if (sys.isNative) {
            this._writeNative(level, timePrefix, args);
            return;
        }

        const styledPrefix = `%c[${label}][${this._formatTime()}] =>`;
        const style = `color: ${color}; font-weight: bold;`;
        const printArgs: unknown[] = [styledPrefix, style, ...args];

        switch (level) {
            case LogLevel.INFO:
                console.info(...printArgs);
                break;
            case LogLevel.WARN:
                console.warn(...printArgs);
                break;
            case LogLevel.ERROR:
                console.error(...printArgs);
                break;
            default:
                console.log(...printArgs);
                break;
        }
    }

    private _writeNative(level: LogLevel, prefix: string, args: unknown[]): void {
        switch (level) {
            case LogLevel.WARN:
                console.warn(prefix, ...args);
                break;
            case LogLevel.ERROR:
                console.error(prefix, ...args);
                break;
            default:
                console.log(prefix, ...args);
                break;
        }
    }
}
