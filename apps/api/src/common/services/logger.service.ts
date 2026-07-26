import { Injectable, LoggerService, Optional } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getTraceId, getCurrentUserId, getCurrentClinicId } from '../utils/context/async-context';
// P2 修复（日志脱敏有三套实现，敏感字段列表不一致）：统一引用共享常量
import { isSensitiveField } from '../utils/security/sensitive-fields';
import {
  MAX_SANITIZE_DEPTH,
  MAX_LOG_FILE_SIZE,
  MAX_LOG_FILES_PER_DAY,
  LOG_RETENTION_DAYS,
  LOG_FLUSH_BUFFER_INTERVAL_MS,
  MAX_LOG_BUFFER_SIZE,
  MAX_LOG_TOTAL_BUFFER_SIZE,
} from '../../config/constants';

let dailyCleanupTimer: NodeJS.Timeout | null = null;

export function sanitizeObject(obj: unknown, depth = 0): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (depth >= MAX_SANITIZE_DEPTH) return '[Max Depth Reached]';
  if (Array.isArray(obj)) return obj.map((item) => sanitizeObject(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (isSensitiveField(key)) {
      result[key] = '***';
    } else {
      result[key] = sanitizeObject((obj as Record<string, unknown>)[key], depth + 1);
    }
  }
  return result;
}

export function sanitizeString(str: string): string {
  if (!str) return str;
  // 使用 isSensitiveField 动态判断所有 "key":"value" 形式的字段，避免依赖静态列表
  return str.replace(/"([^"]+)"\s*:\s*"([^"]*)"/g, (_match: string, key: string) => {
    if (isSensitiveField(key)) {
      return `"${key}":"***"`;
    }
    return _match;
  });
}

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  traceId?: string;
  message: string;
  context?: string;
  userId?: string;
  clinicId?: string;
  module?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  verbose: 0,
  info: 1,
  log: 1,
  warn: 2,
  error: 3,
};

function getLogLevel(): number {
  const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LOG_LEVELS[envLevel] !== undefined ? LOG_LEVELS[envLevel] : LOG_LEVELS.info;
}

function shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
  const currentLevel = getLogLevel();
  const levelValue = LOG_LEVELS[level] ?? 1;
  return levelValue >= currentLevel;
}

let logDirPath: string | null = null;
let currentLogFilePath: string | null = null;
let currentLogDate: string | null = null;

function getLogDir(): string | null {
  if (logDirPath) return logDirPath;
  try {
    const dataDir = process.env.DATA_DIR || process.env.DB_PATH
      ? path.dirname(process.env.DB_PATH || '')
      : path.join(__dirname, '../../../data');
    const logDir = path.join(dataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    logDirPath = logDir;
    return logDir;
  } catch {
    return null;
  }
}

function getCurrentLogFileName(dateStr: string, index: number): string {
  if (index === 0) {
    return `app-${dateStr}.log`;
  }
  return `app-${dateStr}.${index}.log`;
}

function rotateLogFilesIfNeeded(logDir: string, dateStr: string): string {
  let targetIndex = 0;

  for (let i = MAX_LOG_FILES_PER_DAY - 1; i >= 0; i--) {
    const filePath = path.join(logDir, getCurrentLogFileName(dateStr, i));
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size < MAX_LOG_FILE_SIZE) {
        targetIndex = i;
        break;
      } else {
        if (i === MAX_LOG_FILES_PER_DAY - 1) {
          try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        }
      }
    }
  }

  for (let i = targetIndex; i > 0; i--) {
    const oldPath = path.join(logDir, getCurrentLogFileName(dateStr, i - 1));
    const newPath = path.join(logDir, getCurrentLogFileName(dateStr, i));
    if (fs.existsSync(oldPath)) {
      try {
        const oldStats = fs.statSync(oldPath);
        if (oldStats.size >= MAX_LOG_FILE_SIZE) {
          if (fs.existsSync(newPath)) {
            try { fs.unlinkSync(newPath); } catch { /* ignore */ }
          }
          fs.renameSync(oldPath, newPath);
        }
      } catch {
        // ignore
      }
    }
  }

  return path.join(logDir, getCurrentLogFileName(dateStr, 0));
}

