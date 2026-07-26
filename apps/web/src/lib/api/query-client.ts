import { QueryClient } from '@tanstack/react-query';

export const CACHE_TIMES = {
  DICT_STALE: 5 * 60 * 1000,
  DICT_GC: 10 * 60 * 1000,
  FAST_STALE: 30 * 1000,
  FAST_GC: 5 * 60 * 1000,
  DEFAULT_STALE: 5 * 60 * 1000,
  DEFAULT_GC: 10 * 60 * 1000,
} as const;

export type CacheStrategy = 'default' | 'dict' | 'fast';

export function getCacheOptions(strategy: CacheStrategy = 'default') {
  switch (strategy) {
    case 'dict':
      return {
        staleTime: CACHE_TIMES.DICT_STALE,
        gcTime: CACHE_TIMES.DICT_GC,
      };
    case 'fast':
      return {
        staleTime: CACHE_TIMES.FAST_STALE,
        gcTime: CACHE_TIMES.FAST_GC,
      };
    default:
      return {
        staleTime: CACHE_TIMES.DEFAULT_STALE,
        gcTime: CACHE_TIMES.DEFAULT_GC,
      };
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: CACHE_TIMES.DEFAULT_STALE,
      gcTime: CACHE_TIMES.DEFAULT_GC,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
