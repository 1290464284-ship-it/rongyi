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
});
