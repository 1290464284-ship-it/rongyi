// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemberCardsPage } from './MemberCardsPage';
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
});
