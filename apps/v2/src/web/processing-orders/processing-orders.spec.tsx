// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcessingOrderFormFields } from './ProcessingOrderFormFields';
import { ProcessingStatusSelect } from './ProcessingStatusSelect';
import { flowStatsColumns, processingColumns } from './columns';
import { transitionProcessingOrder } from './api';
import { buildValidItems, emptyProcessingForm, joinList, newItem, reconcileProcessingItems } from './items';
import { apiRequest, fetchAllPages } from '../lib/api';
import { ToastProvider } from '../components/toast';
import type { ProcessingOrderForm, ProcessingRow } from './types';

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
  fetchAllPages: vi.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('processing-orders/items', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(fetchAllPages).mockReset();
  });

  it('creates default items and forms', () => {
    const item = newItem();
    expect(item.quantity).toBe('1');
    expect(item.status).toBe('DRAFT');
    const form = emptyProcessingForm();
    expect(form.items).toHaveLength(1);
    expect(form.shade).toBe('');
  });

  it('builds valid items and joins lists', () => {
    const valid = buildValidItems([
      { id: 'a', name: '基托', spec: '', quantity: '2', unitPrice: '100', subtotal: '', status: 'DRAFT' },
      { id: 'b', name: '  ', spec: '', quantity: '1', unitPrice: '100', subtotal: '', status: 'DRAFT' },
      { id: 'c', name: '免费', spec: '', quantity: '1', unitPrice: '0', subtotal: '', status: 'DRAFT' },
    ]);
    expect(valid).toHaveLength(2);
    expect(valid[0]).toEqual({ name: '基托', quantity: 2, unitPrice: 10000 });
    expect(valid[1]).toEqual({ name: '免费', quantity: 1, unitPrice: 0 });
    expect(joinList(['11', '21'])).toBe('11, 21');
    expect(joinList(null)).toBe('');
    expect(joinList('text')).toBe('text');
  });

  it('reconciles processing items with billed-style protection', async () => {
    vi.mocked(fetchAllPages).mockResolvedValue([
      { id: 'keep', name: '基托', spec: 'S', quantity: 1, unitPrice: 100, subtotal: 100, status: 'DRAFT' },
      { id: 'remove', name: '旧件', spec: '', quantity: 1, unitPrice: 100, subtotal: 100, status: 'DRAFT' },
    ]);
    const items = [
      { id: 'keep', name: '基托', spec: 'S', quantity: '2', unitPrice: '1', subtotal: '', status: 'DRAFT' },
      { id: undefined, name: '新件', spec: '', quantity: '1', unitPrice: '50', subtotal: '', status: 'DRAFT' },
      { id: 'bad', name: '无效', spec: '', quantity: '0', unitPrice: '100', subtotal: '', status: 'DRAFT' },
    ];
    await reconcileProcessingItems('po-1', items as never);

    expect(apiRequest).toHaveBeenCalledWith('/resources/processingOrderItems/keep', expect.objectContaining({ method: 'PATCH' }));
    expect(apiRequest).toHaveBeenCalledWith('/resources/processingOrderItems', expect.objectContaining({ method: 'POST' }));
    expect(apiRequest).toHaveBeenCalledWith('/resources/processingOrderItems/remove', expect.objectContaining({ method: 'DELETE' }));
    const postCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/processingOrderItems');
    expect(JSON.parse(String((postCall?.[1] as RequestInit)?.body))).toMatchObject({
      orderId: 'po-1',
      name: '新件',
      quantity: 1,
      unitPrice: 5000,
      status: 'DRAFT',
    });
  });
});

describe('processing-orders/api', () => {
  afterEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  it('transitions status and reports failures', async () => {
    const showToast = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);
    await transitionProcessingOrder(showToast, reload, 'po-1', 'SENT');
    expect(apiRequest).toHaveBeenCalledWith('/processing-orders/po-1/status', expect.objectContaining({ method: 'PATCH' }));
    expect(showToast).toHaveBeenCalledWith('加工单状态已更新', 'success');
    expect(reload).toHaveBeenCalled();

    vi.mocked(apiRequest).mockRejectedValueOnce(new Error(''));
    await transitionProcessingOrder(showToast, reload, 'po-1', 'SENT');
    expect(showToast).toHaveBeenCalledWith('状态更新失败', 'error');
  });
});

describe('ProcessingStatusSelect', () => {
  afterEach(() => {
    cleanup();
  });

  it('resets after transition and ignores empty selections', () => {
    const onTransition = vi.fn();
    render(<ProcessingStatusSelect rowId="row-1" onTransition={onTransition} />);
    const select = screen.getByLabelText('变更加工状态') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'SENT' } });
    expect(onTransition).toHaveBeenCalledWith('row-1', 'SENT');
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: '' } });
    expect(onTransition).toHaveBeenCalledTimes(1);
  });

  it('ignores transitions while disabled', () => {
    const onTransition = vi.fn();
    render(<ProcessingStatusSelect rowId="row-1" onTransition={onTransition} disabled />);
    const select = screen.getByLabelText('变更加工状态') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'SENT' } });
    expect(onTransition).not.toHaveBeenCalled();
  });
});

