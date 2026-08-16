import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';

/**
 * `/doctors` 返回的行形状（与 `auth.listDoctors` 对齐：id/name/phone/role）。
 * 保留 `Record<string, unknown>` 基类型以兼容既有调用点对扩展字段（active 等）的访问。
 */
export type DoctorRow = Record<string, unknown> & {
  id: string;
  name?: string | null;
  role?: string | null;
  active?: unknown;
};

/**
 * 医生下拉统一数据源。queryKey 固定为 `['doctors']` 且 `staleTime: Infinity`，
 * 让跨页复用的医生列表只请求一次，缓存可跨页面/表单复用。
 */
export function useDoctors() {
  return useQuery({
    queryKey: ['doctors'],
    queryFn: () => apiRequest<DoctorRow[]>('/doctors'),
    staleTime: Infinity,
  });
}
