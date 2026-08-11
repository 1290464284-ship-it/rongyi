// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcessingOrdersPage } from './ProcessingOrdersPage';
import { ProcessingSettleDialog } from './ProcessingSettleDialog';
import { apiRequest } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => {
  const apiRequest = vi.fn();
  return {
    apiRequest,
    fetchAllPages: vi.fn(async (path: string) => {
      const data = await apiRequest(`${path}&page=1&pageSize=100`);
      return data?.items ?? [];
    }),
  };
});

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

    expect(await screen.findByText('请输入有效的结算金额（需大于 0）')).toBeDefined();
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

  it('opens the flow dialog and renders processing steps', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/processing-orders/proc-1/steps') {
        return [
          { id: 's-1', stepName: '取模', status: 'DONE', sortOrder: 1, completedAt: '2026-08-01T10:00:00' },
          { id: 's-2', stepName: '制作', status: 'PENDING', sortOrder: 2, completedAt: null },
        ];
      }
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '流程' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('取模')).toBeDefined();
    expect(within(dialog).getByText('制作')).toBeDefined();
    expect(within(dialog).getAllByText('已完成').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('待处理').length).toBeGreaterThan(0);
    expect(within(dialog).getByText(formatDateTime('2026-08-01T10:00:00'))).toBeDefined();
    expect(within(dialog).getByText('—')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-1/steps');
    });
  });

  it('advances the flow via register-step', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/processing-orders/proc-1/steps') {
        return [
          { id: 's-1', stepName: '取模', status: 'DONE', sortOrder: 1, completedAt: '2026-08-01T10:00:00' },
          { id: 's-2', stepName: '制作', status: 'PENDING', sortOrder: 2, completedAt: null },
        ];
      }
      if (path === '/processing-orders/proc-1/register-step') {
        return [
          { id: 's-1', stepName: '取模', status: 'DONE', sortOrder: 1, completedAt: '2026-08-01T10:00:00' },
          { id: 's-2', stepName: '制作', status: 'IN_PROGRESS', sortOrder: 2, completedAt: null },
        ];
      }
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '流程' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('取模');
    fireEvent.click(within(dialog).getByRole('button', { name: '推进' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-1/register-step', expect.objectContaining({ method: 'POST' }));
    });
    const advanceCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/processing-orders/proc-1/register-step' && options?.method === 'POST',
    );
    expect(JSON.parse(String(advanceCall?.[1]?.body))).toEqual({});
    expect(await screen.findByText('流程已推进')).toBeDefined();
    expect((await within(dialog).findAllByText('进行中')).length).toBeGreaterThan(0);
  });

  it('adjusts a step status via set-step', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/processing-orders/proc-1/steps') {
        return [{ id: 's-1', stepId: 'st-1', stepName: '取模', status: 'PENDING', sortOrder: 1, completedAt: null }];
      }
      if (path === '/processing-orders/proc-1/set-step') {
        return { id: 's-1', stepId: 'st-1', stepName: '取模', status: 'DONE', sortOrder: 1, completedAt: '2026-08-02T08:00:00' };
      }
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '流程' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('取模');
    fireEvent.change(within(dialog).getByLabelText('调整取模'), { target: { value: 'DONE' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-1/set-step', expect.objectContaining({ method: 'POST' }));
    });
    const adjustCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/processing-orders/proc-1/set-step' && options?.method === 'POST',
    );
    expect(JSON.parse(String(adjustCall?.[1]?.body))).toEqual({ stepId: 'st-1', status: 'DONE' });
    expect(await screen.findByText('步骤状态已调整')).toBeDefined();
    expect((await within(dialog).findAllByText('已完成')).length).toBeGreaterThan(0);
  });

  it('keeps existing steps when the set-step response has an unmatched id', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/processing-orders/proc-1/steps') {
        return [{ id: 's-1', stepId: 'st-1', stepName: '取模', status: 'PENDING', sortOrder: 1, completedAt: null }];
      }
      if (path === '/processing-orders/proc-1/set-step') {
        return { id: 's-other', stepId: 'st-1', stepName: '取模', status: 'DONE', sortOrder: 1, completedAt: '2026-08-02T08:00:00' };
      }
      return {};
    });
    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '流程' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('取模');
    fireEvent.change(within(dialog).getByLabelText('调整取模'), { target: { value: 'DONE' } });
    expect(await screen.findByText('步骤状态已调整')).toBeDefined();
    expect(within(dialog).getAllByText('待处理').length).toBeGreaterThan(0);
  });

  it('renders flow statistics and filters them by date', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path.startsWith('/processing-flow-stats')) {
        return { from: null, to: null, steps: [{ stepId: 'st-1', stepName: '取模', doneCount: 3, inProgressCount: 1 }] };
      }
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    const section = (await screen.findByText('流程统计')).closest('section') as HTMLElement;
    expect(await within(section).findByText('取模')).toBeDefined();
    expect(within(section).getByText('3')).toBeDefined();
    expect(within(section).getByText('1')).toBeDefined();

    fireEvent.change(screen.getByLabelText('统计开始日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('统计结束日期'), { target: { value: '2026-08-31' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-flow-stats?from=2026-08-01&to=2026-08-31');
    });
  });

  it('edits a processing order: prefills the form, PATCHes the order and reconciles items', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return {
          items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT', shade: 'A2', teethNumbers: ['11', '21'], totalFee: 50000 }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/processingOrderItems?orderId=proc-1&page=1&pageSize=100') {
        return { items: [{ id: 'poi-1', name: '烤瓷冠', spec: 'A2-1', quantity: 1, unitPrice: 50000, subtotal: 50000, status: 'DRAFT' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('加工单号') as HTMLInputElement).value).toBe('PROC-1');
    });
    expect((screen.getByLabelText('颜色') as HTMLInputElement).value).toBe('A2');
    expect((screen.getByLabelText('牙位（逗号分隔）') as HTMLInputElement).value).toBe('11, 21');
    expect((screen.getByLabelText('总费用') as HTMLInputElement).value).toBe('500.00');

    // 明细异步回填
    await waitFor(() => {
      expect((screen.getByLabelText('加工项目') as HTMLInputElement).value).toBe('烤瓷冠');
    });
    fireEvent.change(screen.getByLabelText('加工数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/processingOrders/proc-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path === '/resources/processingOrders/proc-1' && options?.method === 'PATCH');
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      number: 'PROC-1',
      shade: 'A2',
      teethNumbers: ['11', '21'],
      totalFee: 50000,
      status: 'DRAFT',
    });
    const itemPatchCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path === '/resources/processingOrderItems/poi-1' && options?.method === 'PATCH');
    expect(JSON.parse(String(itemPatchCall?.[1]?.body))).toMatchObject({
      name: '烤瓷冠',
      spec: 'A2-1',
      quantity: 2,
      unitPrice: 50000,
      subtotal: 100000,
      status: 'DRAFT',
    });
    expect(await screen.findByText('加工单已更新')).toBeDefined();
  });

  it('reconciles processing items: posts new rows and deletes removed ones', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT', totalFee: 50000 }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/processingOrderItems?orderId=proc-1&page=1&pageSize=100') {
        return { items: [{ id: 'poi-1', name: '烤瓷冠', spec: 'A2-1', quantity: 1, unitPrice: 50000, subtotal: 50000, status: 'DRAFT' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('加工项目') as HTMLInputElement).value).toBe('烤瓷冠');
    });

    // 新增一条明细并填写，然后移除原有明细
    fireEvent.click(screen.getByText('添加明细'));
    const nameInputs = screen.getAllByLabelText('加工项目');
    expect(nameInputs.length).toBe(2);
    fireEvent.change(nameInputs[1], { target: { value: '全瓷冠' } });
    fireEvent.change(screen.getAllByLabelText('加工数量')[1], { target: { value: '1' } });
    fireEvent.change(screen.getAllByLabelText('加工单价')[1], { target: { value: '300' } });
    fireEvent.click(screen.getAllByText('移除')[0]);
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/processingOrderItems', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path === '/resources/processingOrderItems' && options?.method === 'POST');
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      orderId: 'proc-1',
      name: '全瓷冠',
      quantity: 1,
      unitPrice: 30000,
      subtotal: 30000,
      status: 'DRAFT',
    });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/processingOrderItems/poi-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('加工单已更新')).toBeDefined();
  });

  it('deletes a processing order after confirmation', async () => {
    mockData();
    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/processingOrders/proc-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('加工单已删除')).toBeDefined();
  });

  it('closes the flow dialog and ignores stale step responses', async () => {
    let resolveSteps: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/processing-orders/proc-1/steps') {
        return await new Promise((resolve) => { resolveSteps = resolve; });
      }
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '流程' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('流程加载中...')).toBeDefined();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    resolveSteps?.([{ id: 's-1', stepName: '取模', status: 'DONE', sortOrder: 1, completedAt: null }]);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('shows an error when flow steps fail to load', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/processing-orders/proc-1/steps') throw new Error('steps failed');
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '流程' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('reports advance and adjust failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/processing-orders/proc-1/steps') {
        return [{ id: 's-1', stepId: 'st-1', stepName: '取模', status: 'PENDING', sortOrder: 1, completedAt: null }];
      }
      if (path === '/processing-orders/proc-1/register-step') throw new Error('');
      if (path === '/processing-orders/proc-1/set-step') throw new Error('');
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '流程' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('取模');
    fireEvent.click(within(dialog).getByRole('button', { name: '推进' }));
    expect(await screen.findByText('推进流程失败')).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('调整取模'), { target: { value: 'DONE' } });
    expect(await screen.findByText('调整步骤失败')).toBeDefined();
  });

  it('reports unsettle failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-2', number: 'PROC-2', patientId: 'p-1', status: 'RECEIVED', settleStatus: 'SETTLED', settledAmount: 50000, totalFee: 50000 }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/processing-orders/settle-stats') {
        return { settled: { count: 1, amountTotal: 50000 }, unsettled: { count: 0, feeTotal: 0 } };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (method === 'POST' && path === '/processing-orders/proc-2/unsettle') throw new Error('');
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-2');
    fireEvent.click(screen.getByRole('button', { name: '撤销结算' }));
    expect(await screen.findByText('撤销结算失败')).toBeDefined();
  });

  it('reports update failure with the partial-save hint', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT', totalFee: 50000 }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/processingOrderItems?orderId=proc-1&page=1&pageSize=100') {
        return { items: [{ id: 'poi-1', name: '烤瓷冠', spec: 'A2-1', quantity: 1, unitPrice: 50000, subtotal: 50000, status: 'DRAFT' }], total: 1, page: 1, pageSize: 100 };
      }
      if (method === 'PATCH' && path === '/resources/processingOrders/proc-1') throw new Error('');
      return {};
    });

    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('加工单号') as HTMLInputElement).value).toBe('PROC-1');
    });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('更新加工单失败；部分明细可能未保存，请核对后重试')).toBeDefined();
  });

  it('warns about dropped invalid processing detail rows', async () => {
    mockData();
    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');
    fireEvent.click(screen.getByText('新建加工单'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('加工单号'), { target: { value: 'PROC-NEW' } });
    fireEvent.change(screen.getByLabelText('加工项目'), { target: { value: '烤瓷冠' } });
    fireEvent.change(screen.getByLabelText('加工数量'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('加工单价'), { target: { value: '500' } });
    fireEvent.click(screen.getByText('添加明细'));
    await waitFor(() => {
      expect(screen.getAllByLabelText('加工项目')).toHaveLength(2);
    });
    fireEvent.change(screen.getAllByLabelText('加工项目')[1], { target: { value: '全瓷冠' } });
    fireEvent.change(screen.getAllByLabelText('加工数量')[1], { target: { value: '' } });
    fireEvent.change(screen.getAllByLabelText('加工单价')[1], { target: { value: '300' } });
    fireEvent.click(screen.getByText('保存'));

    expect(await screen.findByText('1 条明细因缺少有效数量或单价将被忽略')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/processing-orders');
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body.items).toHaveLength(1);
  });

  it('ignores a stale item backfill after closing the edit dialog', async () => {
    let resolveItems: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/processingOrderItems?orderId=proc-1&page=1&pageSize=100') {
        return await new Promise((resolve) => { resolveItems = resolve; });
      }
      return {};
    });
    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    resolveItems?.({ items: [{ id: 'poi-1', name: '烤瓷冠', quantity: 1, unitPrice: 50000, subtotal: 50000 }], total: 1, page: 1, pageSize: 100 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores stale advance and adjust responses after closing the flow dialog', async () => {
    let resolveAdvance: ((value: unknown) => void) | undefined;
    let resolveAdjust: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/processing-orders/proc-1/steps') {
        return [{ id: 's-1', stepId: null, stepName: '取模', status: 'PENDING', sortOrder: 1, completedAt: null }];
      }
      if (method === 'POST' && path === '/processing-orders/proc-1/register-step') {
        return await new Promise((resolve) => { resolveAdvance = resolve; });
      }
      if (method === 'POST' && path === '/processing-orders/proc-1/set-step') {
        return await new Promise((resolve) => { resolveAdjust = resolve; });
      }
      return {};
    });
    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '流程' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('取模');
    fireEvent.click(within(dialog).getByRole('button', { name: '推进' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    resolveAdvance?.([{ id: 's-1', stepName: '取模', status: 'DONE', sortOrder: 1, completedAt: null }]);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '流程' }));
    const dialog2 = await screen.findByRole('dialog');
    await within(dialog2).findByText('取模');
    fireEvent.change(within(dialog2).getByLabelText('调整取模'), { target: { value: 'DONE' } });
    fireEvent.keyDown(dialog2, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    resolveAdjust?.({ id: 's-1', stepName: '取模', status: 'DONE', sortOrder: 1, completedAt: null });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('prefills sparse processing rows when editing', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return { items: [{ id: 'proc-x', status: null }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      return {};
    });
    render(<ProcessingOrdersPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('加工单号') as HTMLInputElement).value).toBe('');
    });
  });

  it('calculates the total fee from items when the edited fee is zero', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/processingOrders?page=1&pageSize=50') {
        return {
          items: [{ id: 'proc-1', number: 'PROC-1', patientId: 'p-1', status: 'DRAFT', totalFee: 0 }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/processingOrderItems?orderId=proc-1&page=1&pageSize=100') {
        return {
          items: [{ id: 'poi-1', name: '烤瓷冠', spec: 'A2-1', quantity: 1, unitPrice: 50000, subtotal: 50000, status: 'DRAFT' }],
          total: 1,
          page: 1,
          pageSize: 100,
        };
      }
      return {};
    });
    render(<ProcessingOrdersPage />, { wrapper });
    await screen.findByText('PROC-1');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('加工项目') as HTMLInputElement).value).toBe('烤瓷冠');
    });
    fireEvent.change(screen.getByLabelText('加工数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/processingOrders/proc-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) =>
      path === '/resources/processingOrders/proc-1' && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      number: 'PROC-1',
      totalFee: 100000,
    });
  });
});

describe('ProcessingSettleDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  function renderDialog(target: { id: string; totalFee?: number | null } | null) {
    const showToast = vi.fn();
    const utils = render(
      <ProcessingSettleDialog
        target={target as never}
        reload={vi.fn().mockResolvedValue(undefined)}
        onSettled={vi.fn()}
        onClose={vi.fn()}
        showToast={showToast}
      />,
      { wrapper },
    );
    return { ...utils, showToast };
  }

  it('rejects an invalid settlement amount and allows a later retry', async () => {
    const { showToast } = renderDialog({ id: 'proc-1', totalFee: 50000 });
    const input = screen.getByLabelText('结算金额（元）') as HTMLInputElement;
    expect(input.value).toBe('500.00');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByText('确认结算'));
    expect(showToast).toHaveBeenCalledWith('请输入有效的结算金额（需大于 0）', 'error');
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('omits empty reference and note from the payload', async () => {
    renderDialog({ id: 'proc-1', totalFee: 30000 });
    fireEvent.click(screen.getByText('确认结算'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-1/settle', expect.objectContaining({
        method: 'POST',
      }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/processing-orders/proc-1/settle');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ amount: 30000 });
  });
});