describe('ProcessingOrderFormFields', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(fetchAllPages).mockReset();
  });

  function FormHarness() {
    const [form, setForm] = useState<ProcessingOrderForm>(() => emptyProcessingForm());
    return (
      <ProcessingOrderFormFields
        form={form}
        update={(patch) => setForm((current) => ({ ...current, ...patch }))}
        editing={false}
        editingId={null}
      />
    );
  }

  it('updates fields and manages item rows', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path.startsWith('/resources/patients?')) {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<FormHarness />, { wrapper });
    await waitFor(() => {
      expect((screen.getByRole('option', { name: '张医生' }) as HTMLOptionElement).value).toBe('d-1');
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('加工单号'), { target: { value: 'PO-1' } });
    expect((screen.getByLabelText('加工单号') as HTMLInputElement).value).toBe('PO-1');
    fireEvent.change(screen.getByLabelText('颜色'), { target: { value: 'A2' } });
    fireEvent.change(screen.getByLabelText('牙位（逗号分隔）'), { target: { value: '11,21' } });
    fireEvent.change(screen.getByLabelText('总费用'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('加工项目'), { target: { value: '基托' } });
    fireEvent.change(screen.getByLabelText('加工数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('加工单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    expect(screen.getAllByLabelText('加工项目')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]);
    expect(screen.getAllByLabelText('加工项目')).toHaveLength(1);
  });

  it('backfills items when editing and reports failures', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'd-1', name: '张医生' }]);
    vi.mocked(fetchAllPages).mockResolvedValue([
      { id: 'i1', name: '基托', spec: 'S', quantity: 2, unitPrice: 10000, subtotal: 20000, status: 'DRAFT' },
    ]);
    const form = emptyProcessingForm();
    const update = vi.fn((patch) => Object.assign(form, patch));
    render(<ProcessingOrderFormFields form={form} update={update} editing editingId="po-1" />, { wrapper });
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ id: 'i1', name: '基托' })]) }));
    });

    cleanup();
    vi.mocked(apiRequest).mockResolvedValue([]);
    vi.mocked(fetchAllPages).mockRejectedValue(new Error(''));
    const onItemsLoaded = vi.fn();
    render(
      <ProcessingOrderFormFields
        form={emptyProcessingForm()}
        update={vi.fn()}
        onItemsLoaded={onItemsLoaded}
        editing
        editingId="po-2"
      />,
      { wrapper },
    );
    expect(await screen.findByText('明细加载失败，请关闭后重试')).toBeDefined();
    expect(onItemsLoaded).not.toHaveBeenCalled();
  });

  it('backfills sparse processing items with blank and default fallbacks', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    vi.mocked(fetchAllPages).mockResolvedValue([
      { id: 'i9', name: null, spec: null, quantity: null, unitPrice: null, subtotal: null, status: null },
    ]);
    const form = emptyProcessingForm();
    const update = vi.fn((patch) => Object.assign(form, patch));
    render(<ProcessingOrderFormFields form={form} update={update} editing editingId="po-9" />, { wrapper });
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'i9', name: '', spec: '', quantity: '1', unitPrice: '0.00', status: 'DRAFT' }),
        ]),
      }));
    });
  });
});

describe('processing-orders/columns', () => {
  it('renders processing and flow columns with fallbacks', () => {
    const row = {
      id: 'po-1',
      patientId: 'p-1',
      status: 'UNKNOWN',
      settleStatus: 'PENDING',
      settledAmount: null,
    };
    const get = (key: string, source: ProcessingRow) => {
      const column = processingColumns.find((entry) => entry.key === key);
      return column && typeof column.render === 'function' ? column.render(source) : '';
    };
    expect(get('patientId', row)).toBe('p-1');
    expect(get('status', row)).toBe('UNKNOWN');
    expect(get('settleStatus', row)).toBe('未结算');
    expect(get('settledAmount', row)).toBe('—');

    const settled = { id: 'po-1', patientIdLabel: '张三', status: 'COMPLETED', settleStatus: 'SETTLED', settledAmount: 12345 };
    expect(get('patientId', settled)).toBe('张三');
    expect(get('status', settled)).toBe('已完成');
    expect(get('settleStatus', settled)).toBe('已结算');
    expect(get('settledAmount', settled)).toBe('¥123.45');
    const flow = flowStatsColumns.find((entry) => entry.key === 'doneCount');
    expect(flow && typeof flow.render === 'function' ? flow.render({ id: 's', stepName: '1', doneCount: 2, inProgressCount: 0 }) : '').toBe('2');
  });
});
