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

function mockSettleData(rows: Array<Record<string, unknown>>) {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/processingOrders?page=1&pageSize=50') {
      return { items: rows, total: rows.length, page: 1, pageSize: 50 };
    }
    if (path === '/processing-orders/settle-stats') {
      const unsettled = rows.filter((row) => row.settleStatus !== 'SETTLED');
      const settled = rows.filter((row) => row.settleStatus === 'SETTLED');
      return {
        unsettled: { count: unsettled.length, feeTotal: unsettled.reduce((sum, row) => sum + Number(row.totalFee ?? 0), 0) },
        settled: { count: settled.length, amountTotal: settled.reduce((sum, row) => sum + Number(row.settledAmount ?? 0), 0) },
      };
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
    expect(createBody).toMatchObject({
      patientId: 'p-1',
      number: 'PROC-NEW',
      teethNumbers: ['11', '21'],
      items: [{ name: '烤瓷冠', quantity: 1, unitPrice: 50000 }],
      totalFee: 50000,
    });
    expect(createBody.doctorId).toBeUndefined();
    expect(createBody.requestId).toBeTruthy();
    expect(await screen.findByText('加工单已创建')).toBeDefined();

    fireEvent.change(await screen.findByLabelText('变更加工状态'), { target: { value: 'SENT' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-1/status', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'SENT' }),
      }));
    });
    expect(await screen.findByText('加工单状态已更新')).toBeDefined();
  });

  it('validates required processing fields', async () => {
    mockData();
    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');
    fireEvent.click(screen.getByText('新建加工单'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、填写加工单号并至少添加一条有效明细')).toBeDefined();
  });

  it('uses the manual total fee when provided', async () => {
    mockData();
    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');

    fireEvent.click(screen.getByText('新建加工单'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('加工单号'), { target: { value: 'PROC-FEE' } });
    fireEvent.change(screen.getByLabelText('加工项目'), { target: { value: '烤瓷冠' } });
    fireEvent.change(screen.getByLabelText('加工数量'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('加工单价'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('总费用'), { target: { value: '700' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'proc-fee' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/processing-orders');
    const createBody = JSON.parse(String(createCall?.[1]?.body));
    expect(createBody.totalFee).toBe(70000);
    expect(createBody.items[0].unitPrice).toBe(50000);
  });

  it('shows settlement columns and settles an unsettled order through the dialog', async () => {
    mockSettleData([
      { id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'COMPLETED', settleStatus: 'UNSETTLED', totalFee: 50000 },
    ]);
    render(<ProcessingOrdersPage />, { wrapper });
    expect(await screen.findByText('PROC-1')).toBeDefined();
    expect(screen.getByText('未结算')).toBeDefined();
    expect(screen.getByText('—')).toBeDefined();
    expect(await screen.findByText(/未结算 1 单（金额 ¥500.00）/)).toBeDefined();

    fireEvent.click(screen.getByText('结算'));
    const amountInput = screen.getByLabelText('结算金额（元）') as HTMLInputElement;
    expect(amountInput.value).toBe('500.00');

    fireEvent.change(amountInput, { target: { value: '520.5' } });
    fireEvent.change(screen.getByLabelText('结算单号'), { target: { value: 'REF-001' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '月结对账' } });
    fireEvent.click(screen.getByText('确认结算'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-1/settle', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ amount: 52050, ref: 'REF-001', note: '月结对账' }),
      }));
    });
    expect(await screen.findByText('加工单已结算')).toBeDefined();
  });

  it('rejects an empty settlement amount without calling the API', async () => {
    mockSettleData([
      { id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'RECEIVED', settleStatus: 'UNSETTLED', totalFee: 30000 },
    ]);
    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');

    fireEvent.click(screen.getByText('结算'));
    fireEvent.change(screen.getByLabelText('结算金额（元）'), { target: { value: '' } });
    fireEvent.click(screen.getByText('确认结算'));

    expect(await screen.findByText('请输入有效的结算金额')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/processing-orders/proc-1/settle', expect.anything());
  });

  it('unsettles a settled processing order', async () => {
    mockSettleData([
      { id: 'proc-2', number: 'PROC-2', patientId: 'p-1', status: 'RECEIVED', settleStatus: 'SETTLED', settledAmount: 50000, totalFee: 50000 },
    ]);
    render(<ProcessingOrdersPage />, { wrapper });
    expect(await screen.findByText('PROC-2')).toBeDefined();
    expect(screen.getByText('已结算')).toBeDefined();
    expect(screen.getByText('¥500.00')).toBeDefined();
    expect(await screen.findByText(/已结算 1 单（金额 ¥500.00）/)).toBeDefined();

    fireEvent.click(screen.getByText('撤销结算'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-2/unsettle', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('已撤销结算')).toBeDefined();
  });
});
