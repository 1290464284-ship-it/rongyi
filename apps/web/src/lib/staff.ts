import { useQuery } from '@tanstack/react-query';
import { api } from './api/api';
import { useCrudCreate, useCrudUpdate, useCrudDelete } from './hooks/use-crud';
import { getCacheOptions } from './api/query-client';
import type { UserRole } from '@dental/shared';

const DICT_CACHE = getCacheOptions('dict');

export interface StaffUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  phone?: string | null;
  active: boolean;
  createdAt: string;
}

export function useStaff(params?: { role?: string }) {
  return useQuery({
    queryKey: ['staff', params],
    queryFn: async () => (await api.get<StaffUser[]>('/auth/users', { params })).data,
    ...DICT_CACHE,
  });
}

export function useDoctors() {
  return useStaff({ role: 'DOCTOR' });
}

export interface CreateStaffDto {
  username: string;
  name: string;
  role: UserRole;
  phone?: string;
  password: string;
}

export function useCreateStaff() {
  return useCrudCreate<StaffUser, CreateStaffDto>('auth/users', 'staff');
}

export interface UpdateStaffDto {
  name?: string;
  role?: UserRole;
  phone?: string;
  active?: boolean;
}

export function useUpdateStaff() {
  return useCrudUpdate<StaffUser, UpdateStaffDto>('auth/users', 'staff');
}

export function useDeleteStaff() {
  return useCrudDelete('auth/users', 'staff');
}
