import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

export interface StaffUser {
  id: string;
  username: string;
  name: string;
  role: 'BOSS' | 'DOCTOR' | 'RECEPTIONIST';
  phone?: string | null;
  active: boolean;
  createdAt: string;
}

export function useStaff() {
  return useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await api.get<StaffUser[]>('/auth/users')).data,
  });
}

export interface CreateStaffDto {
  username: string;
  name: string;
  role: 'BOSS' | 'DOCTOR' | 'RECEPTIONIST';
  phone?: string;
  password: string;
}

export function useCreateStaff() {
  return useCrudCreate<StaffUser, CreateStaffDto>('auth/users', 'staff');
}

export interface UpdateStaffDto {
  name?: string;
  role?: 'BOSS' | 'DOCTOR' | 'RECEPTIONIST';
  phone?: string;
  active?: boolean;
}

export function useUpdateStaff() {
  return useCrudUpdate<StaffUser, UpdateStaffDto>('auth/users', 'staff');
}

export function useDeleteStaff() {
  return useCrudDelete('auth/users', 'staff');
}
