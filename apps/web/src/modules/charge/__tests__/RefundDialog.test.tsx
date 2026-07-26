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

import { RefundDialog } from '../components/RefundDialog';
import type { Charge } from '@/lib/api/financial/charges';

const charge = {
  id: 'c1',
  number: 'SF20260001',
  patientId: 'p1',
  patient: { id: 'p1', name: '张三' },
  totalAmount: '300',
  paidAmount: '300',
  refundedAmount: '100',
  status: 'PAID',
  createdAt: '2026-01-01T00:00:00Z',
} as unknown as Charge;

describe('RefundDialog 退款流程', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展示可退金额', () => {
    render(
      <RefundDialog open onClose={vi.fn()} charge={charge} onRefund={vi.fn()} isPending={false} />
    );

    // 可退 = 300 - 100 = 200
    expect(screen.getByText('¥200.00')).toBeInTheDocument();
  });

  it('确认退款调用 onRefund 并在成功后关闭弹窗', async () => {
    const user = userEvent.setup();
    const onRefund = vi.fn().mockResolvedValue(charge);
    const onClose = vi.fn();

    render(
      <RefundDialog open onClose={onClose} charge={charge} onRefund={onRefund} isPending={false} />
    );

    await user.type(screen.getByLabelText('退款原因（可选）'), '患者要求');
    await user.click(screen.getByText('确认退款'));

    await waitFor(() => {
      expect(onRefund).toHaveBeenCalledWith({
        id: 'c1',
        patientId: 'p1',
        amount: 200,
        reason: '患者要求',
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('退款成功');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('退款金额超过可退金额时按钮禁用', async () => {
    const user = userEvent.setup();

    render(
      <RefundDialog open onClose={vi.fn()} charge={charge} onRefund={vi.fn()} isPending={false} />
    );

    const amountInput = screen.getByLabelText('退款金额');
    await user.clear(amountInput);
    await user.type(amountInput, '999');

    expect(screen.getByText('确认退款').closest('button')).toBeDisabled();
  });

  it('退款失败时提示错误且不关闭弹窗', async () => {
    const user = userEvent.setup();
    const onRefund = vi.fn().mockRejectedValue(new Error('退款失败'));
    const onClose = vi.fn();

    render(
      <RefundDialog open onClose={onClose} charge={charge} onRefund={onRefund} isPending={false} />
    );

    await user.click(screen.getByText('确认退款'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
