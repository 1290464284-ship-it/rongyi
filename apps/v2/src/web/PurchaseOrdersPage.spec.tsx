// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData(status = 'PENDING') {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
      return { items: [{ id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/suppliers?page=1&pageSize=100') {
      return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/resources/inventoryItems?page=1&pageSize=100') {
      return { items: [{ id: 'i-1', name: '耗材' }], total: 1, page: 1, pageSize: 200 };
    }
    return {};
  });
}

describe('PurchaseOrdersPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates and receives purchase orders', async () => {
    mockData();
    render(<PurchaseOrdersPage />, { wrapper });
    expect(await screen.findByText('PO-1')).toBeDefined();

    fireEvent.click(screen.getByText('新建采购单'));
    await waitFor(() => {
      expect((screen.getByLabelText('采购项目') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('采购单号'), { target: { value: 'PO-NEW' } });
    fireEvent.change(screen.getByLabelText('供应商'), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('采购项目'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByLabelText('采购数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('采购单价'), { target: { value: '100' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'po-new' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/purchase-orders');
    const createBody = JSON.parse(String(createCall?.[1]?.body));
    expect(createBody.items[0]).toMatchObject({ itemId: 'i-1', name: '耗材', quantity: 2, unitPrice: 10000 });
    expect(createBody.supplierId).toBe('s-1');
    expect(createBody.number).toBe('PO-NEW');
    expect(await screen.findByText('采购单已创建')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '收货' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders/po-1/receive', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText('采购单已收货')).toBeDefined();
  });

  it('validates required purchase fields', async () => {
    mockData();
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByText('新建采购单'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请填写采购单号并至少添加一条有效明细')).toBeDefined();
  });

  it('disables the receive button for non-pending orders', async () => {
    mockData('RECEIVED');
    render(<PurchaseOrdersPage />, { wrapper });
    expect(await screen.findByText('PO-1')).toBeDefined();
    expect((screen.getByRole('button', { name: '收货' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
