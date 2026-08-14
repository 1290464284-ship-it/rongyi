// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemberCardsPage } from './MemberCardsPage';
import { MemberCardPlanDialog } from './MemberCardPlanDialog';
import { MemberCardQuoteDialog } from './MemberCardQuoteDialog';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/memberCards?page=1&pageSize=100') {
      return { items: [{ id: 'card-1', cardNo: 'C001', patientId: 'p-1', balance: 1000, points: 10, status: 'ACTIVE', level: 'VIP' }], total: 1, page: 1, pageSize: 100 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    return {};
  });
}

describe('MemberCardsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('lists and creates member cards', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    expect(await screen.findByText('C001')).toBeDefined();

    fireEvent.click(screen.getByText('新建会员卡'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('卡号'), { target: { value: 'C002' } });
    fireEvent.change(screen.getByLabelText('等级'), { target: { value: 'SVIP' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'card-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/member-cards');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      patientId: 'p-1',
      cardNo: 'C002',
      status: 'ACTIVE',
      level: 'SVIP',
    });
    expect(await screen.findByText('会员卡已创建')).toBeDefined();
  });

  it('runs recharge, consume, and points operations', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');

    fireEvent.click(screen.getByRole('button', { name: '充值' }));
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('确认'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/card-1/recharge', expect.objectContaining({
        body: expect.stringContaining('"amount":5000'),
      }));
    });
    expect((await screen.findAllByText('会员卡操作已完成')).length).toBeGreaterThan(0);
    await screen.findByText('C001');

    fireEvent.click(screen.getByRole('button', { name: '消费' }));
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '20' } });
    fireEvent.click(screen.getByText('确认'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/card-1/consume', expect.objectContaining({
        body: expect.stringContaining('"amount":2000'),
      }));
    });
    await screen.findByText('C001');

    fireEvent.click(screen.getByRole('button', { name: '积分' }));
    fireEvent.change(screen.getByLabelText('积分数量'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('确认'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/card-1/points', expect.objectContaining({
        body: expect.stringContaining('"points":5'),
      }));
    });
    expect((await screen.findAllByText('会员卡操作已完成')).length).toBeGreaterThan(0);
  });

  it('validates create and action inputs', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');

    fireEvent.click(screen.getByText('新建会员卡'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者并填写卡号')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    fireEvent.click(screen.getByRole('button', { name: '充值' }));
    fireEvent.click(screen.getByText('确认'));
    expect(await screen.findByText('请输入有效金额')).toBeDefined();
  });

  it('renders formatted card labels and rejects invalid points', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    expect(await screen.findByText('¥10.00')).toBeDefined();
    expect(screen.getByText('启用')).toBeDefined();
    expect(screen.getByText('VIP会员')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '积分' }));
    fireEvent.change(screen.getByLabelText('积分数量'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('确认'));
    expect(await screen.findByText('请输入有效积分')).toBeDefined();

    fireEvent.change(screen.getByLabelText('积分数量'), { target: { value: '-5' } });
    fireEvent.click(screen.getByText('确认'));
    expect(await screen.findByText('请输入有效积分')).toBeDefined();
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => String(path).includes('/points')).length).toBe(0);
  });

  it('saves a discount plan from the plan dialog', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');

    fireEvent.click(screen.getByRole('button', { name: '折扣方案' }));
    fireEvent.change(screen.getByLabelText('折扣率(%)'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('单次折扣上限(元)'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('取整方式'), { target: { value: 'ROUND' } });
    fireEvent.change(screen.getByLabelText('年度折扣上限(元)'), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText('特殊项目折扣'), {
      target: { value: '[{"name":"隐形矫正","category":"ORTHODONTIC","rate":90}]' },
    });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/card-1/discount-plan', expect.objectContaining({ method: 'PUT' }));
    });
    const planCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/member-cards/card-1/discount-plan');
    expect(JSON.parse(String(planCall?.[1]?.body))).toEqual({
      discountRate: 90,
      maxDiscountAmount: 5000,
      roundingMode: 'ROUND',
      annualDiscountLimit: 200000,
      specialDiscountsJson: [{ name: '隐形矫正', category: 'ORTHODONTIC', rate: 90 }],
    });
    expect(await screen.findByText('折扣方案已保存')).toBeDefined();
  });

  it('guards discount plan save against double submission', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const showToast = vi.fn();
    vi.mocked(apiRequest).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 50)));
    render(<MemberCardPlanDialog open cardId="card-1" onSaved={onSaved} onClose={onClose} showToast={showToast} />, { wrapper });
    fireEvent.click(screen.getByText('\u4fdd\u5b58'));
    fireEvent.click(screen.getByText('\u4fdd\u5b58'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/member-cards/card-1/discount-plan')).toHaveLength(1);
  });

  it('rejects invalid special discount JSON with an error toast', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');

    fireEvent.click(screen.getByRole('button', { name: '折扣方案' }));
    fireEvent.change(screen.getByLabelText('特殊项目折扣'), { target: { value: '[{"name":' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('特殊项目折扣 JSON 格式错误')).toBeDefined();
    expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === '/member-cards/card-1/discount-plan')).toBe(false);
  });

  it('does not save a discount plan without a card id and reports save failures', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const showToast = vi.fn();
    const { rerender } = render(
      <MemberCardPlanDialog open cardId={null} onSaved={onSaved} onClose={onClose} showToast={showToast} />,
      { wrapper },
    );
    fireEvent.click(screen.getByText('保存'));
    expect(apiRequest).not.toHaveBeenCalledWith(expect.stringContaining('/discount-plan'), expect.anything());

    vi.mocked(apiRequest).mockRejectedValueOnce(new Error(''));
    rerender(
      <MemberCardPlanDialog open cardId="card-1" onSaved={onSaved} onClose={onClose} showToast={showToast} />,
    );
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('保存折扣方案失败', 'error');
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('changes the status field when editing and closes action dialogs', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'FROZEN' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'card-1' });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/memberCards/card-1');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toMatchObject({ status: 'FROZEN' });
    });

    fireEvent.click(screen.getByRole('button', { name: '充值' }));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '积分' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '报价试算' }));
    const quoteDialog = (await screen.findByLabelText('原价金额（元）')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.keyDown(quoteDialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByLabelText('原价金额（元）')).toBeNull();
    });
  });

  it('reports member card action failures', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error(''));
    fireEvent.click(screen.getByRole('button', { name: '充值' }));
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('确认'));
    expect(await screen.findByText('会员卡操作失败')).toBeDefined();
  });

  it('renders fallback labels for sparse card rows and prefills missing fields', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/memberCards?page=1&pageSize=100') {
        return {
          items: [
            { id: 'card-null', status: null, level: null },
            { id: 'card-weird', status: 'WEIRD', level: 'CUSTOM' },
            { id: 'card-rate', status: 'ACTIVE', level: 'NORMAL', discountRate: 90 },
          ],
          total: 3,
          page: 1,
          pageSize: 100,
        };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<MemberCardsPage />, { wrapper });
    expect(await screen.findByText('WEIRD')).toBeDefined();
    expect(screen.getByText('CUSTOM')).toBeDefined();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('90%')).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    await waitFor(() => {
      expect((screen.getByLabelText('卡号') as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('ACTIVE');
      expect((screen.getByLabelText('等级') as HTMLSelectElement).value).toBe('NORMAL');
    });
  });

  it('runs a quote from the quote dialog', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');
    vi.mocked(apiRequest).mockResolvedValueOnce({ applied: true, total: 8500, discount: 1500, annualRemaining: 50000 });

    fireEvent.click(screen.getByRole('button', { name: '报价试算' }));
    fireEvent.change(screen.getByLabelText('原价金额（元）'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('试算'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/card-1/quote', expect.objectContaining({
        body: expect.stringContaining('"baseTotal":10000'),
      }));
    });
    expect(await screen.findByText('折后应付：¥85.00')).toBeDefined();
    expect(screen.getByText('优惠：¥15.00')).toBeDefined();
    expect(screen.getByText('年度剩余：¥500.00')).toBeDefined();
  });

  it('shows the no-plan hint when the card has no discount plan', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');
    vi.mocked(apiRequest).mockResolvedValueOnce({ applied: false, reason: 'NO_PLAN', baseTotal: 10000, total: 10000, discount: 0 });

    fireEvent.click(screen.getByRole('button', { name: '报价试算' }));
    fireEvent.change(screen.getByLabelText('原价金额（元）'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('试算'));
    expect(await screen.findByText('该卡无折扣方案')).toBeDefined();
  });

  it('edits a member card and PATCHes card fields', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('卡号') as HTMLInputElement).value).toBe('C001');
    expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('ACTIVE');
    expect((screen.getByLabelText('等级') as HTMLSelectElement).value).toBe('VIP');

    fireEvent.change(screen.getByLabelText('卡号'), { target: { value: 'C001-X' } });
    fireEvent.change(screen.getByLabelText('等级'), { target: { value: 'SVIP' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/memberCards/card-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/memberCards/card-1');
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      patientId: 'p-1',
      cardNo: 'C001-X',
      status: 'ACTIVE',
      level: 'SVIP',
    });
    expect(await screen.findByText('会员卡已更新')).toBeDefined();
  });

  it('deletes a member card through the generic resource endpoint', async () => {
    mockData();
    render(<MemberCardsPage />, { wrapper });
    await screen.findByText('C001');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/memberCards/card-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('会员卡已删除')).toBeDefined();
  });

  it('shows loading, error, and empty states', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<MemberCardsPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('cards failed'));
    render(<MemberCardsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    render(<MemberCardsPage />, { wrapper });
    expect(await screen.findByText('暂无会员卡')).toBeDefined();
  });
});

describe('MemberCardQuoteDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('rejects invalid and negative quote amounts', async () => {
    const showToast = vi.fn();
    const { container } = render(
      <MemberCardQuoteDialog open cardId="card-1" onClose={vi.fn()} showToast={showToast} />,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText('原价金额（元）'), { target: { value: '-5' } });
    await act(async () => {});
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(showToast).toHaveBeenCalledWith('请输入有效金额', 'error');
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('ignores a second quote request while one is pending', async () => {
    let resolveQuote: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(
      () => new Promise((resolve) => { resolveQuote = resolve; }),
    );
    const showToast = vi.fn();
    const { container } = render(
      <MemberCardQuoteDialog open cardId="card-1" onClose={vi.fn()} showToast={showToast} />,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText('原价金额（元）'), { target: { value: '100' } });
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    resolveQuote?.({ applied: false, reason: 'NO_PLAN' });
  });

  it('closes the dialog through the cancel button', async () => {
    const onClose = vi.fn();
    render(
      <MemberCardQuoteDialog open cardId="card-1" onClose={onClose} showToast={vi.fn()} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