function getLogFilePath(): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const logDir = getLogDir();
  if (!logDir) return null;

  if (currentLogFilePath && currentLogDate === today) {
    try {
      const stats = fs.statSync(currentLogFilePath);
      if (stats.size < MAX_LOG_FILE_SIZE) {
        return currentLogFilePath;
      }
    } catch {
      // file might not exist yet, that's fine
    }
  }

  try {
    const newPath = rotateLogFilesIfNeeded(logDir, today);
    currentLogDate = today;
    currentLogFilePath = newPath;

    if (!dailyCleanupTimer) {
      startDailyCleanup(logDir);
    }

    return newPath;
  } catch {
    return null;
  }
}

function getAllLogFiles(logDir: string): Array<{ name: string; date: string; index: number; fullPath: string; mtime: number; size: number }> {
  const files = fs.readdirSync(logDir);
  const result: Array<{ name: string; date: string; index: number; fullPath: string; mtime: number; size: number }> = [];

  for (const file of files) {
    const match = file.match(/app-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/);
    if (match) {
      const fullPath = path.join(logDir, file);
      try {
        const stats = fs.statSync(fullPath);
        result.push({
          name: file,
          date: match[1],
          index: match[2] ? parseInt(match[2], 10) : 0,
          fullPath,
          mtime: stats.mtimeMs,
          size: stats.size,
        });
      } catch {
        // skip
      }
    }
  }

  return result.sort((a, b) => b.mtime - a.mtime);
}

