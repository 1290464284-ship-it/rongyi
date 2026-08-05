// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcessingOrdersPage } from './ProcessingOrdersPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/processingOrders?page=1&pageSize=50') {
      return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    return {};
  });
}

describe('ProcessingOrdersPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates and transitions processing orders', async () => {
    mockData();
    render(<ProcessingOrdersPage />, { wrapper });
    expect(await screen.findByText('PROC-1')).toBeDefined();

    fireEvent.click(screen.getByText('新建加工单'));
await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('加工单号'), { target: { value: 'PROC-NEW' } });
    fireEvent.change(screen.getByLabelText('牙位（逗号分隔）'), { target: { value: '11,21' } });
    fireEvent.change(screen.getByLabelText('加工项目'), { target: { value: '烤瓷冠' } });
    fireEvent.change(screen.getByLabelText('加工数量'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('加工单价'), { target: { value: '500' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'proc-new' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/processing-orders');
    const createBody = JSON.parse(String(createCall?.[1]?.body));
    expect(createBody.items[0].unitPrice).toBe(50000);
    expect(createBody.totalFee).toBe(50000);
    expect(await screen.findByText('加工单已创建')).toBeDefined();

    fireEvent.change(await screen.findByLabelText('变更加工状态'), { target: { value: 'SENT' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('validates required processing fields', async () => {
    mockData();
    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');
    fireEvent.click(screen.getByText('新建加工单'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、填写加工单号并至少添加一条有效明细')).toBeDefined();
  });
});
