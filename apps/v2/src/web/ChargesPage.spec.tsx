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
    if (path === '/resources/patients?page=1&pageSize=100') {
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
});
