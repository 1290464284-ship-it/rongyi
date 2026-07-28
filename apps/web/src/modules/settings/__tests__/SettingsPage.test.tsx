import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseSettings = vi.fn();
const mockUseUpdateSettings = vi.fn();
const mockUseOperationLogs = vi.fn();

vi.mock('@/lib/api/system/settings', () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
  useUpdateSettings: (...args: unknown[]) => mockUseUpdateSettings(...args),
}));

vi.mock('@/lib/api/system/operation-logs', () => ({
  useOperationLogs: (...args: unknown[]) => mockUseOperationLogs(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDateTime: (d: string) => d?.slice(0, 16) ?? '' };
});

import SettingsPage from '../SettingsPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseSettings.mockReturnValue({ data: null, isLoading: false });
    mockUseUpdateSettings.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseOperationLogs.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });

    renderWithProviders();

    expect(screen.getByText('系统设置')).toBeInTheDocument();
  });

  it('显示 Tab 导航', () => {
    mockUseSettings.mockReturnValue({ data: null, isLoading: false });
    mockUseUpdateSettings.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseOperationLogs.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });

    renderWithProviders();

    expect(screen.getByText('诊所信息')).toBeInTheDocument();
    expect(screen.getByText('操作日志')).toBeInTheDocument();
  });

  it('默认显示诊所信息 Tab', () => {
    mockUseSettings.mockReturnValue({ data: null, isLoading: false });
    mockUseUpdateSettings.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseOperationLogs.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });

    renderWithProviders();

    expect(screen.getByText('诊所基本信息')).toBeInTheDocument();
  });
});
