import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from './api';

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CrudOptions<T, TList, TCreate, TUpdate, TQuery extends Record<string, unknown> = Record<string, unknown>> {
  endpoint: string;
  queryKey: string;
  listTransformer?: (data: PaginatedResult<TList>) => TList[];
}

export function useCrudList<T, TQuery extends Record<string, unknown> = Record<string, unknown>>(
  endpoint: string,
  queryKey: string,
  params?: TQuery & { page?: number; pageSize?: number },
  options?: Omit<UseQueryOptions<T[]>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: [queryKey, params],
    queryFn: async () => {
      const res = await api.get<PaginatedResult<T>>(`/${endpoint}`, { params });
      return res.data.items;
    },
    ...options,
  });
}

export function useCrudPaginated<T, TQuery extends Record<string, unknown> = Record<string, unknown>>(
  endpoint: string,
  queryKey: string,
  params?: TQuery & { page?: number; pageSize?: number },
  options?: Omit<UseQueryOptions<PaginatedResult<T>>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: [queryKey, params],
    queryFn: async () => {
      const res = await api.get<PaginatedResult<T>>(`/${endpoint}`, { params });
      return res.data;
    },
    ...options,
  });
}

export function useCrudItem<T>(
  endpoint: string,
  queryKey: string,
  id: string | undefined,
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn' | 'enabled'>
) {
  return useQuery({
    queryKey: [queryKey, id],
    queryFn: async () => (await api.get<T>(`/${endpoint}/${id}`)).data,
    enabled: !!id,
    ...options,
  });
}

export function useCrudCreate<T, TCreate>(endpoint: string, queryKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: TCreate) => (await api.post<T>(`/${endpoint}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [queryKey] }),
  });
}

export function useCrudUpdate<T, TUpdate>(endpoint: string, queryKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TUpdate }) =>
      (await api.patch<T>(`/${endpoint}/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: [queryKey] }),
  });
}

export function useCrudDelete(endpoint: string, queryKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/${endpoint}/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [queryKey] }),
  });
}

export interface CreateCrudHooksOptions {
  /** 列表 hook 返回分页对象 PaginatedResult<T>，而非 T[]。默认 false（返回数组）。 */
  paginated?: boolean;
}

export function createCrudHooks<
  T,
  TCreate,
  TUpdate,
  TQuery extends Record<string, unknown> = Record<string, unknown>
>(
  endpoint: string,
  queryKey: string,
) {
  return {
    useList: (params?: TQuery & { page?: number; pageSize?: number }) =>
      useCrudList<T, TQuery>(endpoint, queryKey, params),
    useItem: (id: string | undefined) => useCrudItem<T>(endpoint, queryKey, id),
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
) {
  return {
    useList: (params?: TQuery & { page?: number; pageSize?: number }) =>
      useCrudPaginated<T, TQuery>(endpoint, queryKey, params),
    useItem: (id: string | undefined) => useCrudItem<T>(endpoint, queryKey, id),
    useCreate: () => useCrudCreate<T, TCreate>(endpoint, queryKey),
    useUpdate: () => useCrudUpdate<T, TUpdate>(endpoint, queryKey),
    useDelete: () => useCrudDelete(endpoint, queryKey),
  };
}
