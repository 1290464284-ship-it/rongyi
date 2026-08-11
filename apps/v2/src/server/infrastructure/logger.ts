import fs from 'node:fs';
import path from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';

export interface LogMeta {
  traceId?: string;
  userId?: string;
  clinicId?: string | null;
  action?: string;
  durationMs?: number;
  statusCode?: number;
  method?: string;
  path?: string;
  port?: number;
  target?: string;
  backupCreated?: string;
  error?: unknown;
  [key: string]: unknown;
}

/**
 * Maximum nesting depth for log value serialization. Guards against circular
 * references (e.g. req/res objects attached to meta) that would otherwise
 * make JSON.stringify throw and break logging.
 */
export const MAX_SERIALIZE_DEPTH = 5;

/**
 * Recursively serialize a log value for JSON output. Error instances are
 * expanded into { message, stack, cause } instead of JSON.stringify's `{}`,
 * and the expansion recurses through the cause chain. Circular or deeply
 * nested structures are truncated to '[MaxDepth]' beyond MAX_SERIALIZE_DEPTH.
 * All other values keep their JSON.stringify-compatible shape (objects with
 * toJSON, such as Date, are preserved).
 */
export function serializeValue(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const out: Record<string, unknown> = { message: value.message };
    if (typeof value.stack === 'string') out.stack = value.stack;
    const cause = (value as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      out.cause = depth >= MAX_SERIALIZE_DEPTH ? '[MaxDepth]' : serializeValue(cause, depth + 1);
    }
    return out;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_SERIALIZE_DEPTH) return '[MaxDepth]';
    return value.map((item) => serializeValue(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    const toJson = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJson === 'function') {
      return serializeValue((value as { toJSON: () => unknown }).toJSON(), depth + 1);
    }
    if (depth >= MAX_SERIALIZE_DEPTH) return '[MaxDepth]';
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = serializeValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Structured JSON logger with optional local file output.
 *
 * Console output stays synchronous; file output is buffered and flushed on a
 * short timer plus process exit, so hot request paths do not pay a synchronous
 * disk write per line. A single log file with size-based rotation is kept.
 */
const FLUSH_INTERVAL_MS = 500;
const liveLoggers = new Set<Logger>();
let exitFlushInstalled = false;

export class Logger {
  private readonly logDir?: string;
  private readonly maxFileBytes = 5 * 1024 * 1024;
  private readonly buffer: Array<{ filePath: string; line: string }> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: { logDir?: string } = {}) {
    this.logDir = options.logDir;
    if (this.logDir) fs.mkdirSync(this.logDir, { recursive: true });
    liveLoggers.add(this);
    if (!exitFlushInstalled) {
      exitFlushInstalled = true;
      process.once('exit', () => {
        for (const logger of liveLoggers) {
          try {
            logger.flush();
          } catch {
            // best effort at process exit
          }
        }
      });
    }
  }

  info(message: string, meta: LogMeta = {}): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta: LogMeta = {}): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta: LogMeta = {}): void {
    this.write('error', message, meta);
  }

  private write(level: LogLevel, message: string, meta: LogMeta): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };
    const line = JSON.stringify(serializeValue(entry));
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    if (this.logDir) this.append(path.join(this.logDir, 'v2.log'), line);
  }

  /** 同步写空缓冲区（测试/退出兜底用）。 */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;
    const pending = this.buffer.splice(0, this.buffer.length);
    for (const { filePath, line } of pending) {
      this.appendLine(filePath, line);
    }
  }

  private append(filePath: string, line: string): void {
    this.buffer.push({ filePath, line });
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, FLUSH_INTERVAL_MS);
      this.flushTimer.unref?.();
    }
  }

  private appendLine(filePath: string, line: string): void {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size >= this.maxFileBytes) {
        if (fs.existsSync(`${filePath}.4`)) {
          fs.renameSync(`${filePath}.4`, `${filePath}.5`);
        }
        if (fs.existsSync(`${filePath}.3`)) {
          fs.renameSync(`${filePath}.3`, `${filePath}.4`);
        }
        if (fs.existsSync(`${filePath}.2`)) {
          fs.renameSync(`${filePath}.2`, `${filePath}.3`);
        }
        if (fs.existsSync(`${filePath}.1`)) {
          fs.renameSync(`${filePath}.1`, `${filePath}.2`);
        }
        fs.renameSync(filePath, `${filePath}.1`);
      }
      fs.appendFileSync(filePath, `${line}\n`, 'utf8');
    } catch {
      // Logging must never break the application.
    }
  }
}