function cleanupOldLogFiles(logDir: string): void {
  try {
    const cutoffTime = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = getAllLogFiles(logDir);

    for (const file of files) {
      const fileDate = new Date(file.date).getTime();
      if (fileDate < cutoffTime || file.mtime < cutoffTime) {
        try {
          fs.unlinkSync(file.fullPath);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // 清理失败不影响主流程
  }
}

function startDailyCleanup(logDir: string): void {
  if (dailyCleanupTimer) return;

  const now = new Date();
  const nextCleanup = new Date();
  nextCleanup.setHours(2, 0, 0, 0);
  if (nextCleanup.getTime() <= now.getTime()) {
    nextCleanup.setDate(nextCleanup.getDate() + 1);
  }
  const initialDelay = nextCleanup.getTime() - now.getTime();

  dailyCleanupTimer = setTimeout(() => {
    cleanupOldLogFiles(logDir);
    dailyCleanupTimer = setInterval(() => {
      cleanupOldLogFiles(logDir);
    }, 24 * 60 * 60 * 1000);
  }, initialDelay);
  dailyCleanupTimer.unref();
}

const logBuffer: LogEntry[] = [];
const FLUSH_INTERVAL_MS = LOG_FLUSH_BUFFER_INTERVAL_MS;
const MAX_BUFFER_SIZE = MAX_LOG_BUFFER_SIZE;
const MAX_TOTAL_BUFFER_SIZE = MAX_LOG_TOTAL_BUFFER_SIZE;
let flushTimer: NodeJS.Timeout | null = null;

function flushLogs(): void {
  if (logBuffer.length === 0) return;
  const entries = logBuffer.splice(0, logBuffer.length);
  try {
    const fp = getLogFilePath();
    if (fp) {
      const data = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFile(fp, data, (err) => {
        if (err) {
          console.error('Failed to write log file:', err.message);
        }
      });
    }
  } catch {
    // 写入失败时静默忽略，不影响主流程
  }
}

function appendToFile(entry: LogEntry): void {
  if (logBuffer.length >= MAX_TOTAL_BUFFER_SIZE) {
    console.warn(`日志缓冲已满(${MAX_TOTAL_BUFFER_SIZE})，丢弃新日志: ${entry.message.slice(0, 50)}...`);
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
  if (dailyCleanupTimer) {
    clearTimeout(dailyCleanupTimer);
    dailyCleanupTimer = null;
  }
  flushLogs();
}

export function shutdownLogger(): void {
  shutdown();
}

@Injectable()
export class AppLogger implements LoggerService {
  private context?: string;

  constructor(@Optional() context?: string) {
    this.context = context;
  }

  setContext(context: string) {
    this.context = context;
  }


  debug(message: unknown, context?: string) {
    this.writeLog(message, context, 'debug');
  }

  log(message: unknown, context?: string) {
    this.writeLog(message, context, 'info');
  }

  warn(message: unknown, context?: string) {
    this.writeLog(message, context, 'warn');
  }

  error(message: unknown, error?: Error | string, context?: string) {
    const stack = typeof error === 'string' ? error : error?.stack;
    this.writeLog(message, context, 'error', stack ?? undefined);
  }

  // NestJS LoggerService 接口要求宽松的参数类型，使用 unknown 替代 any 以保留类型安全

  private writeLog(message: unknown, context?: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info', stack?: string) {
    if (!shouldLog(level)) {
      return;
    }

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

    const autoTraceId = getTraceId();
    const autoUserId = getCurrentUserId();
    const autoClinicId = getCurrentClinicId();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      traceId: autoTraceId,
      message: msg,
      context: context || this.context,
      userId: autoUserId,
      clinicId: autoClinicId,
    };

    if (stack) {
      entry.data = { ...data, stack };
    } else if (data) {
      entry.data = data;
    }

    // 同时写入文件和控制台
    appendToFile(entry);

    // P2-4: 开发环境人类可读输出，生产环境纯 JSON 便于 ELK/Sentry 采集
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      const logStr = JSON.stringify(entry);
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
    } else {
      const ts = entry.timestamp.replace('T', ' ').replace('Z', '');
      const ctx = entry.context ? `[${entry.context}]` : '';
      const trace = entry.traceId ? `(trace:${entry.traceId.slice(0, 8)})` : '';
      const user = entry.userId ? `(user:${entry.userId})` : '';
      const clinic = entry.clinicId ? `(clinic:${entry.clinicId})` : '';
      const prefix = `${ts} ${level.toUpperCase().padEnd(5)} ${ctx}${trace}${user}${clinic}`.trim();
      switch (level) {
        case 'error':
          console.error(prefix, entry.message);
          if (entry.data?.stack) console.error(entry.data.stack);
          break;
        case 'warn':
          console.warn(prefix, entry.message);
          break;
        case 'debug':
          console.debug(prefix, entry.message);
          break;
        default:
          console.log(prefix, entry.message);
      }
    }
  }

  logRequest(traceId: string, method: string, path: string, status: number, duration: number) {
    if (!shouldLog('info')) {
      return;
    }
    const autoUserId = getCurrentUserId();
    const autoClinicId = getCurrentClinicId();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      traceId,
      message: `Request completed`,
      context: 'HTTP',
      userId: autoUserId,
      clinicId: autoClinicId,
      data: { method, path, status, duration },
    };
    appendToFile(entry);
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      console.log(JSON.stringify(entry));
    } else {
      const ts = entry.timestamp.replace('T', ' ').replace('Z', '');
      const user = autoUserId ? `(user:${autoUserId})` : '';
      const clinic = autoClinicId ? `(clinic:${autoClinicId})` : '';
      console.log(`${ts} INFO  [HTTP] (trace:${traceId.slice(0, 8)})${user}${clinic} ${method} ${path} ${status} ${duration}ms`);
    }
  }

  logError(traceId: string, message: string, error: unknown) {
    if (!shouldLog('error')) {
      return;
    }
    const autoUserId = getCurrentUserId();
    const autoClinicId = getCurrentClinicId();
    const err = error as Error | null | undefined;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      traceId,
      message,
      context: 'Error',
      userId: autoUserId,
      clinicId: autoClinicId,
      data: {
        errorMessage: err?.message,
        stack: err?.stack,
      },
    };
    appendToFile(entry);
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd) {
      console.error(JSON.stringify(entry));
    } else {
      const ts = entry.timestamp.replace('T', ' ').replace('Z', '');
      const user = autoUserId ? `(user:${autoUserId})` : '';
      const clinic = autoClinicId ? `(clinic:${autoClinicId})` : '';
      console.error(`${ts} ERROR [Error] (trace:${traceId.slice(0, 8)})${user}${clinic} ${message}`);
      if (err?.stack) console.error(err.stack);
    }
  }
}
