// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrintPreview } from './PrintPreview';
import { PlanFormFields } from './PlanFormFields';
import { buildValidItems, cleanupOrphanPlan, emptyPlanForm, newItem, updatePlanWithItems } from './plan-utils';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';
import type { TreatmentPlanForm } from './types';

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock('../lib/api', () => ({
  apiRequest: mockApiRequest,
  fetchAllPages: vi.fn(async (path: string) => {
    const page = await mockApiRequest(path);
    return Array.isArray(page) ? page : ((page as { items?: unknown[] })?.items ?? []);
  }),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('plan-utils', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates default items and forms', () => {
    const item = newItem();
    expect(item.quantity).toBe('1');
    expect(item.status).toBe('PLANNED');
    const form = emptyPlanForm();
    expect(form.status).toBe('APPROVED');
    expect(form.items).toHaveLength(1);
  });

  it('builds valid item payloads and drops invalid rows', () => {
    const rows = [
      { id: 'a', name: '洁牙', category: '', price: '100', quantity: '2', teethNumbers: '11, 21', status: 'PLANNED' },
      { id: 'b', name: '  ', price: '100', quantity: '1', teethNumbers: '' },
      { id: 'c', name: '免费', price: '0', quantity: '1', teethNumbers: '' },
      { id: 'd', name: '零数量', price: '100', quantity: '0', teethNumbers: '' },
    ];
    const valid = buildValidItems(rows as never);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({
      name: '洁牙',
      category: 'GENERAL',
      price: 10000,
      quantity: 2,
      teethNumbers: ['11', '21'],
      status: 'PLANNED',
    });
    expect(valid[0].code).toMatch(/^ITEM-/);
  });

  it('reconciles plan items with billed protection', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/treatmentPlans/plan-1' && method === 'PATCH') return {};
      if (path === '/resources/treatmentPlanItems?planId=plan-1') {
        return {
          items: [
            { id: 'keep', code: 'A', name: 'A', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: ['11'], status: 'PLANNED', billed: 0 },
            { id: 'bill', code: 'B', name: 'B', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED', billed: 1 },
            { id: 'remove', code: 'C', name: 'C', category: 'GENERAL', price: 100, quantity: 1, teethNumbers: [], status: 'PLANNED', billed: 0 },
          ],
          total: 3,
          page: 1,
          pageSize: 100,
        };
      }
      if (path === '/resources/treatmentPlanItems' && method === 'POST') return {};
      if (method === 'PATCH' && path === '/resources/treatmentPlanItems/keep') return {};
      if (method === 'DELETE' && path === '/resources/treatmentPlanItems/remove') return {};
      return {};
    });
    const form: TreatmentPlanForm = {
      patientId: 'p-1',
      doctorId: 'd-1',
      name: '计划',
      status: 'APPROVED',
      totalFee: '',
      remark: '',
      items: [
        {
          id: undefined,
          code: '',
          name: '新项目',
          category: '',
          price: '50',
          quantity: '2',
          teethNumbers: '11, 21',
          status: 'PLANNED',
          billed: false,
        } as unknown as TreatmentPlanForm['items'][number],
        { id: 'keep', code: 'A', name: 'A', category: 'GENERAL', price: '1', quantity: '1', teethNumbers: '11', status: 'PLANNED', billed: false },
        { id: 'bill', code: 'B', name: 'B2', category: 'GENERAL', price: '1', quantity: '1', teethNumbers: '', status: 'PLANNED', billed: true },
      ],
    };
    await updatePlanWithItems(form, 'plan-1');

    const patch = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/resources/treatmentPlans/plan-1');
    expect(JSON.parse(String((patch?.[1] as RequestInit)?.body))).toMatchObject({
      patientId: 'p-1',
      name: '计划',
      totalFee: 10200,
    });
    expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlanItems', expect.objectContaining({ method: 'POST' }));
    expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlanItems/remove', expect.objectContaining({ method: 'DELETE' }));
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/treatmentPlanItems/keep', expect.objectContaining({ method: 'PATCH' }));
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/treatmentPlanItems/bill', expect.objectContaining({ method: 'PATCH' }));
  });

  it('throws when the plan id is missing', async () => {
    await expect(updatePlanWithItems(emptyPlanForm(), null)).rejects.toThrow('编辑目标不存在，请刷新后重试');
  });

  it('cleans orphan plans and reports item failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'DELETE' && path === '/resources/treatmentPlanItems/item-1') {
        throw new Error('');
      }
      return {};
    });
    const showToast = vi.fn();
    await cleanupOrphanPlan('plan-9', ['item-1', 'item-2'], showToast);
    expect(showToast).toHaveBeenCalledWith('删除治疗计划明细 item-1 失败，请检查未完成数据', 'error');
    expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlans/plan-9', expect.objectContaining({ method: 'DELETE' }));
  });

  it('reports orphan plan deletion failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'DELETE' && path === '/resources/treatmentPlans/plan-9') {
        throw new Error('');
      }
      return {};
    });
    const showToast = vi.fn();
    await cleanupOrphanPlan('plan-9', ['item-1'], showToast);
    expect(showToast).toHaveBeenCalledWith('删除孤儿治疗计划 plan-9 失败，请检查未完成数据', 'error');
  });
});

