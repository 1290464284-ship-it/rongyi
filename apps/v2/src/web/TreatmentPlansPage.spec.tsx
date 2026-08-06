// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TreatmentPlansPage } from './TreatmentPlansPage';
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
    if (path === '/resources/treatmentPlans?page=1&pageSize=50') {
      return {
        items: [
          { id: 'p-1', patientId: 'p-1', doctorId: 'd-1', name: '正畸计划', totalFee: 20000, status: 'APPROVED', printCount: 2, signedAt: '2026-08-01T00:00:00.000Z' },
          { id: 'p-2', patientId: 'p-1', doctorId: 'd-1', name: '修复计划', totalFee: 30000, status: 'APPROVED', printCount: 0, signedAt: null },
        ],
        total: 2, page: 1, pageSize: 50,
      };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    if (path === '/treatment-plans/p-1/print') {
      return {
        plan: { id: 'p-1', name: '正畸计划', patientName: '患者甲', doctorName: '张医生', printCount: 3 },
        items: [{ id: 'item-1', name: '种植体', quantity: 2, price: 500000 }],
        template: { name: '治疗计划模板' },
      };
    }
    if (path === '/treatment-plans/p-1/sign') {
      return { id: 'p-1', signedAt: '2026-08-06T02:00:00.000Z', signerName: '张三' };
    }
    if (path === '/resources/treatmentPlanItems?planId=p-1&page=1&pageSize=200') {
      return {
        items: [
          { id: 'item-1', name: '种植体', category: 'GENERAL', price: 10000, quantity: 1, status: 'PLANNED', discountRate: null, billed: 0, billedChargeId: null },
          { id: 'item-2', name: '基台', category: 'GENERAL', price: 5000, quantity: 2, status: 'PLANNED', discountRate: null, billed: 0, billedChargeId: null },
        ],
        total: 2, page: 1, pageSize: 200,
      };
    }
    if (path === '/treatment-plans/p-1/discount') {
      return { id: 'p-1', discountType: 'WHOLE', discountRate: 10, totalFee: 18000 };
    }
    if (path === '/treatment-plans/p-1/items/item-1/discount') {
      return { itemId: 'item-1', discountRate: 25, planTotalFee: 17500 };
    }
    if (path === '/treatment-plans/p-1/bill') {
      return { chargeId: 'charge-1', number: 'CHG-ABC123', totalAmount: 10000, itemCount: 1, billedItemIds: ['item-1'] };
    }
    if (path === '/treatment-plans/p-1/follow-up') {
      return { id: 'p-1', followUpStatus: 'PENDING', nextFollowUpAt: '2026-08-20', trackingNote: '患者反馈良好' };
    }
    return {};
  });
}

