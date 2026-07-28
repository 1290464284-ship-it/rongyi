import { useMutation } from '@tanstack/react-query';
import { api, resetRefreshFailedFlag } from './api/api';
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
    mutationFn: async (data: LoginRequest) => {
      const res = (await api.post<LoginResponse>('/auth/login', data)).data;
      // 登录成功后重置 refresh 失败标志，恢复 token 自动刷新能力
      resetRefreshFailedFlag();
      return res;
    },
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