describe('PrintPreview', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders payload and closes', () => {
    const onClose = vi.fn();
    render(
      <PrintPreview
        payload={{
          plan: { patientName: '张三', doctorName: '李医生', name: '种植计划' },
          items: [{ id: 'i1', name: '植体', quantity: 1, price: 50000 }],
          template: { name: 'A4' },
        }}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('张三')).toBeDefined();
    expect(screen.getByText('植体')).toBeDefined();
    expect(screen.getByText('¥500.00')).toBeDefined();
    expect(screen.getByText('A4')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to the default template and prints', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<PrintPreview payload={{ plan: {}, items: [], template: null }} onClose={vi.fn()} />);
    expect(screen.getByText('默认模板')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '打印本页' }));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });
});

describe('PlanFormFields', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  function mockPlanApi() {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path.startsWith('/resources/patients?')) {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/resources/treatmentPlanItems?planId=plan-1') {
        return {
          items: [
            { id: 'i1', code: 'C1', name: '植体', category: '种植', price: 50000, quantity: 2, teethNumbers: ['11'], status: 'PLANNED', billed: 1 },
          ],
          total: 1,
          page: 1,
          pageSize: 100,
        };
      }
      return {};
    });
  }

  function FormHarness({ editing = false, planId = null }: { editing?: boolean; planId?: string | null }) {
    const [form, setForm] = useState<TreatmentPlanForm>(() => emptyPlanForm());
    return (
      <PlanFormFields
        form={form}
        update={(patch) => setForm((current) => ({ ...current, ...patch }))}
        editing={editing}
        planId={planId}
        onItemsLoaded={vi.fn()}
      />
    );
  }

  it('updates form and item fields and manages rows', async () => {
    mockPlanApi();
    render(<FormHarness />, { wrapper });
    await waitFor(() => {
      expect((screen.getByRole('option', { name: '张医生' }) as HTMLOptionElement).value).toBe('d-1');
    });

    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('计划名称'), { target: { value: '种植计划' } });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'IN_PROGRESS' } });
    fireEvent.change(screen.getByLabelText('总费用'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '备注' } });
    fireEvent.change(screen.getByLabelText('明细名称'), { target: { value: '植体' } });
    fireEvent.change(screen.getByLabelText('明细编码'), { target: { value: 'C1' } });
    fireEvent.change(screen.getByLabelText('明细类别'), { target: { value: '种植' } });
    fireEvent.change(screen.getByLabelText('明细单价'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('明细数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('明细牙位'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('明细状态'), { target: { value: 'PLANNED' } });
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    expect(screen.getAllByLabelText('明细名称')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]);
    expect(screen.getAllByLabelText('明细名称')).toHaveLength(1);
  });

  it('backfills items when editing', async () => {
    mockPlanApi();
    const form = emptyPlanForm();
    const update = vi.fn((patch: Partial<TreatmentPlanForm>) => Object.assign(form, patch));
    const onItemsLoaded = vi.fn();
    render(<PlanFormFields form={form} update={update} editing planId="plan-1" onItemsLoaded={onItemsLoaded} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('明细名称') as HTMLInputElement).value).toBe('植体');
    });
    expect((screen.getByLabelText('明细单价') as HTMLInputElement).value).toBe('500.00');
    expect((screen.getByLabelText('明细数量') as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText('明细牙位') as HTMLInputElement).value).toBe('11');
    expect(screen.getByText('已划价')).toBeDefined();
    expect((screen.getByRole('button', { name: '移除' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onItemsLoaded).toHaveBeenCalled();
  });

  it('reports backfill failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path.startsWith('/resources/patients?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      if (path === '/resources/treatmentPlanItems?planId=plan-1') throw new Error('');
      return {};
    });
    render(<PlanFormFields form={emptyPlanForm()} update={vi.fn()} editing planId="plan-1" onItemsLoaded={vi.fn()} />, { wrapper });
    const errors = await screen.findAllByText('加载明细失败');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('locks billed rows', () => {
    const form = emptyPlanForm();
    form.items[0] = { ...form.items[0], name: '植体', billed: true };
    render(<PlanFormFields form={form} update={vi.fn()} editing={false} planId={null} onItemsLoaded={vi.fn()} />, { wrapper });
    expect(screen.getByText('已划价')).toBeDefined();
    expect((screen.getByLabelText('明细名称') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '移除' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
