import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseStaff = vi.fn();
const mockUseCreateStaff = vi.fn();
const mockUseUpdateStaff = vi.fn();
const mockUseDeleteStaff = vi.fn();

vi.mock('@/lib/staff', () => ({
  useStaff: (...args: unknown[]) => mockUseStaff(...args),
  useCreateStaff: (...args: unknown[]) => mockUseCreateStaff(...args),
  useUpdateStaff: (...args: unknown[]) => mockUseUpdateStaff(...args),
  useDeleteStaff: (...args: unknown[]) => mockUseDeleteStaff(...args),
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '' };
});

import StaffPage from '../StaffPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StaffPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('StaffPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseStaff.mockReturnValue({ data: [], isLoading: false });
    mockUseCreateStaff.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseUpdateStaff.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseDeleteStaff.mockReturnValue({ mutate: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('员工管理')).toBeInTheDocument();
  });

  it('渲染添加员工按钮', () => {
    mockUseStaff.mockReturnValue({ data: [], isLoading: false });
    mockUseCreateStaff.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseUpdateStaff.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseDeleteStaff.mockReturnValue({ mutate: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('添加员工')).toBeInTheDocument();
  });

  it('无数据时显示空状态', () => {
    mockUseStaff.mockReturnValue({ data: [], isLoading: false });
    mockUseCreateStaff.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseUpdateStaff.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseDeleteStaff.mockReturnValue({ mutate: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('暂无员工数据')).toBeInTheDocument();
  });

  it('显示员工总数', () => {
    mockUseStaff.mockReturnValue({ data: [{ id: '1', name: '王医生', username: 'wang', role: 'DOCTOR', createdAt: '2024-01-01' }], isLoading: false });
    mockUseCreateStaff.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseUpdateStaff.mockReturnValue({ mutateAsync: vi.fn() });
    mockUseDeleteStaff.mockReturnValue({ mutate: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('1 人')).toBeInTheDocument();
  });
});
