// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrescriptionsPage } from './PrescriptionsPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/prescriptions?page=1&pageSize=50') {
      return { items: [{ id: 'pres-1', patientId: 'p-1', doctorId: 'd-1', remark: '饭后服用' }], total: 1, page: 1, pageSize: 50 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    if (path === '/resources/prescriptionItems?prescriptionId=pres-1&page=1&pageSize=100') {
      return { items: [{ id: 'item-1', prescriptionId: 'pres-1', name: '阿莫西林', specification: '0.25g', dosage: '1粒', frequency: '每日三次', days: 5, quantity: 2, price: 1000 }], total: 1, page: 1, pageSize: 100 };
    }
    if (path === '/prescriptions/pres-1/process') {
      return { prescriptionId: 'pres-1', status: 'PROCESSED', chargeId: 'charge-1', chargeNumber: 'CHG-1001', chargeTotalAmount: 25000, dispenseId: 'disp-1', dispenseNumber: 'DSP-1001', itemCount: 2 };
    }
    if (path === '/prescriptions/pres-1/status') {
      return { id: 'pres-1', status: 'PROCESSED', processedAt: '2026-08-06T02:00:00.000Z', chargeId: 'charge-1', dispenseId: 'disp-1' };
    }
    return {};
  });
}

describe('PrescriptionsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates prescriptions with item details and converts prices to cents', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    expect(await screen.findByText('饭后服用')).toBeDefined();

    fireEvent.click(screen.getByText('新建处方'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('药品名称'), { target: { value: '阿莫西林' } });
    fireEvent.change(screen.getByLabelText('频次'), { target: { value: '每日三次' } });
    fireEvent.change(screen.getByLabelText('天数'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '10' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'pres-2' });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'item-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptions', expect.objectContaining({ method: 'POST' }));
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptionItems', expect.objectContaining({ method: 'POST' }));
    });
    const itemCall = vi.mocked(apiRequest).mock.calls.find((call) => call[0] === '/resources/prescriptionItems');
    const itemBody = JSON.parse(String((itemCall?.[1] as RequestInit)?.body));
    expect(itemBody).toMatchObject({
      prescriptionId: 'pres-2',
      name: '阿莫西林',
      frequency: '每日三次',
      days: 5,
      quantity: 2,
      price: 1000,
    });
    const prescriptionCall = vi.mocked(apiRequest).mock.calls.find((call) => call[0] === '/resources/prescriptions');
    const prescriptionBody = JSON.parse(String((prescriptionCall?.[1] as RequestInit)?.body));
    expect(prescriptionBody).toMatchObject({ patientId: 'p-1', doctorId: 'd-1' });
    expect(await screen.findByText('处方已创建')).toBeDefined();
  });

  it('validates required prescription fields', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');
    fireEvent.click(screen.getByText('新建处方'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、医生并至少填写一条有效处方明细')).toBeDefined();
  });

  it('deletes the orphan prescription and created items when item creation fails midway', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');

    fireEvent.click(screen.getByText('新建处方'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.click(screen.getByText('添加药品'));
    const nameInputs = screen.getAllByLabelText('药品名称');
    const dayInputs = screen.getAllByLabelText('天数');
    const qtyInputs = screen.getAllByLabelText('数量');
    const priceInputs = screen.getAllByLabelText('单价');
    fireEvent.change(nameInputs[0], { target: { value: '阿莫西林' } });
    fireEvent.change(dayInputs[0], { target: { value: '5' } });
    fireEvent.change(qtyInputs[0], { target: { value: '2' } });
    fireEvent.change(priceInputs[0], { target: { value: '10' } });
    fireEvent.change(nameInputs[1], { target: { value: '布洛芬' } });
    fireEvent.change(dayInputs[1], { target: { value: '3' } });
    fireEvent.change(qtyInputs[1], { target: { value: '1' } });
    fireEvent.change(priceInputs[1], { target: { value: '8' } });
    // 主记录创建成功、第一条明细成功，第二条明细失败
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'pres-2' });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'item-1' });
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('明细创建失败'));
    fireEvent.click(screen.getByText('保存'));

    expect(await screen.findByText('明细创建失败')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptionItems/item-1', expect.objectContaining({ method: 'DELETE' }));
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptions/pres-2', expect.objectContaining({ method: 'DELETE' }));
    });
    // 先删明细、再删主记录
    const calls = vi.mocked(apiRequest).mock.calls.map((call) => String(call[0]));
    expect(calls.indexOf('/resources/prescriptionItems/item-1')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('/resources/prescriptions/pres-2')).toBeGreaterThan(calls.indexOf('/resources/prescriptionItems/item-1'));
  });

  it('adds and removes prescription item rows', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');
    fireEvent.click(screen.getByText('新建处方'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect(screen.getAllByLabelText('药品名称')).toHaveLength(1);
    fireEvent.click(screen.getByText('添加药品'));
    expect(screen.getAllByLabelText('药品名称')).toHaveLength(2);
    fireEvent.click(screen.getAllByText('移除')[0]);
    expect(screen.getAllByLabelText('药品名称')).toHaveLength(1);
  });

  it('processes a prescription and shows the generated charge and dispense numbers', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');

    fireEvent.click(screen.getByRole('button', { name: '处理' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/prescriptions/pres-1/process', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/prescriptions/pres-1/process');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({});
    expect(await screen.findByText('已生成划价单 CHG-1001 与领药单 DSP-1001')).toBeDefined();
  });

  it('renders a processed prescription row with status, charge and dispense columns', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/prescriptions?page=1&pageSize=50') {
        return {
          items: [{
            id: 'pres-1', patientId: 'p-1', patientIdLabel: '患者甲', doctorId: 'd-1', doctorIdLabel: '张医生',
            remark: '饭后服用', status: 'PROCESSED', processedAt: '2026-08-06T02:00:00.000Z',
            chargeId: 'charge-1', chargeIdLabel: 'CHG-1001', dispenseId: 'disp-1',
          }],
          total: 1, page: 1, pageSize: 50,
        };
      }
      return {};
    });
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');
    expect(screen.getByText('已处理')).toBeDefined();
    expect(screen.getByText('CHG-1001')).toBeDefined();
    expect(screen.getByText('disp-1')).toBeDefined();
    expect(screen.getByRole('button', { name: '查看状态' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '处理' })).toBeNull();
  });

  it('opens the status dialog and fetches prescription status', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/prescriptions?page=1&pageSize=50') {
        return {
          items: [{
            id: 'pres-1', patientId: 'p-1', patientIdLabel: '患者甲', doctorId: 'd-1', doctorIdLabel: '张医生',
            remark: '饭后服用', status: 'PROCESSED', processedAt: '2026-08-06T02:00:00.000Z',
            chargeId: 'charge-1', chargeIdLabel: 'CHG-1001', dispenseId: 'disp-1',
          }],
          total: 1, page: 1, pageSize: 50,
        };
      }
      if (path === '/prescriptions/pres-1/status') {
        return { id: 'pres-1', status: 'PROCESSED', processedAt: '2026-08-06T02:00:00.000Z', chargeId: 'charge-1', dispenseId: 'disp-1' };
      }
      return {};
    });
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');
    fireEvent.click(screen.getByRole('button', { name: '查看状态' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/prescriptions/pres-1/status');
    });
    // 等待对话框查询完成（charge-1 仅出现在对话框；列表列显示单号 CHG-1001）
    expect(await screen.findByText('charge-1')).toBeDefined();
    // 状态：列表列与对话框各一处；领药单两处相同
    expect((await screen.findAllByText('已处理')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('CHG-1001')).toBeDefined();
    expect((await screen.findAllByText('disp-1')).length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText('状态已刷新')).toBeDefined();
    await waitFor(() => {
      const statusCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/prescriptions/pres-1/status');
      expect(statusCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows an error toast when processing fails', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/prescriptions?page=1&pageSize=50') {
        return { items: [{ id: 'pres-1', patientId: 'p-1', doctorId: 'd-1', remark: '饭后服用' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/prescriptions/pres-1/process') {
        throw new Error('Prescription not found');
      }
      return {};
    });
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');
    fireEvent.click(screen.getByRole('button', { name: '处理' }));
    expect(await screen.findByText('处方不存在')).toBeDefined();
  });

  it('edits a prescription: backfills items and PATCHes master and items', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    // 明细异步回填（price 分 → 元）
    expect(await screen.findByDisplayValue('阿莫西林')).toBeDefined();
    expect((screen.getByLabelText('规格') as HTMLInputElement).value).toBe('0.25g');
    expect((screen.getByLabelText('单价') as HTMLInputElement).value).toBe('10.00');

    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '饭后半小时服用' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptions/pres-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const masterCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/prescriptions/pres-1');
    expect(JSON.parse(String(masterCall?.[1]?.body))).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      remark: '饭后半小时服用',
      status: 'DRAFT',
    });
    const itemPatchCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/prescriptionItems/item-1');
    expect(JSON.parse(String(itemPatchCall?.[1]?.body))).toMatchObject({
      name: '阿莫西林',
      specification: '0.25g',
      dosage: '1粒',
      frequency: '每日三次',
      days: 5,
      quantity: 2,
      price: 1200,
    });
    expect(await screen.findByText('处方已更新')).toBeDefined();
  });

  it('reconciles prescription items on edit: posts new items and deletes removed ones', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByDisplayValue('阿莫西林');

    // 新增一条明细
    fireEvent.click(screen.getByText('添加药品'));
    fireEvent.change(screen.getAllByLabelText('药品名称')[1], { target: { value: '布洛芬' } });
    fireEvent.change(screen.getAllByLabelText('天数')[1], { target: { value: '3' } });
    fireEvent.change(screen.getAllByLabelText('数量')[1], { target: { value: '1' } });
    fireEvent.change(screen.getAllByLabelText('单价')[1], { target: { value: '8' } });
    // 移除原有明细
    fireEvent.click(screen.getAllByText('移除')[0]);

    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptionItems', expect.objectContaining({ method: 'POST' }));
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptionItems/item-1', expect.objectContaining({ method: 'DELETE' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find((call) => call[0] === '/resources/prescriptionItems' && call[1]?.method === 'POST');
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      prescriptionId: 'pres-1',
      name: '布洛芬',
      days: 3,
      quantity: 1,
      price: 800,
    });
    expect(await screen.findByText('处方已更新')).toBeDefined();
  });

  it('deletes a prescription through the generic resource endpoint', async () => {
    mockData();
    render(<PrescriptionsPage />, { wrapper });
    await screen.findByText('饭后服用');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/prescriptions/pres-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('处方已删除')).toBeDefined();
  });
});
