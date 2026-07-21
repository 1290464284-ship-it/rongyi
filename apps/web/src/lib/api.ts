import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig, type AxiosRequestConfig } from 'axios';
import { toastService } from './toast-service';
import { useAuthStore } from './auth-store';

const isElectron = navigator.userAgent.includes('Electron');
const apiBaseUrl = isElectron ? 'http://localhost:3001/api' : '/api';

const MAX_RETRIES = 1;
const RETRY_DELAY = 1000;

interface RetryConfig extends InternalAxiosRequestConfig {
  retryCount?: number;
  _isRefreshRetry?: boolean;
}

interface ApiRequestConfig extends AxiosRequestConfig {
  signal?: AbortSignal;
}

const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];
const shouldRetry = (error: AxiosError, method?: string): boolean => {
  if (method && WRITE_METHODS.includes(method.toUpperCase())) return false;
  const m = (method || 'get').toLowerCase();
  if (m !== 'get' && m !== 'head' && m !== 'options') {
    return false;
  }
  if (error.code === 'ERR_NETWORK') return true;
  if (error.code === 'ECONNABORTED') return true;
  if (error.response?.status === 502) return true;
  if (error.response?.status === 503) return true;
  if (error.response?.status === 504) return true;
  return false;
};

export const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30000,
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

const refreshAccessToken = async (): Promise<boolean> => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      await api.post('/auth/refresh');
      return true;
    } catch {
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
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (config.retryCount || 1)));
      return api.request(config);
    }

    if (error.response?.status === 401) {
      if (config?._isRefreshRetry) {
        toastService.error('登录已过期，请重新登录');
        setTimeout(() => {
          useAuthStore.getState().logout();
          window.location.hash = '#/login';
        }, 1000);
        return Promise.reject(error);
      }

      const success = await refreshAccessToken();

      if (success && config) {
        config._isRefreshRetry = true;
        return api.request(config);
      }

      toastService.error('登录已过期，请重新登录');
      setTimeout(() => {
        useAuthStore.getState().logout();
        window.location.hash = '#/login';
      }, 1000);
      return Promise.reject(error);
    }

    const message = getErrorMessage(error);
    toastService.error(message);

    return Promise.reject(error);
  },
);

export type { AxiosResponse, AxiosError };
