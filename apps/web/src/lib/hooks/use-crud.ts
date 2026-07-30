import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from '../api/api';
import { getCacheOptions, type CacheStrategy } from '../api/query-client';
import { toastService } from '../utils/toast-service';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CrudOptions<_T, TList, _TCreate, _TUpdate, _TQuery extends Record<string, unknown> = Record<string, unknown>> {
  endpoint: string;
  queryKey: string;
  listTransformer?: (data: PaginatedResult<TList>) => TList[];
}

export function useCrudList<T, TQuery extends Record<string, unknown> = Record<string, unknown>>(
  endpoint: string,
  queryKey: string,
  params?: TQuery & { page?: number; pageSize?: number },
  options?: Omit<UseQueryOptions<T[]>, 'queryKey' | 'queryFn'> & { cacheStrategy?: CacheStrategy }
) {
  const { cacheStrategy, ...queryOptions } = options ?? {};
  const cacheOpts = getCacheOptions(cacheStrategy);

  return useQuery({
    queryKey: [queryKey, params],
    queryFn: async ({ signal }) => {
      const res = await api.get<PaginatedResult<T>>(`/${endpoint}`, { params, signal });
      return res.data.items;
    },
    ...cacheOpts,
    ...queryOptions,
  });
}

export function useCrudPaginated<T, TQuery extends Record<string, unknown> = Record<string, unknown>>(
  endpoint: string,
  queryKey: string,
  params?: TQuery & { page?: number; pageSize?: number },
  options?: Omit<UseQueryOptions<PaginatedResult<T>>, 'queryKey' | 'queryFn'> & { cacheStrategy?: CacheStrategy }
) {
  const { cacheStrategy, ...queryOptions } = options ?? {};
  const cacheOpts = getCacheOptions(cacheStrategy);

  return useQuery({
    queryKey: [queryKey, params],
    queryFn: async ({ signal }) => {
      const res = await api.get<PaginatedResult<T>>(`/${endpoint}`, { params, signal });
      return res.data;
    },
    ...cacheOpts,
    ...queryOptions,
  });
}

export function useCrudItem<T>(
  endpoint: string,
  queryKey: string,
  id: string | undefined,
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn' | 'enabled'> & { cacheStrategy?: CacheStrategy }
) {
  const { cacheStrategy, ...queryOptions } = options ?? {};
  const cacheOpts = getCacheOptions(cacheStrategy);

  return useQuery({
    queryKey: [queryKey, id],
    queryFn: async ({ signal }) => (await api.get<T>(`/${endpoint}/${id}`, { signal })).data,
    enabled: !!id,
    ...cacheOpts,
    ...queryOptions,
  });
}

export function useCrudCreate<T, TCreate>(endpoint: string, queryKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: TCreate) => (await api.post<T>(`/${endpoint}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [queryKey] }),
    onError: (error: Error) => toastService.createError(queryKey, error),
  });
}

export function useCrudUpdate<T, TUpdate>(endpoint: string, queryKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TUpdate }) =>
      (await api.patch<T>(`/${endpoint}/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [queryKey] }),
    onError: (error: Error) => toastService.updateError(queryKey, error),
  });
}

export function useCrudDelete(endpoint: string, queryKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/${endpoint}/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [queryKey] }),
    onError: (error: Error) => toastService.deleteError(queryKey, error),
  });
}

export interface CreateCrudHooksOptions {
  /** 列表 hook 返回分页对象 PaginatedResult<T>，而非 T[]。默认 false（返回数组）。 */
  paginated?: boolean;
  /** 缓存策略：dict（字典类，5分钟stale/10分钟gc）、fast（高频，30秒stale/5分钟gc）、default */
  cacheStrategy?: CacheStrategy;
}

export function createCrudHooks<
  T,
  TCreate,
  TUpdate,
  TQuery extends Record<string, unknown> = Record<string, unknown>
>(
  endpoint: string,
  queryKey: string,
  options?: CreateCrudHooksOptions,
) {
  const cacheStrategy = options?.cacheStrategy;
  return {
    useList: (params?: TQuery & { page?: number; pageSize?: number }, opts?: Parameters<typeof useCrudList<T, TQuery>>[3]) =>
      useCrudList<T, TQuery>(endpoint, queryKey, params, { cacheStrategy, ...opts }),
    useItem: (id: string | undefined, opts?: Parameters<typeof useCrudItem<T>>[3]) =>
      useCrudItem<T>(endpoint, queryKey, id, { cacheStrategy, ...opts }),
    useCreate: () => useCrudCreate<T, TCreate>(endpoint, queryKey),
    useUpdate: () => useCrudUpdate<T, TUpdate>(endpoint, queryKey),
    useDelete: () => useCrudDelete(endpoint, queryKey),
  };
}

export function createPaginatedCrudHooks<
  T,
  TCreate,
  TUpdate,
  TQuery extends Record<string, unknown> = Record<string, unknown>
>(
  endpoint: string,
  queryKey: string,
  options?: CreateCrudHooksOptions,
) {
  const cacheStrategy = options?.cacheStrategy;
  return {
    useList: (params?: TQuery & { page?: number; pageSize?: number }, opts?: Parameters<typeof useCrudPaginated<T, TQuery>>[3]) =>
      useCrudPaginated<T, TQuery>(endpoint, queryKey, params, { cacheStrategy, ...opts }),
    useItem: (id: string | undefined, opts?: Parameters<typeof useCrudItem<T>>[3]) =>
      useCrudItem<T>(endpoint, queryKey, id, { cacheStrategy, ...opts }),
    useCreate: () => useCrudCreate<T, TCreate>(endpoint, queryKey),
    useUpdate: () => useCrudUpdate<T, TUpdate>(endpoint, queryKey),
    useDelete: () => useCrudDelete(endpoint, queryKey),
  };
}
