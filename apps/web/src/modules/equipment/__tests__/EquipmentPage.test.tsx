import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseEquipmentList = vi.fn();
const mockUseCreateEquipment = vi.fn();
const mockUseUpdateEquipment = vi.fn();
const mockUseDeleteEquipment = vi.fn();

vi.mock('@/lib/equipment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/equipment')>();
  return {
    ...actual,
    useEquipmentList: (...args: unknown[]) => mockUseEquipmentList(...args),
    useCreateEquipment: (...args: unknown[]) => mockUseCreateEquipment(...args),
    useUpdateEquipment: (...args: unknown[]) => mockUseUpdateEquipment(...args),
    useDeleteEquipment: (...args: unknown[]) => mockUseDeleteEquipment(...args),
  };
});

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '' };
});

import EquipmentPage from '../EquipmentPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EquipmentPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EquipmentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseEquipmentList.mockReturnValue({ data: [], isLoading: false });
    mockUseCreateEquipment.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseUpdateEquipment.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseDeleteEquipment.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithProviders();

    expect(screen.getByText('设备管理')).toBeInTheDocument();
  });

  it('渲染添加设备按钮', () => {
    mockUseEquipmentList.mockReturnValue({ data: [], isLoading: false });
    mockUseCreateEquipment.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseUpdateEquipment.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockUseDeleteEquipment.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithProviders();

    expect(screen.getByText('新增设备')).toBeInTheDocument();
  });
});
