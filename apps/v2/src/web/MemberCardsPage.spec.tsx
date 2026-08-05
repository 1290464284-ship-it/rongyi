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
    if (path === '/resources/patients?page=1&pageSize=200') {
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
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('卡号'), { target: { value: 'C002' } });
    fireEvent.change(screen.getByLabelText('等级'), { target: { value: 'SVIP' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'card-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards', expect.objectContaining({ method: 'POST' }));
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

    fireEvent.click(screen.getByRole('button', { name: '消费' }));
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '20' } });
    fireEvent.click(screen.getByText('确认'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/card-1/consume', expect.objectContaining({
        body: expect.stringContaining('"amount":2000'),
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: '积分' }));
    fireEvent.change(screen.getByLabelText('积分数量'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('确认'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/card-1/points', expect.objectContaining({
        body: expect.stringContaining('"points":5'),
      }));
    });
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
});
