import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock auth store
const mockUser = { id: '1', username: 'admin', name: '管理员', role: 'BOSS' as const };
const mockIsAuthenticated = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      isAuthenticated: mockIsAuthenticated,
      user: mockGetUser(),
    }),
}));

// Mock lazy-loaded pages to avoid actual imports
vi.mock('@/modules/auth/LoginPage', () => ({
  default: () => <div>登录页面</div>,
}));

vi.mock('@/components/NotFoundPage', () => ({
  default: () => <div>404 页面</div>,
}));

vi.mock('@/modules/dashboard/DashboardPage', () => ({
  default: () => <div>工作台</div>,
}));

vi.mock('@/components/layout/AppLayout', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

// 导入路由配置（在 mock 之后）
import { routes } from '../index';

function TestRouter({ initialEntries }: { initialEntries: string[] }) {
  const element = useRoutes(routes);
  return <>{element}</>;
}

function renderWithProviders(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <TestRouter initialEntries={initialEntries} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('routes/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockReturnValue(mockUser);
  });

  it('routes 数组已正确导出', () => {
    expect(routes).toBeDefined();
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);
  });

  it('包含 /login 路由', () => {
    const loginRoute = routes.find((r) => r.path === '/login');
    expect(loginRoute).toBeDefined();
  });

  it('包含受保护的根路由 /', () => {
    const rootRoute = routes.find((r) => r.path === '/');
    expect(rootRoute).toBeDefined();
    expect(rootRoute?.children).toBeDefined();
    expect(rootRoute!.children!.length).toBeGreaterThan(0);
  });

  it('未认证时访问 / 重定向到 /login', async () => {
    mockIsAuthenticated.mockReturnValue(false);
    mockGetUser.mockReturnValue(null);

    renderWithProviders(['/']);

    await waitFor(() => {
      expect(screen.getByText('登录页面')).toBeInTheDocument();
    });
  });

  it('已认证时访问 /login 正常渲染登录页', async () => {
    mockIsAuthenticated.mockReturnValue(true);

    renderWithProviders(['/login']);

    await waitFor(() => {
      expect(screen.getByText('登录页面')).toBeInTheDocument();
    });
  });
});
