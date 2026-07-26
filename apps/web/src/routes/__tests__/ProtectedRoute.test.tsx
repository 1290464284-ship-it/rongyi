import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProtectedRoute from '../ProtectedRoute';

// Mock auth store
const mockIsAuthenticated = vi.fn();
vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: () => boolean }) => unknown) =>
    selector({ isAuthenticated: mockIsAuthenticated }),
}));

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('已认证时渲染子组件', () => {
    mockIsAuthenticated.mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <ProtectedRoute>
                <div>受保护内容</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('受保护内容')).toBeInTheDocument();
  });

  it('未认证时重定向到 /login', () => {
    mockIsAuthenticated.mockReturnValue(false);

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <ProtectedRoute>
                <div>受保护内容</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>登录页面</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
    expect(screen.getByText('登录页面')).toBeInTheDocument();
  });
});
