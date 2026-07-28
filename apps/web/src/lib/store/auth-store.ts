import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserRole } from '@dental/shared';
import { queryClient } from '../api/query-client';

interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
}

interface AuthState {
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      login: (user) => set({ user }),
      // 8.2: logout 时清除所有 React Query 缓存，避免下个用户看到上个用户的数据
      logout: () => {
        set({ user: null });
        // React Query 缓存在内存中，直接清空 queryClient 即可
        queryClient.clear();
      },
      isAuthenticated: () => get().user !== null,
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
