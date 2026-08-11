// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChargeList } from './ChargeList';
import { ChargeCreateForm } from './ChargeCreateForm';
import { ChargeTreePanel } from './ChargeTreePanel';
import { ComboDialog } from './ComboDialog';
import { QuickChargeDialog } from './QuickChargeDialog';
import { buildValidItems, emptyChargeForm, methodCodeForName, newItem } from './charge-utils';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';
import type { ChargeForm, ChargeTreeNode } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function CreateHarness({
  onSubmit = vi.fn(),
  onLoadCombos = vi.fn(),
  onQuoteDiscount = vi.fn(),
}: {
  onSubmit?: () => Promise<void>;
  onLoadCombos?: () => void;
  onQuoteDiscount?: () => void;
}) {
  const [form, setForm] = useState<ChargeForm>(() => emptyChargeForm());
  const update = (patch: Partial<ChargeForm>) => setForm((current) => ({ ...current, ...patch }));
  const updateItem = (id: string, patch: Partial<ChargeForm['items'][number]>) =>
    setForm((current) => ({ ...current, items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  return (
    <ChargeCreateForm
      form={form}
      update={update}
      updateItem={updateItem}
      submitting={false}
      onSubmit={onSubmit}
      comboLoading={false}
      actionBusy={false}
      onLoadCombos={onLoadCombos}
      onQuoteDiscount={onQuoteDiscount}
    />
  );
}

describe('charge-utils', () => {
  it('creates defaults and validates charge items', () => {
    const item = newItem();
    expect(item.quantity).toBe('1');
    expect(item.costType).toBe('SERVICE');
    expect(emptyChargeForm().items).toHaveLength(1);
    const valid = buildValidItems([
      { id: 'a', name: '洁牙', category: '', price: '100', quantity: '2', costType: 'SERVICE' },
      { id: 'b', name: '免费', category: '', price: '0', quantity: '1', costType: 'SERVICE' },
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0]).toMatchObject({ name: '洁牙', category: 'GENERAL', price: 10000, quantity: 2 });
    expect(methodCodeForName('微信')).toBe('WECHAT');
    expect(methodCodeForName('未知方式')).toBe('OTHER');
  });
});

describe('ChargeList', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders rows and status-specific actions plus the empty state', () => {
    const onPayment = vi.fn();
    const onRefund = vi.fn();
    const onDelete = vi.fn();
    const rows = [
      { id: 'c1', number: 'C-1', totalAmount: 10000, paidAmount: 0, status: 'UNPAID' },
      { id: 'c2', number: 'C-2', totalAmount: 20000, paidAmount: 20000, status: 'PAID' },
    ];
    const { rerender } = render(<ChargeList rows={rows} onPayment={onPayment} onRefund={onRefund} onDelete={onDelete} />);
    expect(screen.getByText('¥100.00')).toBeDefined();
    expect(screen.getAllByRole('button', { name: '收款' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '退款' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));

    rerender(<ChargeList rows={[]} onPayment={onPayment} onRefund={onRefund} onDelete={onDelete} />);
    expect(screen.getByText('暂无收费单')).toBeDefined();
  });

  it('hides delete for non-UNPAID rows and forwards payment and refund actions', () => {
    const onPayment = vi.fn();
    const onRefund = vi.fn();
    const onDelete = vi.fn();
    render(
      <ChargeList
        rows={[{ id: 'c1', number: 'C-1', totalAmount: 10000, paidAmount: 10000, status: 'PAID' }]}
        onPayment={onPayment}
        onRefund={onRefund}
        onDelete={onDelete}
      />,
    );
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收款' }));
    fireEvent.click(screen.getByRole('button', { name: '退款' }));
    expect(onPayment).toHaveBeenCalledWith('c1');
    expect(onRefund).toHaveBeenCalledWith('c1');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('renders fallback status labels for missing and unknown statuses', () => {
    const onDelete = vi.fn();
    render(
      <ChargeList
        rows={[
          { id: 'c1', number: 'C-1', totalAmount: 10000, paidAmount: 0, status: null },
          { id: 'c2', number: 'C-2', totalAmount: 20000, paidAmount: 20000, status: 'UNKNOWN' },
        ]}
        onPayment={vi.fn()}
        onRefund={vi.fn()}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('UNKNOWN')).toBeDefined();
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('QuickChargeDialog', () => {
  it('renders empty and busy states', () => {
    const target: ChargeTreeNode = {
      id: 'i1',
      code: 'T-1',
      name: '洁牙',
      category: 'GENERAL',
      price: 10000,
      costType: 'SERVICE',
      anesthesia: false,
      businessCategory: 'SERVICE',
      parentId: null,
      children: [],
    };
    const { rerender } = render(
      <QuickChargeDialog
        target={null}
        quantity="1"
        setQuantity={vi.fn()}
        patientId=""
        setPatientId={vi.fn()}
        busy={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
      { wrapper },
    );
    expect((screen.getByLabelText('快捷收费项目名') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('快捷收费单价') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: '确认快捷收费' })).toBeDefined();

    rerender(
      <QuickChargeDialog
        target={target}
        quantity="1"
        setQuantity={vi.fn()}
        patientId=""
        setPatientId={vi.fn()}
        busy
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('快捷收费单价') as HTMLInputElement).value).toBe('100');
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDefined();
  });
});

describe('ChargeCreateForm', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('warns about dropped rows and validates the discount range', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const form = emptyChargeForm();
    form.items[0] = { ...form.items[0], name: '洁牙', price: '', quantity: '1' };
    render(
      <ChargeCreateForm
        form={form}
        update={vi.fn()}
        updateItem={vi.fn()}
        submitting={false}
        onSubmit={onSubmit}
        comboLoading={false}
        actionBusy={false}
        onLoadCombos={vi.fn()}
        onQuoteDiscount={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    expect(await screen.findByText('1 条明细因缺少有效价格或数量将被忽略')).toBeDefined();
    expect(onSubmit).toHaveBeenCalled();

    cleanup();
    const validForm = emptyChargeForm();
    validForm.items[0] = { ...validForm.items[0], name: '洁牙', price: '100', quantity: '1' };
    validForm.discount = '200';
    render(
      <ChargeCreateForm
        form={validForm}
        update={vi.fn()}
        updateItem={vi.fn()}
        submitting={false}
        onSubmit={onSubmit}
        comboLoading={false}
        actionBusy={false}
        onLoadCombos={vi.fn()}
        onQuoteDiscount={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '新建收费单' }));
    expect(await screen.findByText('优惠金额需在 0 与应收总额 ¥100.00 之间')).toBeDefined();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('manages rows and forwards combo and quote actions', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onLoadCombos = vi.fn();
    const onQuoteDiscount = vi.fn();
    render(
      <CreateHarness onSubmit={onSubmit} onLoadCombos={onLoadCombos} onQuoteDiscount={onQuoteDiscount} />,
      { wrapper },
    );
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    expect(screen.getAllByLabelText('项目名称')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]);
    expect(screen.getAllByLabelText('项目名称')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '调出收费组合' }));
    expect(onLoadCombos).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '会员折扣试算' }));
    expect(onQuoteDiscount).toHaveBeenCalled();
  });
});

