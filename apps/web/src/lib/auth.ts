import { useMutation } from '@tanstack/react-query';
import { api } from './api/api';
import type { StaffUser } from './staff';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: StaffUser;
}

export function useLogin() {
  return useMutation({
    mutationFn: async (data: LoginRequest) =>
      (await api.post<LoginResponse>('/auth/login', data)).data,
  });
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (data: ChangePasswordRequest) =>
      (await api.post<void>('/auth/change-password', data)).data,
  });
}