describe('TreatmentPlansPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates treatment plans with item details', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    expect(await screen.findByText('正畸计划')).toBeDefined();

    fireEvent.click(screen.getByText('新建治疗计划'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('计划名称'), { target: { value: '种植计划' } });
    fireEvent.change(screen.getByLabelText('明细名称'), { target: { value: '种植体' } });
    fireEvent.change(screen.getByLabelText('明细单价'), { target: { value: '5000' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'plan-2' });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'item-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlans', expect.objectContaining({ method: 'POST' }));
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlanItems', expect.objectContaining({ method: 'POST' }));
    });
    const planCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/treatmentPlans');
    const planBody = JSON.parse(String(planCall?.[1]?.body));
    expect(planBody).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      name: '种植计划',
      status: 'APPROVED',
    });
    expect(planBody.remark).toBeUndefined();
    const itemCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/treatmentPlanItems');
    const itemBody = JSON.parse(String(itemCall?.[1]?.body));
    expect(itemBody).toMatchObject({
      planId: 'plan-2',
      name: '种植体',
      category: 'GENERAL',
      price: 500000,
      quantity: 1,
      teethNumbers: [],
      status: 'PLANNED',
    });
    expect(itemBody.code).toMatch(/^ITEM-\d+$/);
    expect(await screen.findByText('治疗计划已创建')).toBeDefined();
  });

  it('validates required plan fields', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getByText('新建治疗计划'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、医生并填写计划名称和至少一条有效明细')).toBeDefined();
  });

  it('deletes the orphan plan and created items when item creation fails midway', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');

    fireEvent.click(screen.getByText('新建治疗计划'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('计划名称'), { target: { value: '种植计划' } });
    fireEvent.click(screen.getByText('添加明细'));
    const nameInputs = screen.getAllByLabelText('明细名称');
    const priceInputs = screen.getAllByLabelText('明细单价');
    fireEvent.change(nameInputs[0], { target: { value: '种植体' } });
    fireEvent.change(priceInputs[0], { target: { value: '5000' } });
    fireEvent.change(nameInputs[1], { target: { value: '基台' } });
    fireEvent.change(priceInputs[1], { target: { value: '1000' } });
    // 主记录创建成功、第一条明细成功，第二条明细失败
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'plan-2' });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'item-1' });
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('明细创建失败'));
    fireEvent.click(screen.getByText('保存'));

    expect(await screen.findByText('明细创建失败')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlanItems/item-1', expect.objectContaining({ method: 'DELETE' }));
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlans/plan-2', expect.objectContaining({ method: 'DELETE' }));
    });
    // 先删明细、再删主记录
    const calls = vi.mocked(apiRequest).mock.calls.map((call) => String(call[0]));
    expect(calls.indexOf('/resources/treatmentPlanItems/item-1')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('/resources/treatmentPlans/plan-2')).toBeGreaterThan(calls.indexOf('/resources/treatmentPlanItems/item-1'));
  });

  it('calculates totalFee from item details when the manual fee is empty', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');

    fireEvent.click(screen.getByText('新建治疗计划'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('计划名称'), { target: { value: '种植计划' } });
    fireEvent.change(screen.getByLabelText('明细名称'), { target: { value: '种植体' } });
    fireEvent.change(screen.getByLabelText('明细单价'), { target: { value: '5000' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'plan-2' });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'item-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/treatmentPlans', expect.objectContaining({ method: 'POST' }));
    });
    const planCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/treatmentPlans');
    const planBody = JSON.parse(String(planCall?.[1]?.body));
    // 5000 元 × 1 个 = 500000 分
    expect(planBody.totalFee).toBe(500000);
  });

  it('renders print count and signature status columns', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    expect(await screen.findByText('正畸计划')).toBeDefined();
    expect(screen.getByText('打印次数')).toBeDefined();
    // 表头「签字」+ 每行「签字」按钮
    expect(screen.getAllByText('签字').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('已签')).toBeDefined();
    expect(screen.getByText('未签')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('0')).toBeDefined();
  });

  it('prints a plan: calls the print endpoint, toasts the new count, and shows the payload summary dialog', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');

    fireEvent.click(screen.getAllByText('打印')[0]);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatment-plans/p-1/print', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('已打印（第 3 次）')).toBeDefined();
    // Dialog 载荷摘要：患者/医生/计划名称/明细/模板名/打印本页按钮
    expect(await screen.findByText('打印预览')).toBeDefined();
    expect(screen.getByText('患者甲')).toBeDefined();
    expect(screen.getByText('张医生')).toBeDefined();
    expect(screen.getAllByText('正畸计划').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('种植体')).toBeDefined();
    expect(screen.getByText('治疗计划模板')).toBeDefined();
    expect(screen.getByText('打印本页')).toBeDefined();
  });

  it('prints with a fallback template name when no template is returned', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatmentPlans?page=1&pageSize=50') {
        return { items: [{ id: 'p-1', patientId: 'p-1', doctorId: 'd-1', name: '正畸计划', totalFee: 20000, status: 'APPROVED', printCount: 0, signedAt: null }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/treatment-plans/p-1/print') {
        return { plan: { id: 'p-1', name: '正畸计划', patientName: '患者甲', doctorName: '张医生', printCount: 1 }, items: [], template: null };
      }
      return {};
    });
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getByText('打印'));
    expect(await screen.findByText('默认模板')).toBeDefined();
    expect(await screen.findByText('已打印（第 1 次）')).toBeDefined();
  });

  it('shows an error toast when printing fails', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatmentPlans?page=1&pageSize=50') {
        return { items: [{ id: 'p-1', patientId: 'p-1', doctorId: 'd-1', name: '正畸计划', totalFee: 20000, status: 'APPROVED', printCount: 0, signedAt: null }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/treatment-plans/p-1/print') {
        throw new Error('TreatmentPlan not found');
      }
      return {};
    });
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getByText('打印'));
    expect(await screen.findByText('治疗计划不存在')).toBeDefined();
  });

  it('signs a plan: submits signature and signerName, toasts success, and closes the dialog', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');

    fireEvent.click(screen.getAllByRole('button', { name: '签字' })[0]);
    expect(await screen.findByText('电子签字')).toBeDefined();

    fireEvent.change(screen.getByLabelText('签名 dataURL'), { target: { value: 'data:image/png;base64,SIGN' } });
    fireEvent.change(screen.getByLabelText('签署人姓名'), { target: { value: '张三' } });
    fireEvent.change(screen.getByLabelText('签名备注'), { target: { value: '患者已确认' } });
    fireEvent.click(screen.getByText('签署'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatment-plans/p-1/sign', expect.objectContaining({ method: 'POST' }));
    });
    const signCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/treatment-plans/p-1/sign');
    const signBody = JSON.parse(String(signCall?.[1]?.body));
    expect(signBody).toMatchObject({
      signature: 'data:image/png;base64,SIGN',
      signerName: '张三',
      remark: '患者已确认',
    });
    expect(await screen.findByText('签署完成')).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByLabelText('签署人姓名')).toBeNull();
    });
  });

  it('blocks signing when signature or signerName is empty', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getAllByRole('button', { name: '签字' })[0]);
    await screen.findByText('电子签字');

    fireEvent.click(screen.getByText('签署'));
    expect((await screen.findAllByText('请填写签名与签署人姓名')).length).toBeGreaterThan(0);
    expect(apiRequest).not.toHaveBeenCalledWith('/treatment-plans/p-1/sign', expect.objectContaining({ method: 'POST' }));

    fireEvent.change(screen.getByLabelText('签名 dataURL'), { target: { value: 'data:image/png;base64,SIGN' } });
    fireEvent.click(screen.getByText('签署'));
    expect((await screen.findAllByText('请填写签名与签署人姓名')).length).toBeGreaterThan(0);
    expect(apiRequest).not.toHaveBeenCalledWith('/treatment-plans/p-1/sign', expect.objectContaining({ method: 'POST' }));
  });

  it('shows an error toast when signing fails', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatmentPlans?page=1&pageSize=50') {
        return { items: [{ id: 'p-1', patientId: 'p-1', doctorId: 'd-1', name: '正畸计划', totalFee: 20000, status: 'APPROVED', printCount: 0, signedAt: null }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/treatment-plans/p-1/sign') {
        throw new Error('签署人姓名不能为空');
      }
      return {};
    });
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getAllByRole('button', { name: '签字' })[0]);
    await screen.findByText('电子签字');
    fireEvent.change(screen.getByLabelText('签名 dataURL'), { target: { value: 'data:image/png;base64,SIGN' } });
    fireEvent.change(screen.getByLabelText('签署人姓名'), { target: { value: '张三' } });
    fireEvent.click(screen.getByText('签署'));
    expect(await screen.findByText('签署人姓名不能为空')).toBeDefined();
  });

  it('saves a whole-plan discount and shows the new total fee', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');

    fireEvent.click(screen.getAllByRole('button', { name: '折扣' })[0]);
    expect(await screen.findByLabelText('明细与划价：正畸计划')).toBeDefined();

    fireEvent.change(screen.getByLabelText('整单折扣类型'), { target: { value: 'WHOLE' } });
    fireEvent.change(screen.getByLabelText('整单折扣率'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '保存折扣' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatment-plans/p-1/discount', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/treatment-plans/p-1/discount');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ discountType: 'WHOLE', discountRate: 10 });
    expect(await screen.findByText('折扣已保存，总费用 ¥180.00')).toBeDefined();
  });

  it('saves an item discount and clears it back to null', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getAllByRole('button', { name: '折扣' })[0]);
    await screen.findByLabelText('明细折扣 种植体');

    fireEvent.change(screen.getByLabelText('明细折扣 种植体'), { target: { value: '25' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatment-plans/p-1/items/item-1/discount', expect.objectContaining({ method: 'POST' }));
    });
    let calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/treatment-plans/p-1/items/item-1/discount');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ discountRate: 25 });
    expect(await screen.findByText('明细折扣已保存，总费用 ¥175.00')).toBeDefined();

    fireEvent.change(screen.getByLabelText('明细折扣 种植体'), { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => {
      calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/treatment-plans/p-1/items/item-1/discount');
      expect(calls.length).toBe(2);
    });
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({ discountRate: null });
  });

  it('bills selected items, then bills all items when nothing is selected', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getAllByRole('button', { name: '折扣' })[0]);
    await screen.findByLabelText('勾选划价 种植体');

    fireEvent.click(screen.getByLabelText('勾选划价 种植体'));
    fireEvent.click(screen.getByRole('button', { name: '划价' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatment-plans/p-1/bill', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('已生成划价单 CHG-ABC123')).toBeDefined();
    let billCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/treatment-plans/p-1/bill');
    expect(JSON.parse(String(billCalls[0]?.[1]?.body))).toEqual({ itemIds: ['item-1'] });

    // 勾选在划价后被清空：再次划价应发送全量（空 body）
    fireEvent.click(screen.getByRole('button', { name: '划价' }));
    await waitFor(() => {
      billCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/treatment-plans/p-1/bill');
      expect(billCalls.length).toBe(2);
    });
    expect(JSON.parse(String(billCalls[1]?.[1]?.body))).toEqual({});
  });

  it('disables discount and billing controls when items are already billed', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatmentPlans?page=1&pageSize=50') {
        return { items: [{ id: 'p-1', patientId: 'p-1', doctorId: 'd-1', name: '正畸计划', totalFee: 20000, status: 'APPROVED', printCount: 0, signedAt: null }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/treatmentPlanItems?planId=p-1&page=1&pageSize=200') {
        return {
          items: [{ id: 'item-1', name: '种植体', category: 'GENERAL', price: 10000, quantity: 1, status: 'PLANNED', discountRate: null, billed: 1, billedChargeId: 'charge-9' }],
          total: 1, page: 1, pageSize: 200,
        };
      }
      return {};
    });
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getAllByRole('button', { name: '折扣' })[0]);
    expect(await screen.findByText('已存在已划价明细，整单折扣不可修改')).toBeDefined();
    expect((screen.getByLabelText('整单折扣类型') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('整单折扣率') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '保存折扣' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('勾选划价 种植体') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('明细折扣 种植体') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getAllByRole('button', { name: '保存' })[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('已划价')).toBeDefined();
  });

  it('saves follow-up info', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getAllByRole('button', { name: '回访' })[0]);
    await screen.findByLabelText('回访状态');

    fireEvent.change(screen.getByLabelText('回访状态'), { target: { value: 'PENDING' } });
    fireEvent.change(screen.getByLabelText('下次回访时间'), { target: { value: '2026-08-20' } });
    fireEvent.change(screen.getByLabelText('回访备注'), { target: { value: '患者反馈良好' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/treatment-plans/p-1/follow-up', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/treatment-plans/p-1/follow-up');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      followUpStatus: 'PENDING',
      nextFollowUpAt: '2026-08-20',
      trackingNote: '患者反馈良好',
    });
    expect(await screen.findByText('回访信息已保存')).toBeDefined();
  });

  it('renders discount and follow-up columns from plan rows', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/treatmentPlans?page=1&pageSize=50') {
        return {
          items: [
            { id: 'p-1', patientId: 'p-1', doctorId: 'd-1', name: '正畸计划', totalFee: 20000, status: 'APPROVED', printCount: 2, signedAt: null, discountType: 'WHOLE', discountRate: 10, followUpStatus: 'PENDING', nextFollowUpAt: '2026-08-20', trackingNote: '患者反馈良好' },
            { id: 'p-2', patientId: 'p-1', doctorId: 'd-1', name: '修复计划', totalFee: 30000, status: 'APPROVED', printCount: 0, signedAt: null },
          ],
          total: 2, page: 1, pageSize: 50,
        };
      }
      return {};
    });
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    expect(screen.getAllByText('折扣').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('回访').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('整单折 10%')).toBeDefined();
    expect(screen.getByText('待回访（2026-08-20）')).toBeDefined();
    expect(screen.getAllByText('无折扣').length).toBeGreaterThanOrEqual(1);
  });

  it('rejects discount rates outside 0-100', async () => {
    mockData();
    render(<TreatmentPlansPage />, { wrapper });
    await screen.findByText('正畸计划');
    fireEvent.click(screen.getAllByRole('button', { name: '折扣' })[0]);
    await screen.findByLabelText('整单折扣率');

    fireEvent.change(screen.getByLabelText('整单折扣类型'), { target: { value: 'WHOLE' } });
    fireEvent.change(screen.getByLabelText('整单折扣率'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: '保存折扣' }));
    expect(await screen.findByText('折扣率须在 0-100 之间')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/treatment-plans/p-1/discount', expect.objectContaining({ method: 'POST' }));

    await screen.findByLabelText('明细折扣 种植体');
    fireEvent.change(screen.getByLabelText('明细折扣 种植体'), { target: { value: '101' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    expect((await screen.findAllByText('折扣率须在 0-100 之间')).length).toBeGreaterThanOrEqual(1);
    expect(apiRequest).not.toHaveBeenCalledWith('/treatment-plans/p-1/items/item-1/discount', expect.objectContaining({ method: 'POST' }));
  });
});
