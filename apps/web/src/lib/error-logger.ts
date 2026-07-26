import { api } from './api/api';
import { triggerErrorBoundary } from '../components/ErrorBoundary';
import {
  ERROR_LOG_FLUSH_INTERVAL_MS,
  MAX_ERROR_LOGS,
  MAX_ERROR_LOG_RETRY_COUNT,
} from '../config/constants';

interface ErrorLog {
  id?: string;
  timestamp: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  userId?: string;
  context?: string;
}

const logs: ErrorLog[] = [];
const RETRY_LOGS: Map<string, { logs: ErrorLog[]; retryCount: number }> = new Map();
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

function addLog(log: ErrorLog) {
  logs.unshift(log);
  if (logs.length > MAX_ERROR_LOGS) {
    logs.pop();
  }
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimeout) return;
  flushTimeout = setTimeout(flushLogs, ERROR_LOG_FLUSH_INTERVAL_MS);
}

async function flushLogs() {
  flushTimeout = null;
  if (logs.length === 0) return;

  const batch = [...logs];
  logs.length = 0;

  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    await api.post('/operation-logs/batch', { logs: batch });
    RETRY_LOGS.delete(batchId);
  } catch {
    const existing = RETRY_LOGS.get(batchId);
    const retryCount = existing?.retryCount ?? 0;

    if (retryCount < MAX_ERROR_LOG_RETRY_COUNT) {
      // 放回队列，等待重试
      logs.push(...batch);
      RETRY_LOGS.set(batchId, { logs: batch, retryCount: retryCount + 1 });
      scheduleFlush();
    } else {
      // 超过最大重试次数，丢弃日志并记录到控制台
      console.error('[ErrorLogger] 日志上报失败，已达到最大重试次数，丢弃以下日志:', batch);
      RETRY_LOGS.delete(batchId);
    }
  }
}

export const errorLogger = {
  error: (message: string, error?: Error, context?: string) => {
    const log: ErrorLog = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      stack: error?.stack,
      url: window.location.href,
      userAgent: navigator.userAgent,
      context,
    };
    console.error('[Error]', message, error);
    addLog(log);
  },

  warn: (message: string, context?: string) => {
    const log: ErrorLog = {
      timestamp: new Date().toISOString(),
      level: 'warning',
      message,
      url: window.location.href,
      userAgent: navigator.userAgent,
      context,
    };
    console.warn('[Warning]', message);
    addLog(log);
  },

  info: (message: string, context?: string) => {
    const log: ErrorLog = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      url: window.location.href,
      userAgent: navigator.userAgent,
      context,
    };
    console.info('[Info]', message);
    addLog(log);
  },

  getLogs: () => [...logs],

  flush: () => {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    return flushLogs();
  },

  // 清理函数：清除定时器并 flush 剩余日志
  cleanup: () => {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    return flushLogs();
  },
};

let errorHandler: ((event: ErrorEvent) => void) | null = null;
let rejectionHandler: ((event: PromiseRejectionEvent) => void) | null = null;

export function initErrorHandler() {
  if (errorHandler || rejectionHandler) {
    return;
  }

  errorHandler = (event: ErrorEvent) => {
    errorLogger.error(event.message, event.error, 'window.error');
    // 触发 ErrorBoundary 显示降级界面
    triggerErrorBoundary(event.error || new Error(event.message));
  };

  rejectionHandler = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    errorLogger.error('Unhandled Promise rejection', error, 'unhandledrejection');
    // 触发 ErrorBoundary 显示降级界面
    triggerErrorBoundary(error);
  };

  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);
}

export function cleanupErrorHandler() {
  if (errorHandler) {
    window.removeEventListener('error', errorHandler);
    errorHandler = null;
  }
  if (rejectionHandler) {
    window.removeEventListener('unhandledrejection', rejectionHandler);
    rejectionHandler = null;
  }
}