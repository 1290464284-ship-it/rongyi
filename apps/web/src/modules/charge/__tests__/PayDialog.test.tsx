import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock toast 服务
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('@/lib/utils/toast-service', () => ({
  toastService: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { PayDialog } from '../components/payments/PayDialog';
import type { Charge } from '@/lib/api/financial/charge';

const charge = {
  id: 'c1',
  number: 'SF20260001',
  patientId: 'p1',
  patient: { id: 'p1', name: '张三' },
  totalAmount: '300',
  paidAmount: '100',
  status: 'PARTIAL',
  createdAt: '2026-01-01T00:00:00Z',
} as unknown as Charge;

describe('PayDialog 收款流程', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展示单号、患者和待收金额', () => {
    render(
      <PayDialog open onClose={vi.fn()} charge={charge} onPay={vi.fn()} isPending={false} />
    );

    expect(screen.getByText('SF20260001')).toBeInTheDocument();
    expect(screen.getByText('张三')).toBeInTheDocument();
    // 待收 = 300 - 100 = 200
    expect(screen.getByText('¥200.00')).toBeInTheDocument();
  });

  it('确认收款调用 onPay 并在成功后关闭弹窗', async () => {
    const user = userEvent.setup();
    const onPay = vi.fn().mockResolvedValue(charge);
    const onClose = vi.fn();

    render(
      <PayDialog open onClose={onClose} charge={charge} onPay={onPay} isPending={false} />
    );

    await user.click(screen.getByText('确认收款'));

    await waitFor(() => {
      expect(onPay).toHaveBeenCalledWith({ id: 'c1', amount: 200, payMethod: 'WECHAT' });
      expect(mockToastSuccess).toHaveBeenCalledWith('收款成功');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('可修改收款金额和支付方式', async () => {
    const user = userEvent.setup();
    const onPay = vi.fn().mockResolvedValue(charge);

    render(
      <PayDialog open onClose={vi.fn()} charge={charge} onPay={onPay} isPending={false} />
    );

    const amountInput = screen.getByLabelText('收款金额');
    await user.clear(amountInput);
    await user.type(amountInput, '50');
    await user.selectOptions(screen.getByLabelText('支付方式'), 'CASH');
    await user.click(screen.getByText('确认收款'));

    await waitFor(() => {
      expect(onPay).toHaveBeenCalledWith({ id: 'c1', amount: 50, payMethod: 'CASH' });
    });
  });

  it('收款金额超过待收金额时按钮禁用', async () => {
    const user = userEvent.setup();

    render(
      <PayDialog open onClose={vi.fn()} charge={charge} onPay={vi.fn()} isPending={false} />
    );

    const amountInput = screen.getByLabelText('收款金额');
    await user.clear(amountInput);
    await user.type(amountInput, '999');

    expect(screen.getByText('确认收款').closest('button')).toBeDisabled();
  });

  it('收款失败时提示错误且不关闭弹窗', async () => {
    const user = userEvent.setup();
    const onPay = vi.fn().mockRejectedValue(new Error('余额不足'));
    const onClose = vi.fn();

    render(
      <PayDialog open onClose={onClose} charge={charge} onPay={onPay} isPending={false} />
    );

    await user.click(screen.getByText('确认收款'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
