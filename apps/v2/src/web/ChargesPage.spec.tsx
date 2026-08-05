// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChargesPage } from './ChargesPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const chargeList = {
  items: [{ id: 'c-1', number: 'N-1', totalAmount: 100, paidAmount: 50, status: 'PARTIAL' }],
  total: 1,
  page: 1,
  pageSize: 50,
};

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
    if (path === '/resources/patients?page=1&pageSize=200') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    return {};
  });
}

describe('ChargesPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates a charge with line items', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    expect(await screen.findByText('N-1')).toBeDefined();

    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('项目分类'), { target: { value: 'CLEAN' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      patientId: 'p-1',
      items: [{ name: '洁牙', category: 'CLEAN', price: 10000, quantity: 2 }],
    });
    expect(await screen.findByText('收费单已创建')).toBeDefined();
  });

  it('records payment and refund with dialogs', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    fireEvent.change(screen.getByLabelText('收款金额（元）'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('支付方式'), { target: { value: 'WECHAT' } });
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges/c-1/pay', expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"amount":5000'),
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: '退款' }));
    fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('退款原因'), { target: { value: '取消项目' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退款' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges/c-1/refund', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"amount":2000'),
      }));
    });
  });

  it('validates required charge fields', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    expect(await screen.findByText('请选择患者并至少填写一条有效收费明细')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
  });

  it('shows loading and error states', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<ChargesPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') throw new Error('charges failed');
      if (path === '/resources/patients?page=1&pageSize=200') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    expect(await screen.findByText('charges failed')).toBeDefined();
  });

  it('reports create, payment, and refund failures', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=200') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      throw new Error('charge failed');
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    expect((await screen.findAllByText('charge failed')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    fireEvent.change(screen.getByLabelText('收款金额（元）'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));
    expect((await screen.findAllByText('charge failed')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '退款' }));
    fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退款' }));
    expect((await screen.findAllByText('charge failed')).length).toBeGreaterThan(0);
  });

  it('validates payment and refund amounts', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));
    expect(await screen.findByText('请输入有效的收款金额')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    fireEvent.click(screen.getByRole('button', { name: '退款' }));
    fireEvent.click(screen.getByRole('button', { name: '确认退款' }));
    expect(await screen.findByText('请输入有效的退款金额')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
  });

  it('adds and removes charge line items and renders an empty state', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return { ...chargeList, items: [] };
      if (path === '/resources/patients?page=1&pageSize=200') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    expect(await screen.findByText('暂无收费单')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    expect(screen.getAllByLabelText('项目名称')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]);
    expect(screen.getAllByLabelText('项目名称')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '备注内容' } });
  });

  it('closes payment and refund dialogs from the backdrop', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!);
    fireEvent.click(screen.getByRole('button', { name: '退款' }));
    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!);
  });

  it('rejects invalid line items and reports non-error failures', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '无效项目' } });
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    expect(await screen.findByText('请选择患者并至少填写一条有效收费明细')).toBeDefined();

    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=200') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      throw 'boom';
    });
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    expect(await screen.findByText('创建收费失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    fireEvent.change(screen.getByLabelText('收款金额（元）'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));
    expect(await screen.findByText('收款失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '退款' }));
    fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退款' }));
    expect(await screen.findByText('退款失败')).toBeDefined();
  });
});
