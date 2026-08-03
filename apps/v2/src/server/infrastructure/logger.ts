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
 * Structured JSON logger with optional local file output.
 *
 * The file output is intentionally simple: a single log file with size-based
 * rotation. Production integrations can replace this class with a transport
 * without changing call sites.
 */
export class Logger {
  private readonly logDir?: string;
  private readonly maxFileBytes = 5 * 1024 * 1024;

  constructor(options: { logDir?: string } = {}) {
    this.logDir = options.logDir;
    if (this.logDir) fs.mkdirSync(this.logDir, { recursive: true });
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
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    if (this.logDir) this.append(path.join(this.logDir, 'v2.log'), line);
  }

  private append(filePath: string, line: string): void {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size >= this.maxFileBytes) {
        fs.renameSync(filePath, `${filePath}.1`);
      }
      fs.appendFileSync(filePath, `${line}\n`, 'utf8');
    } catch {
      // Logging must never break the application.
    }
  }
}

export const defaultLogger = new Logger();