describe('ComboDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders loading, empty and combo rows', () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<ComboDialog combos={null} onClose={onClose} onApply={onApply} />);
    expect(screen.getByText('加载中...')).toBeDefined();

    rerender(<ComboDialog combos={[]} onClose={onClose} onApply={onApply} />);
    expect(screen.getByText('暂无可用收费组合')).toBeDefined();

    rerender(
      <ComboDialog
        combos={[{ id: 'combo-1', code: 'C1', name: '洁牙套餐', type: 'PUBLIC', items: [] }]}
        onClose={onClose}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '载入组合 洁牙套餐' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'combo-1' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders private combos with item counts', () => {
    const onApply = vi.fn();
    render(
      <ComboDialog
        combos={[{
          id: 'combo-2',
          code: 'C2',
          name: '私有套餐',
          type: 'PRIVATE',
          items: [{ id: 'i1', comboId: 'combo-2', name: '洁牙', category: 'GENERAL', price: 10000, quantity: 1 }],
        }]}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );
    expect(screen.getByText('私有')).toBeDefined();
    expect(screen.getByText('1 项')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '载入组合 私有套餐' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: 'combo-2' }));
  });
});

describe('ChargeTreePanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders loading, error, empty and tree states', () => {
    const onToggleCatalog = vi.fn();
    const onQuickCharge = vi.fn();
    const { rerender } = render(
      <ChargeTreePanel isLoading error={null} items={[]} expandedCatalogs={{}} onToggleCatalog={onToggleCatalog} onQuickCharge={onQuickCharge} />,
    );
    expect(screen.getByText('收费项目加载中...')).toBeDefined();

    rerender(
      <ChargeTreePanel isLoading={false} error={new Error('Load failed')} items={[]} expandedCatalogs={{}} onToggleCatalog={onToggleCatalog} onQuickCharge={onQuickCharge} />,
    );
    expect(screen.getByText('网络请求失败，请重试')).toBeDefined();

    rerender(
      <ChargeTreePanel isLoading={false} error={null} items={[]} expandedCatalogs={{}} onToggleCatalog={onToggleCatalog} onQuickCharge={onQuickCharge} />,
    );
    expect(screen.getByText('暂无收费项目')).toBeDefined();

    const items: ChargeTreeNode[] = [
      {
        id: 'cat',
        code: 'C',
        name: '目录',
        category: '',
        price: 0,
        costType: 'SERVICE',
        anesthesia: false,
        businessCategory: 'SERVICE',
        parentId: null,
        children: [
          {
            id: 'leaf',
            code: 'L',
            name: '洁牙',
            category: '',
            price: 10000,
            costType: 'MATERIAL',
            anesthesia: false,
            businessCategory: 'MATERIAL',
            parentId: 'cat',
            children: [],
          },
        ],
      },
    ];
    rerender(
      <ChargeTreePanel isLoading={false} error={null} items={items} expandedCatalogs={{}} onToggleCatalog={onToggleCatalog} onQuickCharge={onQuickCharge} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开 目录' }));
    expect(onToggleCatalog).toHaveBeenCalledWith('cat');

    rerender(
      <ChargeTreePanel isLoading={false} error={null} items={items} expandedCatalogs={{ cat: true }} onToggleCatalog={onToggleCatalog} onQuickCharge={onQuickCharge} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '快捷划价 洁牙' }));
    expect(onQuickCharge).toHaveBeenCalledWith(expect.objectContaining({ id: 'leaf' }));
    expect(screen.getByText('材料')).toBeDefined();
  });

  it('uses a fallback message for non-error failures', () => {
    render(
      <ChargeTreePanel
        isLoading={false}
        error="boom"
        items={[]}
        expandedCatalogs={{}}
        onToggleCatalog={vi.fn()}
        onQuickCharge={vi.fn()}
      />,
    );
    expect(screen.getByText('收费项目加载失败')).toBeDefined();
  });
});
