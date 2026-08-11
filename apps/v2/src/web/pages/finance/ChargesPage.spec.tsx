// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChargesPage } from './ChargesPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

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
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    return {};
  });
}

describe('ChargesPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates a charge with line items', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    expect(await screen.findByText('N-1')).toBeDefined();

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
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
    const payCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges/c-1/pay');
    const payBody = JSON.parse(String(payCall?.[1]?.body));
    expect(payBody).toMatchObject({ amount: 5000, method: 'WECHAT' });
    expect(payBody.requestId).toBeDefined();
    expect(await screen.findByText('收款已记录')).toBeDefined();

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
    const refundCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges/c-1/refund');
    const refundBody = JSON.parse(String(refundCall?.[1]?.body));
    expect(refundBody).toMatchObject({ amount: 2000, reason: '取消项目' });
    expect(refundBody.requestId).toBeDefined();
    expect(await screen.findByText('退款已记录')).toBeDefined();
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
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('reports create, payment, and refund failures', async () => {
    mockData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      throw new Error('charge failed');
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    expect((await screen.findAllByText('操作失败，请稍后重试')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    fireEvent.change(screen.getByLabelText('收款金额（元）'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));
    expect((await screen.findAllByText('操作失败，请稍后重试')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '退款' }));
    fireEvent.change(screen.getByLabelText('退款金额（元）'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退款' }));
    expect((await screen.findAllByText('操作失败，请稍后重试')).length).toBeGreaterThan(0);
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
      if (path === '/resources/patients?page=1&pageSize=100') {
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

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '无效项目' } });
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    expect(await screen.findByText('请选择患者并至少填写一条有效收费明细')).toBeDefined();

    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
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

  it('loads a charge combo into the form items from the combo dialog', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') {
        return [{
          id: 'combo-1',
          code: 'CB-01',
          name: '洁牙套餐',
          type: 'PUBLIC',
          items: [
            { id: 'i-1', comboId: 'combo-1', catalogId: null, name: '洁牙', category: 'CLEAN', price: 30000, quantity: 1, costType: 'SERVICE' },
            { id: 'i-2', comboId: 'combo-1', catalogId: null, name: '抛光膏', category: 'MATERIAL', price: 5000, quantity: 2, costType: 'MATERIAL' },
          ],
        }];
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    expect(await screen.findByText('洁牙套餐')).toBeDefined();
    expect(screen.getByText('CB-01')).toBeDefined();
    expect(screen.getByText('公共')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '载入组合 洁牙套餐' }));
    expect(await screen.findByText('收费组合「洁牙套餐」已载入')).toBeDefined();

    const nameInputs = screen.getAllByLabelText('项目名称') as HTMLInputElement[];
    expect(nameInputs.map((input) => input.value)).toEqual(['洁牙', '抛光膏']);
    const priceInputs = screen.getAllByLabelText('单价') as HTMLInputElement[];
    expect(priceInputs.map((input) => input.value)).toEqual(['300', '50']);
    const quantityInputs = screen.getAllByLabelText('数量') as HTMLInputElement[];
    expect(quantityInputs.map((input) => input.value)).toEqual(['1', '2']);
    const typeSelects = screen.getAllByLabelText('类型') as HTMLSelectElement[];
    expect(typeSelects.map((select) => select.value)).toEqual(['SERVICE', 'MATERIAL']);

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      patientId: 'p-1',
      items: [
        { name: '洁牙', category: 'CLEAN', price: 30000, quantity: 1, costType: 'SERVICE' },
        { name: '抛光膏', category: 'MATERIAL', price: 5000, quantity: 2, costType: 'MATERIAL' },
      ],
    });
  });

  it('submits costType and discount with the charge payload', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '隐形牙套' } });
    fireEvent.change(screen.getByLabelText('项目分类'), { target: { value: 'ORTHODONTIC' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.change(screen.getAllByLabelText('类型')[0], { target: { value: 'MATERIAL' } });
    fireEvent.change(screen.getByLabelText('优惠金额（元）'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      patientId: 'p-1',
      items: [{ name: '隐形牙套', category: 'ORTHODONTIC', price: 10000, quantity: 1, costType: 'MATERIAL' }],
      discount: 2000,
    });
  });

  it('applies the member discount quote into the discount field', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/member-cards/quote') {
        return { applied: true, baseTotal: 60000, total: 54000 };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: '会员折扣试算' }));

    expect(await screen.findByText('会员折扣已试算，折后价 ¥540.00')).toBeDefined();
    expect((screen.getByLabelText('优惠金额（元）') as HTMLInputElement).value).toBe('60.00');
    const quoteCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/member-cards/quote');
    expect(JSON.parse(String(quoteCall?.[1]?.body))).toEqual({ patientId: 'p-1', baseTotal: 60000 });
  });

  it('reports missing member card or plan when quoting', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/member-cards/quote') return { applied: false, reason: 'NO_ACTIVE_CARD' };
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '会员折扣试算' }));
    expect(await screen.findByText('该患者没有可用会员卡')).toBeDefined();
  });

  it('renders the charge tree and creates a quick charge from a leaf catalog', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-trees') {
        return {
          items: [
            {
              id: 'cat-root', code: 'CAT-1', name: '正畸项目', category: 'GENERAL', price: 10000,
              costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: null,
              children: [
                {
                  id: 'cat-leaf', code: 'CAT-1-1', name: '初诊检查', category: 'GENERAL', price: 3000,
                  costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: 'cat-root', children: [],
                },
              ],
            },
            {
              id: 'cat-material', code: 'CAT-2', name: '种植材料', category: 'GENERAL', price: 200000,
              costType: 'MATERIAL', anesthesia: false, businessCategory: 'MATERIAL', parentId: null, children: [],
            },
          ],
        };
      }
      if (path === '/charge-trees/cat-leaf/quick-charge') {
        return { chargeId: 'chg-qc', number: 'CHG-QC-1', totalAmount: 6000 };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    expect(await screen.findByText('收费项目')).toBeDefined();
    expect(screen.getByText('N-1')).toBeDefined();

    // 根节点默认收起；叶子大类（无 children）直接提供快捷划价按钮
    fireEvent.click(screen.getByRole('button', { name: '展开 正畸项目' }));
    fireEvent.click(screen.getByRole('button', { name: '快捷划价 初诊检查' }));
    expect(await screen.findByText('快捷收费')).toBeDefined();
    expect((screen.getByLabelText('快捷收费项目名') as HTMLInputElement).value).toBe('初诊检查');
    expect((screen.getByLabelText('快捷收费单价') as HTMLInputElement).value).toBe('30');

    fireEvent.change(screen.getByLabelText('快捷收费数量'), { target: { value: '2' } });
    await waitFor(() => {
      expect((screen.getByLabelText('快捷收费患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('快捷收费患者'), { target: { value: 'p-1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认快捷收费' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charge-trees/cat-leaf/quick-charge', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charge-trees/cat-leaf/quick-charge');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ patientId: 'p-1', quantity: 2 });
    expect(await screen.findByText(/快捷划价成功/)).toBeDefined();
  });

  it('validates quick charge inputs before submitting', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-trees') {
        return {
          items: [{
            id: 'cat-root', code: 'CAT-1', name: '正畸项目', category: 'GENERAL', price: 10000,
            costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: null,
            children: [{
              id: 'cat-leaf', code: 'CAT-1-1', name: '初诊检查', category: 'GENERAL', price: 3000,
              costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: 'cat-root', children: [],
            }],
          }],
        };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('收费项目');
    fireEvent.click(screen.getByRole('button', { name: '展开 正畸项目' }));
    fireEvent.click(screen.getByRole('button', { name: '快捷划价 初诊检查' }));
    await screen.findByText('快捷收费');

    fireEvent.click(screen.getByRole('button', { name: '确认快捷收费' }));
    expect(await screen.findByText('请选择患者并填写有效的数量')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/charge-trees/cat-leaf/quick-charge', expect.anything());
  });

  it('uses the two-level pay method tree and sends the selected leaf name', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/pay-methods/tree') {
        return {
          items: [
            { id: 'pm-cash', name: '现金', parentId: null, sortOrder: 0, active: true, remark: null, children: [] },
            {
              id: 'pm-elec', name: '电子支付', parentId: null, sortOrder: 1, active: true, remark: null,
              children: [
                { id: 'pm-wechat', name: '微信', parentId: 'pm-elec', sortOrder: 1, active: true, remark: null, children: [] },
                { id: 'pm-card', name: '银行卡', parentId: 'pm-elec', sortOrder: 2, active: true, remark: null, children: [] },
                { id: 'pm-installment', name: '医美分期', parentId: 'pm-elec', sortOrder: 3, active: true, remark: null, children: [] },
              ],
            },
          ],
        };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    // 无子级的根节点本身就是可选的二级方式；默认选中第一个根节点
    expect((screen.getByLabelText('支付方式') as HTMLSelectElement).value).toBe('pm-cash');
    expect((screen.getByLabelText('支付方式大类') as HTMLSelectElement).value).toBe('pm-cash');

    // 切换到有子级的父方式后，二级方式自动变为其第一个子级
    fireEvent.change(screen.getByLabelText('支付方式大类'), { target: { value: 'pm-elec' } });
    await waitFor(() => {
      expect((screen.getByLabelText('支付方式') as HTMLSelectElement).value).toBe('pm-wechat');
    });
    fireEvent.change(screen.getByLabelText('支付方式'), { target: { value: 'pm-card' } });
    fireEvent.change(screen.getByLabelText('收款金额（元）'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges/c-1/pay', expect.objectContaining({ method: 'PATCH' }));
    });
    const firstCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges/c-1/pay');
    expect(JSON.parse(String(firstCall?.[1]?.body))).toMatchObject({
      amount: 5000,
      method: 'CARD',
      payMethodName: '银行卡',
    });

    // 未映射到内置方式的名称使用 OTHER 码，名称照常传给后端
    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    expect((screen.getByLabelText('支付方式大类') as HTMLSelectElement).value).toBe('pm-elec');
    expect((screen.getByLabelText('支付方式') as HTMLSelectElement).value).toBe('pm-card');
    fireEvent.change(screen.getByLabelText('支付方式'), { target: { value: 'pm-installment' } });
    fireEvent.change(screen.getByLabelText('收款金额（元）'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));

    await waitFor(() => {
      expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/charges/c-1/pay').length).toBe(2);
    });
    const payCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/charges/c-1/pay');
    const secondBody = JSON.parse(String(payCalls[1]?.[1]?.body));
    expect(secondBody).toMatchObject({ amount: 1000, method: 'OTHER', payMethodName: '医美分期' });
  });

  it('keeps the unpaid charge after cancelling the delete confirmation', async () => {
    const unpaidList = { ...chargeList, items: [{ ...chargeList.items[0], status: 'UNPAID' }] };
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return unpaidList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(await screen.findByText('删除收费单确认')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith('/charges/c-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('deletes an unpaid charge after confirmation and refreshes the list', async () => {
    const unpaidList = { ...chargeList, items: [{ ...chargeList.items[0], status: 'UNPAID' }] };
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return unpaidList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges/c-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('收费单已删除')).toBeDefined();
  });

  it('reports delete failures and closes the confirmation', async () => {
    const unpaidList = { ...chargeList, items: [{ ...chargeList.items[0], status: 'UNPAID' }] };
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return unpaidList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charges/c-1') throw new Error('delete failed');
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText('删除收费单确认')).toBeNull();
    });
  });

  it('shows an empty state when no charge combos are configured', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') return [];
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    expect(await screen.findByText('暂无可用收费组合')).toBeDefined();
  });

  it('lazily loads combo items from the detail endpoint when applying', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') {
        return [{ id: 'combo-1', code: 'CB-01', name: '洁牙套餐', type: 'PUBLIC' }];
      }
      if (path === '/charge-combos/combo-1/items') {
        return {
          id: 'combo-1',
          code: 'CB-01',
          name: '洁牙套餐',
          type: 'PUBLIC',
          items: [{ id: 'i-1', comboId: 'combo-1', catalogId: null, name: '洁牙', category: 'CLEAN', price: 30000, quantity: 1, costType: 'SERVICE' }],
        };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    expect(await screen.findByText('洁牙套餐')).toBeDefined();
    expect(screen.getByText('0 项')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '载入组合 洁牙套餐' }));

    expect(await screen.findByText('收费组合「洁牙套餐」已载入')).toBeDefined();
    expect(apiRequest).toHaveBeenCalledWith('/charge-combos/combo-1/items');
    expect((screen.getAllByLabelText('项目名称') as HTMLInputElement[]).map((input) => input.value)).toEqual(['洁牙']);
    expect((screen.getAllByLabelText('单价') as HTMLInputElement[]).map((input) => input.value)).toEqual(['300']);
  });

  it('reports failures when loading combo detail items', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') {
        return [{ id: 'combo-1', code: 'CB-01', name: '洁牙套餐', type: 'PUBLIC' }];
      }
      if (path === '/charge-combos/combo-1/items') throw new Error('detail failed');
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    fireEvent.click(await screen.findByRole('button', { name: '载入组合 洁牙套餐' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByText('洁牙套餐')).toBeDefined();
  });

  it('reports the no-plan branch when quoting a member discount', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/member-cards/quote') return { applied: false, reason: 'NO_PLAN' };
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '会员折扣试算' }));
    expect(await screen.findByText('该患者没有可用会员方案')).toBeDefined();
  });

  it('reports a generic member discount quote message', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/member-cards/quote') return { applied: false, message: '会员规则未生效' };
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '会员折扣试算' }));
    expect(await screen.findByText('会员规则未生效')).toBeDefined();
  });

  it('reports member discount quote failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/member-cards/quote') throw new Error('quote failed');
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '会员折扣试算' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('falls back to built-in pay methods when the pay method tree is empty', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/pay-methods/tree') return { items: [] };
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    expect(screen.queryByLabelText('支付方式大类')).toBeNull();
    const methodSelect = screen.getByLabelText('支付方式') as HTMLSelectElement;
    expect(Array.from(methodSelect.options).map((option) => option.value)).toContain('WECHAT');
    fireEvent.change(methodSelect, { target: { value: 'WECHAT' } });
    fireEvent.change(screen.getByLabelText('收款金额（元）'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: '确认收款' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges/c-1/pay', expect.objectContaining({ method: 'PATCH' }));
    });
    const payCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges/c-1/pay');
    expect(JSON.parse(String(payCall?.[1]?.body))).toMatchObject({
      amount: 5000,
      method: 'WECHAT',
      payMethodName: '微信',
    });
  });

  it('shows a charge tree panel error without breaking the page', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-trees') throw new Error('tree failed');
      return {};
    });
    render(<ChargesPage />, { wrapper });

    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByText('N-1')).toBeDefined();
  });

  it('reports quick charge failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-trees') {
        return {
          items: [{
            id: 'cat-root', code: 'CAT-1', name: '正畸项目', category: 'GENERAL', price: 10000,
            costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: null,
            children: [{
              id: 'cat-leaf', code: 'CAT-1-1', name: '初诊检查', category: 'GENERAL', price: 3000,
              costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: 'cat-root', children: [],
            }],
          }],
        };
      }
      if (path === '/charge-trees/cat-leaf/quick-charge') throw new Error('quick failed');
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('收费项目');
    fireEvent.click(screen.getByRole('button', { name: '展开 正畸项目' }));
    fireEvent.click(screen.getByRole('button', { name: '快捷划价 初诊检查' }));
    await screen.findByText('快捷收费');

    fireEvent.change(screen.getByLabelText('快捷收费数量'), { target: { value: '1' } });
    await waitFor(() => {
      expect((screen.getByLabelText('快捷收费患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('快捷收费患者'), { target: { value: 'p-1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认快捷收费' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('requires a patient and valid items before quoting a member discount', async () => {
    mockData();
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '会员折扣试算' }));
    expect(await screen.findByText('请先选择患者并填写有效明细')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/member-cards/quote', expect.anything());
  });

  it('reuses already loaded combos when the dialog is reopened', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') {
        return [{ id: 'combo-1', code: 'CB-01', name: '洁牙套餐', type: 'PUBLIC', items: [] }];
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    expect(await screen.findByText('洁牙套餐')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByText('洁牙套餐')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    expect(await screen.findByText('洁牙套餐')).toBeDefined();
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/charge-combos')).toHaveLength(1);
  });

  it('reports failures when loading charge combos', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') throw 'combo load failed';
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    expect(await screen.findByText('加载收费组合失败')).toBeDefined();
  });

  it('shows the fallback message when no member discount rule applies', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/member-cards/quote') return { applied: false };
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '会员折扣试算' }));
    expect(await screen.findByText('暂无可用会员折扣')).toBeDefined();
  });

  it('loads combo items without a cost type as SERVICE', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') {
        return [{ id: 'combo-1', code: 'CB-01', name: '洁牙套餐', type: 'PUBLIC', items: [] }];
      }
      if (path === '/charge-combos/combo-1/items') {
        return {
          id: 'combo-1',
          code: 'CB-01',
          name: '洁牙套餐',
          type: 'PUBLIC',
          items: [{ id: 'i-1', comboId: 'combo-1', catalogId: null, name: '洁牙', category: 'CLEAN', price: 30000, quantity: 1 }],
        };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    fireEvent.click(await screen.findByRole('button', { name: '载入组合 洁牙套餐' }));
    await waitFor(() => {
      expect((screen.getAllByLabelText('类型')[0] as HTMLSelectElement).value).toBe('SERVICE');
    });
  });

  it('closes payment, refund, quick charge and combo dialogs through the dialog close path', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-trees') {
        return {
          items: [{
            id: 'cat-root', code: 'CAT-1', name: '正畸项目', category: 'GENERAL', price: 10000,
            costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: null,
            children: [{
              id: 'cat-leaf', code: 'CAT-1-1', name: '初诊检查', category: 'GENERAL', price: 3000,
              costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: 'cat-root', children: [],
            }],
          }],
        };
      }
      if (path === '/charge-combos') {
        return [{ id: 'combo-1', code: 'CB-01', name: '洁牙套餐', type: 'PUBLIC', items: [] }];
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');

    async function closeDialog(name: string) {
      fireEvent.keyDown(document.querySelector('.modal')!, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name })).toBeNull();
      });
    }

    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    await screen.findByRole('dialog', { name: '收款' });
    await closeDialog('收款');

    fireEvent.click(screen.getByRole('button', { name: '退款' }));
    await screen.findByRole('dialog', { name: '退款' });
    await closeDialog('退款');

    fireEvent.click(screen.getByRole('button', { name: '展开 正畸项目' }));
    fireEvent.click(screen.getByRole('button', { name: '快捷划价 初诊检查' }));
    await screen.findByRole('dialog', { name: '快捷收费' });
    await closeDialog('快捷收费');

    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    await screen.findByText('洁牙套餐');
    await closeDialog('调出收费组合');
  });

  it('closes the quick charge dialog through its own cancel button', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-trees') {
        return {
          items: [{
            id: 'cat-root', code: 'CAT-1', name: '正畸项目', category: 'GENERAL', price: 10000,
            costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: null,
            children: [{
              id: 'cat-leaf', code: 'CAT-1-1', name: '初诊检查', category: 'GENERAL', price: 3000,
              costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: 'cat-root', children: [],
            }],
          }],
        };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '展开 正畸项目' }));
    fireEvent.click(screen.getByRole('button', { name: '快捷划价 初诊检查' }));
    expect(await screen.findByRole('dialog', { name: '快捷收费' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '快捷收费' })).toBeNull();
    });
  });

  it('loads a combo without items as an empty selection', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') {
        return [{ id: 'combo-1', code: 'CB-01', name: '洁牙套餐', type: 'PUBLIC', items: [] }];
      }
      if (path === '/charge-combos/combo-1/items') {
        return { id: 'combo-1', code: 'CB-01', name: '洁牙套餐', type: 'PUBLIC' };
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    fireEvent.click(await screen.findByRole('button', { name: '载入组合 洁牙套餐' }));
    expect(await screen.findByText('收费组合「洁牙套餐」已载入')).toBeDefined();
    expect(screen.queryByLabelText('项目名称')).toBeNull();
  });

  it('ignores a duplicate quick charge submit while one is pending', async () => {
    let resolveQuick: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-trees') {
        return {
          items: [{
            id: 'cat-leaf', code: 'CAT-1', name: '初诊检查', category: 'GENERAL', price: 3000,
            costType: 'SERVICE', anesthesia: false, businessCategory: null, parentId: null, children: [],
          }],
        };
      }
      if (path === '/charge-trees/cat-leaf/quick-charge' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return await new Promise((resolve) => { resolveQuick = resolve; });
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '快捷划价 初诊检查' }));
    await screen.findByRole('dialog', { name: '快捷收费' });
    await waitFor(() => {
      expect((screen.getByLabelText('快捷收费患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('快捷收费患者'), { target: { value: 'p-1' } });
    const confirm = screen.getByRole('button', { name: '确认快捷收费' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/charge-trees/cat-leaf/quick-charge' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    )).toHaveLength(1);
    resolveQuick?.({ chargeId: 'c-new', number: 'N-NEW', totalAmount: 3000 });
  });

  it('replaces form items from a combo after the last manual row is removed', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/charges?page=1&pageSize=50') return chargeList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/charge-combos') {
        return [{
          id: 'combo-1',
          code: 'CB-01',
          name: '洁牙套餐',
          type: 'PUBLIC',
          items: [
            { id: 'i-1', comboId: 'combo-1', catalogId: null, name: '洁牙', category: 'CLEAN', price: 30000, quantity: 1, costType: 'SERVICE' },
            { id: 'i-2', comboId: 'combo-1', catalogId: null, name: '抛光', category: 'MATERIAL', price: 5000, quantity: 2, costType: 'MATERIAL' },
          ],
        }];
      }
      return {};
    });
    render(<ChargesPage />, { wrapper });
    await screen.findByText('N-1');
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    expect(screen.queryByLabelText('项目名称')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    fireEvent.click(await screen.findByRole('button', { name: '载入组合 洁牙套餐' }));
    expect((screen.getAllByLabelText('项目名称') as HTMLInputElement[]).map((input) => input.value)).toEqual(['洁牙', '抛光']);
  });
});
