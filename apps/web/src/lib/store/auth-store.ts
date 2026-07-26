import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: 'BOSS' | 'DOCTOR' | 'RECEPTIONIST';
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
        // 清除 localStorage 中其他业务缓存（React Query 默认持久化在 localStorage）
        if (typeof window !== 'undefined') {
          // 移除 React Query 缓存键
          for (const key of Object.keys(localStorage)) {
            if (key.startsWith('@@') || key.includes('query') || key.includes('mutation')) {
              localStorage.removeItem(key);
            }
          }
        }
      },
      isAuthenticated: () => get().user !== null,
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
