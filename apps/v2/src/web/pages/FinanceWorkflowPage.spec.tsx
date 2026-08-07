// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinanceWorkflowPage } from './FinanceWorkflowPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

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
    expect(await screen.findByText('finance failed')).toBeDefined();

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
});
