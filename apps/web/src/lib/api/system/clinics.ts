import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

export interface Clinic {
  id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  isActive: number;
  createdAt: string;
  updatedAt?: string;
}

/** 当前登录用户所属诊所（顶栏展示用）。诊所信息极少变化，给长缓存 */
export function useCurrentClinic() {
  return useQuery({
    queryKey: ['clinics', 'current'],
    queryFn: async ({ signal }) => (await api.get<Clinic | null>('/clinics/current', { signal })).data,
    staleTime: 30 * 60 * 1000,
  });
}
