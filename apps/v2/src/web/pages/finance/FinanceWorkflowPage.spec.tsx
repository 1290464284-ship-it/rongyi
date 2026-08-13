// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceWorkflowPage } from './FinanceWorkflowPage';
import { apiRequest, fetchAllPages } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), fetchAllPages: vi.fn(), downloadCsv: vi.fn() }));

vi.mocked(fetchAllPages).mockImplementation(async (path: string) => {
  const data = await vi.mocked(apiRequest)(path) as { items?: unknown[] } | unknown[];
  return Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? [];
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

function installFinanceData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/memberCards?page=1&pageSize=100') {
      return {
        items: [
          { id: 'c-1', cardNo: 'CARD-1', balance: 100 },
          { id: 'c-2', cardNo: null, balance: null },
        ],
        total: 2,
      };
    }
    if (path === '/resources/debtRecords?page=1&pageSize=100') {
      return {
        items: [
          { id: 'd-1', totalAmount: 200, paidAmount: 50, status: 'PARTIAL' },
          { id: 'd-2', totalAmount: null, paidAmount: null, status: null },
        ],
        total: 2,
      };
    }
    return { ok: true };
  });
}

async function submitAmount(value: string) {
  const input = await screen.findByPlaceholderText('例如：100');
  fireEvent.change(input, { target: { value } });
  const form = input.closest('form');
  if (form) fireEvent.submit(form);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('FinanceWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders member cards and debts and performs financial actions', async () => {
    installFinanceData();
    render(<FinanceWorkflowPage />, { wrapper });
    expect(await screen.findByText('CARD-1')).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: '充值' })[0]);
    await submitAmount('1');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/c-1/recharge', expect.objectContaining({ method: 'POST' }));
    });

    fireEvent.click(screen.getAllByRole('button', { name: '消费' })[0]);
    await submitAmount('2');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/c-1/consume', expect.objectContaining({ method: 'POST' }));
    });

    fireEvent.click(screen.getAllByRole('button', { name: '还款' })[0]);
    await submitAmount('0.5');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/debts/d-1/pay', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('reports error and non-error failures', async () => {
    installFinanceData();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/memberCards?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', cardNo: 'CARD-1', balance: 100 }], total: 1 };
      }
      if (path === '/resources/debtRecords?page=1&pageSize=100') {
        return { items: [{ id: 'd-1', totalAmount: 200, paidAmount: 50, status: 'PARTIAL' }], total: 1 };
      }
      throw new Error('finance failed');
    });

    render(<FinanceWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '充值' }))[0]);
    await submitAmount('1');
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/memberCards?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', cardNo: 'CARD-1', balance: 100 }], total: 1 };
      }
      if (path === '/resources/debtRecords?page=1&pageSize=100') {
        return { items: [{ id: 'd-1', totalAmount: 200, paidAmount: 50, status: 'PARTIAL' }], total: 1 };
      }
      throw 'boom';
    });
    fireEvent.click(screen.getAllByRole('button', { name: '消费' })[0]);
    await submitAmount('1');
    expect(await screen.findByText('操作失败')).toBeDefined();
  });

  it('rejects invalid or missing amounts', async () => {
    installFinanceData();
    render(<FinanceWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '充值' }))[0]);
    await submitAmount('-1');
    expect(await screen.findByText('请输入有效金额')).toBeDefined();
  });

  it('cancels the amount dialog', async () => {
    installFinanceData();
    render(<FinanceWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '充值' }))[0]);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows loading and empty states for both sections', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<FinanceWorkflowPage />, { wrapper });
    expect(screen.getAllByText('加载中...').length).toBeGreaterThanOrEqual(2);
    cleanup();

    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0 });
    render(<FinanceWorkflowPage />, { wrapper });
    expect(await screen.findByText('暂无会员卡')).toBeDefined();
    expect(screen.getByText('暂无欠费')).toBeDefined();
  });

  it('degrades a failing section and keeps the rest interactive', async () => {
    let debtLoads = 0;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/memberCards?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', cardNo: 'CARD-1', balance: 100 }], total: 1 };
      }
      if (path === '/member-cards/c-1/recharge') return { ok: true };
      if (path === '/resources/debtRecords?page=1&pageSize=100') {
        debtLoads += 1;
        if (debtLoads === 1) throw new Error('debts failed');
        return { items: [], total: 0 };
      }
      throw new Error('debts failed');
    });
    render(<FinanceWorkflowPage />, { wrapper });

    expect(await screen.findByText('该区块加载失败')).toBeDefined();
    expect(screen.getAllByRole('button', { name: '重试' }).length).toBeGreaterThan(0);
    expect(screen.getByText('CARD-1')).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: '充值' })[0]);
    await submitAmount('1');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/member-cards/c-1/recharge', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('操作成功')).toBeDefined();
  });

  it('submits debt payments through the amount dialog', async () => {
    installFinanceData();
    render(<FinanceWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '还款' }))[0]);
    await submitAmount('1.5');
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/debts/d-1/pay', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/debts/d-1/pay');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ amount: 150 });
  });

  it('ignores a second amount submit while the first request is pending', async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/memberCards?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', cardNo: 'CARD-1', balance: 100 }], total: 1 };
      }
      if (path === '/resources/debtRecords?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      return new Promise((resolve) => { resolveAction = resolve; });
    });
    render(<FinanceWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '充值' }))[0]);
    const input = await screen.findByPlaceholderText('例如：100');
    fireEvent.change(input, { target: { value: '10' } });
    const form = input.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    const actionCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/member-cards/c-1/recharge');
    expect(actionCalls).toHaveLength(1);
    resolveAction?.({ ok: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders undefined query data as empty tables', async () => {
    vi.mocked(apiRequest).mockResolvedValue(undefined);
    render(<FinanceWorkflowPage />, { wrapper });
    expect(await screen.findByText('财务操作')).toBeDefined();
    await waitFor(() => expect(screen.queryByText('加载中...')).toBeNull());
    expect(screen.getAllByText('下一页').length).toBeGreaterThan(0);
  });

  it('ignores amount submissions while the page is stale', async () => {
    let resolveCards: (value: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/memberCards?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', cardNo: 'CARD-1', balance: 100 }], total: 125 };
      }
      if (path === '/resources/memberCards?page=2&pageSize=100') {
        return new Promise((resolve) => { resolveCards = resolve; });
      }
      if (path === '/resources/debtRecords?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      return {};
    });
    render(<FinanceWorkflowPage />, { wrapper });
    // 先在可用态打开金额弹窗，再翻页制造 stale（React 会抑制 disabled 按钮的点击）
    const recharge = (await screen.findAllByRole('button', { name: '充值' }))[0];
    fireEvent.click(recharge);
    const input = await screen.findByPlaceholderText('例如：100');
    fireEvent.change(input, { target: { value: '10' } });
    const form = input.closest('form') as HTMLFormElement;
    const nextButton = screen.getAllByRole('button', { name: '下一页' })[0] as HTMLButtonElement;
    fireEvent.click(nextButton);
    await waitFor(() => expect(nextButton.disabled).toBe(true));
    fireEvent.submit(form);
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith('/member-cards/c-1/recharge', expect.anything());
    resolveCards({ items: [], total: 125 });
    // stale 期间提交被忽略：不触发写操作，弹窗保持打开供用户重新确认
    await waitFor(() => expect(screen.getByRole('dialog')).not.toBeNull());
  });
});
