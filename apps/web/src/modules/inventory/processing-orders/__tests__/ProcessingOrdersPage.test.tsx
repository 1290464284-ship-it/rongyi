import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseProcessingOrders = vi.fn();
const mockUseCreateProcessingOrder = vi.fn();

vi.mock('@/lib/api/inventory/processing-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/inventory/processing-orders')>();
  return {
    ...actual,
    useProcessingOrders: (...args: unknown[]) => mockUseProcessingOrders(...args),
    useCreateProcessingOrder: (...args: unknown[]) => mockUseCreateProcessingOrder(...args),
  };
});

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '' };
});

import ProcessingOrdersPage from '../ProcessingOrdersPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProcessingOrdersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProcessingOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    mockUseProcessingOrders.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false });
    mockUseCreateProcessingOrder.mockReturnValue({ mutateAsync: vi.fn() });

    renderWithProviders();

    expect(screen.getByText('加工单管理')).toBeInTheDocument();
  });
});
