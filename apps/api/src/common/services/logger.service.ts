import { Injectable, LoggerService, Scope } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { getTraceId, getCurrentUserId } from '../utils/async-context';
// P2 修复（日志脱敏有三套实现，敏感字段列表不一致）：统一引用共享常量
import { SENSITIVE_FIELDS, isSensitiveField } from '../utils/sensitive-fields';

export function sanitizeObject(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (isSensitiveField(key)) {
      result[key] = '***';
    } else {
      result[key] = sanitizeObject((obj as Record<string, unknown>)[key]);
    }
  }
  return result;
}

export function sanitizeString(str: string): string {
  if (!str) return str;
  let result = str;
  for (const field of SENSITIVE_FIELDS) {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`("${escapedField}"\\s*:\\s*")([^"]+)(")`, 'gi');
    result = result.replace(regex, `$1***$3`);
  }
  return result;
}

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  traceId?: string;
  message: string;
  context?: string;
  userId?: string;
  module?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

let logFilePath: string | null = null;
function getLogFilePath(): string {
  if (logFilePath) return logFilePath;
  try {
    const dataDir = process.env.DATA_DIR || process.env.DB_PATH
      ? path.dirname(process.env.DB_PATH || '')
      : path.join(__dirname, '../../../data');
    const logDir = path.join(dataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    logFilePath = path.join(logDir, 'app.log');
  } catch {
    logFilePath = null;
  }
  return logFilePath;
}

const logBuffer: LogEntry[] = [];
const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER_SIZE = 100;
const MAX_TOTAL_BUFFER_SIZE = 10000;
let flushTimer: NodeJS.Timeout | null = null;

function flushLogs(): void {
  if (logBuffer.length === 0) return;
  const entries = logBuffer.splice(0, logBuffer.length);
  try {
    const fp = getLogFilePath();
    if (fp) {
      const data = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFile(fp, data, () => {});
    }
  } catch {
    // 写入失败时静默忽略，不影响主流程
  }
}

function appendToFile(entry: LogEntry): void {
  if (logBuffer.length >= MAX_TOTAL_BUFFER_SIZE) {
    console.warn(`日志缓冲已满(${MAX_TOTAL_BUFFER_SIZE})，丢弃新日志: ${entry.message.substring(0, 50)}...`);
    return;
  }
  logBuffer.push(entry);
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    flushLogs();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushLogs();
    }, FLUSH_INTERVAL_MS);
    flushTimer.unref();
  }
}

function shutdown(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushLogs();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

@Injectable({ scope: Scope.TRANSIENT })
export class AppLogger implements LoggerService {
  private context?: string;

  constructor(context?: string) {
    this.context = context;
  }

  setContext(context: string) {
    this.context = context;
  }

  debug(message: any, context?: string) {
    this.writeLog(message, context, 'debug');
  }

  log(message: any, context?: string) {
    this.writeLog(message, context, 'info');
  }

  warn(message: any, context?: string) {
    this.writeLog(message, context, 'warn');
  }

  error(message: any, error?: Error | string, context?: string) {
    const stack = typeof error === 'string' ? error : error?.stack;
    this.writeLog(message, context, 'error', stack);
  }

  private writeLog(message: any, context?: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info', stack?: string) {
    let msg: string;
    let data: Record<string, unknown> | undefined;

    if (typeof message === 'string') {
      msg = sanitizeString(message);
    } else if (message !== null && typeof message === 'object') {
      const sanitized = sanitizeObject(message) as Record<string, unknown>;
      msg = JSON.stringify(sanitized);
      data = sanitized;
    } else {
      msg = String(message);
    }

    // Auto-inject traceId and userId from AsyncLocalStorage context
    const autoTraceId = getTraceId();
    const autoUserId = getCurrentUserId();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      traceId: autoTraceId, // Will be undefined outside request context
      message: msg,
      context: context || this.context,
      userId: autoUserId, // Will be undefined if not authenticated
    };

    if (stack) {
      entry.data = { ...data, stack };
    } else if (data) {
      entry.data = data;
    }

    const logStr = JSON.stringify(entry);
    
    // 同时写入文件和控制台
    appendToFile(entry);

    switch (level) {
      case 'error':
        console.error(logStr);
        break;
      case 'warn':
        console.warn(logStr);
        break;
      case 'debug':
        console.debug(logStr);
        break;
      default:
        console.log(logStr);
    }
  }

  logRequest(traceId: string, method: string, path: string, status: number, duration: number) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      traceId,
      message: `Request completed`,
      context: 'HTTP',
      data: { method, path, status, duration },
    };
    console.log(JSON.stringify(entry));
    appendToFile(entry);
  }

  logError(traceId: string, message: string, error: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      traceId,
      message,
      context: 'Error',
      data: {
        errorMessage: error?.message,
        stack: error?.stack,
      },
    };
    console.error(JSON.stringify(entry));
    appendToFile(entry);
  }
}
