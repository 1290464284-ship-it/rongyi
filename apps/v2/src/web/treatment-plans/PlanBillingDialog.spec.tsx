// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanBillingDialog } from './PlanBillingDialog';
import { apiRequest, fetchAllPages } from '../lib/api';
import { ToastProvider } from '../components/toast';
import type { PlanItemRow, PlanRow } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), fetchAllPages: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function planFixture(overrides: Partial<PlanRow> = {}): PlanRow {
  return { id: 'p1', discountType: 'NONE', discountRate: null, totalFee: 10000, ...overrides } as PlanRow;
}

function itemFixture(overrides: Partial<PlanItemRow> = {}): PlanItemRow {
  return {
    id: 'i1',
    name: '洁牙',
    price: 10000,
    quantity: 1,
    billed: 0,
    discountRate: null,
    status: 'PENDING',
    ...overrides,
  } as PlanItemRow;
}

function mockItems(items: PlanItemRow[] = [itemFixture()]) {
  vi.mocked(fetchAllPages).mockResolvedValue(items);
}

describe('PlanBillingDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(fetchAllPages).mockReset();
  });

  it('renders totals and prefilled discount state', async () => {
    mockItems();
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    expect(await screen.findByText('洁牙')).toBeDefined();
    expect(screen.getByText('当前总费用：')).toBeDefined();
    expect((screen.getByLabelText('整单折扣类型') as HTMLSelectElement).value).toBe('NONE');
    expect((screen.getByLabelText('整单折扣率') as HTMLInputElement).value).toBe('');
    expect(screen.getAllByText('¥100.00').length).toBeGreaterThan(0);
  });

  it('prefills a configured plan rate and missing total as zero', async () => {
    mockItems();
    render(<PlanBillingDialog plan={planFixture({ discountType: 'WHOLE', discountRate: 90, totalFee: null })} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    expect(await screen.findByText('洁牙')).toBeDefined();
    expect((screen.getByLabelText('整单折扣类型') as HTMLSelectElement).value).toBe('WHOLE');
    expect((screen.getByLabelText('整单折扣率') as HTMLInputElement).value).toBe('90');
  });

  it('saves a whole-plan discount and refreshes the total', async () => {
    mockItems();
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={onChanged} />, { wrapper });
    await screen.findByText('洁牙');
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'p1', discountType: 'WHOLE', discountRate: 80, totalFee: 8000 });
    fireEvent.change(screen.getByLabelText('整单折扣类型'), { target: { value: 'WHOLE' } });
    fireEvent.change(screen.getByLabelText('整单折扣率'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: '保存折扣' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/treatment-plans/p1/discount',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ discountType: 'WHOLE', discountRate: 80 }) }),
      );
    });
    expect(await screen.findByText('折扣已保存，总费用 ¥80.00')).toBeDefined();
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText('¥80.00')).toBeDefined();
  });

  it('guards save actions against double submission', async () => {
    mockItems();
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    await screen.findByText('洁牙');
    vi.mocked(apiRequest).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({
      id: 'p1',
      discountType: 'WHOLE',
      discountRate: 80,
      totalFee: 8000,
    }), 50)));
    fireEvent.change(screen.getByLabelText('整单折扣类型'), { target: { value: 'WHOLE' } });
    fireEvent.change(screen.getByLabelText('整单折扣率'), { target: { value: '80' } });
    const button = screen.getByRole('button', { name: '保存折扣' });
    fireEvent.click(button);
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('saves a NONE discount without a rate', async () => {
    mockItems();
    render(<PlanBillingDialog plan={planFixture({ discountType: 'WHOLE', discountRate: 80 })} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    await screen.findByText('洁牙');
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'p1', discountType: 'NONE', discountRate: null, totalFee: 10000 });
    fireEvent.change(screen.getByLabelText('整单折扣类型'), { target: { value: 'NONE' } });
    fireEvent.click(screen.getByRole('button', { name: '保存折扣' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/treatment-plans/p1/discount',
        expect.objectContaining({ body: JSON.stringify({ discountType: 'NONE' }) }),
      );
    });
  });

  it('rejects invalid plan and item discount rates', async () => {
    mockItems();
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    await screen.findByText('洁牙');
    fireEvent.change(screen.getByLabelText('整单折扣类型'), { target: { value: 'WHOLE' } });
    fireEvent.change(screen.getByLabelText('整单折扣率'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: '保存折扣' }));
    expect(await screen.findByText('折扣率须在 0-100 之间')).toBeDefined();

    fireEvent.change(screen.getByLabelText('明细折扣 洁牙'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findAllByText('折扣率须在 0-100 之间')).toHaveLength(2);
    expect(apiRequest).not.toHaveBeenCalledWith('/treatment-plans/p1/discount', expect.anything());
  });

  it('saves an item discount and updates the total', async () => {
    mockItems();
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    await screen.findByText('洁牙');
    vi.mocked(apiRequest).mockResolvedValueOnce({ itemId: 'i1', discountRate: 90, planTotalFee: 9000 });
    fireEvent.change(screen.getByLabelText('明细折扣 洁牙'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/treatment-plans/p1/items/i1/discount',
        expect.objectContaining({ body: JSON.stringify({ discountRate: 90 }) }),
      );
    });
    expect(await screen.findByText('明细折扣已保存，总费用 ¥90.00')).toBeDefined();
  });

  it('bills selected items and disables billing without selection', async () => {
    mockItems();
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    await screen.findByText('洁牙');
    vi.mocked(apiRequest).mockResolvedValueOnce({ chargeId: 'ch-1', number: 'CB-1', totalAmount: 8000, itemCount: 1, billedItemIds: ['i1'] });
    fireEvent.click(screen.getByRole('checkbox', { name: '勾选划价 洁牙' }));
    fireEvent.click(screen.getByRole('button', { name: '划价' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/treatment-plans/p1/bill',
        expect.objectContaining({ body: JSON.stringify({ itemIds: ['i1'] }) }),
      );
    });
    expect(await screen.findByText('已生成划价单 CB-1')).toBeDefined();
    expect((screen.getByRole('checkbox', { name: '勾选划价 洁牙' }) as HTMLInputElement).checked).toBe(false);

    expect((screen.getByRole('button', { name: '划价' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('locks whole-plan discount controls once an item is billed', async () => {
    mockItems([itemFixture({ billed: 1, status: 'BILLED' })]);
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    expect(await screen.findByText('已存在已划价明细，整单折扣不可修改')).toBeDefined();
    expect((screen.getByLabelText('整单折扣类型') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('整单折扣率') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: '勾选划价 洁牙' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('已划价')).toBeDefined();
  });

  it('renders loading, error and empty states', async () => {
    vi.mocked(fetchAllPages).mockImplementation(() => new Promise(() => {}));
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    expect(screen.getByText('明细加载中...')).toBeDefined();

    cleanup();
    vi.mocked(fetchAllPages).mockRejectedValue(new Error('items failed'));
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    cleanup();
    mockItems([]);
    render(<PlanBillingDialog plan={planFixture()} onClose={vi.fn()} onChanged={vi.fn()} />, { wrapper });
    expect(await screen.findByText('暂无明细')).toBeDefined();
  });

  it('renders sparse items with id and quantity fallbacks and closes on demand', async () => {
    mockItems([{ id: 'i9', price: 5000 } as PlanItemRow]);
    const onClose = vi.fn();
    render(<PlanBillingDialog plan={planFixture()} onClose={onClose} onChanged={vi.fn()} />, { wrapper });
    expect(await screen.findByText('i9')).toBeDefined();
    expect(screen.getByText(/¥50\.00/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
