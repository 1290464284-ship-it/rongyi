import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { toastService } from '../utils/toast-service';
import { useAuthStore } from '../store/auth-store';
import {
  DEFAULT_API_PORT,
  API_MAX_RETRIES,
  API_RETRY_DELAY_MS,
  API_REQUEST_TIMEOUT_MS,
  LOGOUT_REDIRECT_DELAY_MS,
} from '../../config/constants';

const isElectron = navigator.userAgent.includes('Electron');
const envBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const apiBaseUrl = envBaseUrl
  ? envBaseUrl
  : isElectron
    ? `http://localhost:${DEFAULT_API_PORT}/api`
    : '/api';

const MAX_RETRIES = API_MAX_RETRIES;
const RETRY_DELAY = API_RETRY_DELAY_MS;

interface RetryConfig extends InternalAxiosRequestConfig {
  retryCount?: number;
  _isRefreshRetry?: boolean;
  skipErrorToast?: boolean;
}


const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

// 判断是否需要重试
const shouldRetry = (error: AxiosError, method?: string): boolean => {
  // 写操作不重试
  if (method && WRITE_METHODS.includes(method.toUpperCase())) return false;
  const m = (method || 'get').toLowerCase();
  if (m !== 'get' && m !== 'head' && m !== 'options') {
    return false;
  }
  // 4xx 错误不重试
  if (error.response?.status && error.response.status >= 400 && error.response.status < 500) {
    return false;
  }
  // 网络错误重试
  if (error.code === 'ERR_NETWORK') return true;
  if (error.code === 'ECONNABORTED') return true;
  // 5xx 服务器错误重试
  if (error.response?.status === 502) return true;
  if (error.response?.status === 503) return true;
  if (error.response?.status === 504) return true;
  if (error.response?.status && error.response.status >= 500) return true;
  return false;
};

// 获取重试延迟时间（毫秒）
const getRetryDelay = (error: AxiosError, retryCount: number): number => {
  // 网络错误增加初始延迟
  if (error.code === 'ERR_NETWORK') {
    // 网络错误：初始延迟更长，指数退避
    return Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
  }
  // 5xx 服务器错误：标准指数退避
  return RETRY_DELAY * retryCount;
};

export const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: API_REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

export const createAbortController = () => {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
  };
};

api.interceptors.request.use((config: RetryConfig) => {
  config.retryCount = config.retryCount || 0;
  return config;
});

interface ErrorResponse {
  message: string | string[];
  error?: string;
  statusCode?: number;
}

const getErrorMessage = (error: AxiosError<ErrorResponse>): string => {
  const { response } = error;
  if (!response) {
    if (error.code === 'ECONNABORTED') {
      return '请求超时，请检查网络连接';
    }
    if (error.code === 'ERR_NETWORK') {
      return '网络连接失败，请检查网络';
    }
    return error.message || '请求失败';
  }

  const { data, status } = response;

  switch (status) {
    case 400:
      return data?.message
        ? Array.isArray(data.message)
          ? data.message.join('；')
          : data.message
        : '请求参数错误';
    case 401:
      return '登录已过期，请重新登录';
    case 403:
      return '权限不足，无法执行此操作';
    case 404:
      return data?.message ? (Array.isArray(data.message) ? data.message.join('；') : data.message) : '资源不存在';
    case 409:
      return data?.message ? (Array.isArray(data.message) ? data.message.join('；') : data.message) : '资源冲突';
    case 500:
      return '服务器内部错误，请稍后重试';
    default:
      return data?.message ? (Array.isArray(data.message) ? data.message.join('；') : data.message) : `请求失败 (${status})`;
  }
};

let refreshPromise: Promise<boolean> | null = null;
let isRefreshingFailed = false;

// 重新登录成功后必须调用，否则 refresh 机制将永久失效
export const resetRefreshFailedFlag = (): void => {
  isRefreshingFailed = false;
};

const refreshAccessToken = async (): Promise<boolean> => {
  if (refreshPromise) return refreshPromise;

  // 如果已经刷新失败过，直接返回 false
  if (isRefreshingFailed) return false;

  refreshPromise = (async () => {
    try {
      await api.post('/auth/refresh');
      return true;
    } catch {
      isRefreshingFailed = true;
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError<ErrorResponse>) => {
    const config = error.config as RetryConfig;

    if (shouldRetry(error, config?.method) && config && (config.retryCount || 0) < MAX_RETRIES) {
      config.retryCount = (config.retryCount || 0) + 1;
      const delay = getRetryDelay(error, config.retryCount);
      await new Promise(resolve => setTimeout(resolve, delay));
      return api.request(config);
    }

    if (error.response?.status === 401) {
      if (config?._isRefreshRetry) {
        // 已经是刷新后的重试，直接拒绝
        return Promise.reject(error);
      }

      // 如果已经刷新失败过，直接拒绝，不重复跳转和 toast
      if (isRefreshingFailed) {
        return Promise.reject(error);
      }

      const success = await refreshAccessToken();

      if (success && config) {
        config._isRefreshRetry = true;
        return api.request(config);
      }

      // 刷新失败，只执行一次跳转和 toast
      if (!isRefreshingFailed) {
        isRefreshingFailed = true;
        toastService.error('登录已过期，请重新登录');
        setTimeout(() => {
          useAuthStore.getState().logout();
          window.location.hash = '#/login';
        }, LOGOUT_REDIRECT_DELAY_MS);
      }
      return Promise.reject(error);
    }

    // 检查是否跳过错误 toast
    if (!config?.skipErrorToast) {
      const message = getErrorMessage(error);
      // P1 修复：捕获后端返回的 x-request-id 关联前后端日志
      const traceId = error.response?.headers?.['x-request-id'] as string | undefined;
      if (traceId) {
        toastService.error(`${message} (ID: ${traceId.slice(0, 8)})`);
      } else {
        toastService.error(message);
      }
    }

    return Promise.reject(error);
  },
);

export type { AxiosResponse, AxiosError };
