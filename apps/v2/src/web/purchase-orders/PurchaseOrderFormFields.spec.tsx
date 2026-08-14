// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PurchaseOrderFormFields } from './PurchaseOrderFormFields';
import { emptyPurchaseForm } from './form';
import { apiRequest, fetchAllPages } from '../lib/api';
import type { PurchaseOrderForm, PurchaseOrderItemRow } from './types';

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
  fetchAllPages: vi.fn(),
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

function mockLookups() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path.startsWith('/resources/suppliers?')) {
      return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 100 };
    }
    if (path.startsWith('/resources/inventoryItems?')) {
      return { items: [{ id: 'i-1', name: '耗材' }], total: 1, page: 1, pageSize: 100 };
    }
    return {};
  });
}

function FormHarness({
  editing = false,
  editingId = null,
  onItemsLoaded,
}: {
  editing?: boolean;
  editingId?: string | null;
  onItemsLoaded?: () => void;
}) {
  const [form, setForm] = useState<PurchaseOrderForm>(() => emptyPurchaseForm());
  return (
    <PurchaseOrderFormFields
      form={form}
      update={(patch) => setForm((current) => ({ ...current, ...patch }))}
      editing={editing}
      editingId={editingId}
      onItemsLoaded={onItemsLoaded}
    />
  );
}

describe('PurchaseOrderFormFields', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(fetchAllPages).mockReset();
  });

  it('updates fields and manages item rows', async () => {
    mockLookups();
    render(<FormHarness />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('供应商') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('采购单号'), { target: { value: 'PO-1' } });
    expect((screen.getByLabelText('采购单号') as HTMLInputElement).value).toBe('PO-1');
    fireEvent.change(screen.getByLabelText('供应商'), { target: { value: 's-1' } });
    await waitFor(() => {
      expect((screen.getByLabelText('采购项目') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('采购项目'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByLabelText('采购数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('采购单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    expect(screen.getAllByLabelText('采购项目')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]);
    expect(screen.getAllByLabelText('采购项目')).toHaveLength(1);
  });

  it('backfills items when editing and locks the editor while loading', async () => {
    mockLookups();
    let resolveItems!: (value: unknown[]) => void;
    vi.mocked(fetchAllPages).mockImplementation(() => new Promise((resolve) => {
      resolveItems = resolve;
    }));
    render(<FormHarness editing editingId="po-1" />, { wrapper });
    expect(screen.getByText('明细加载中...')).toBeDefined();
    expect((screen.getByRole('button', { name: '添加明细' }) as HTMLButtonElement).disabled).toBe(true);
    resolveItems([
      { id: 'i1', itemId: 'i-1', name: '耗材', spec: 'S', quantity: 3, unitPrice: 10000, subtotal: 30000 },
    ]);
    await waitFor(() => {
      expect((screen.getByLabelText('采购数量') as HTMLInputElement).value).toBe('3');
    });
    expect((screen.getByRole('button', { name: '添加明细' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports backfill failures', async () => {
    vi.mocked(fetchAllPages).mockRejectedValue(new Error(''));
    const onItemsLoaded = vi.fn();
    render(<FormHarness editing editingId="po-1" onItemsLoaded={onItemsLoaded} />, { wrapper });
    expect(await screen.findByText('明细加载失败，请关闭后重试')).toBeDefined();
    expect(onItemsLoaded).not.toHaveBeenCalled();
  });

  it('backfills sparse rows with blank and default fallbacks', async () => {
    mockLookups();
    vi.mocked(fetchAllPages).mockResolvedValue([
      { id: 'i9', itemId: null, name: null, spec: null, quantity: null, unitPrice: null, subtotal: null },
    ]);
    render(<FormHarness editing editingId="po-9" />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('采购数量') as HTMLInputElement).value).toBe('1');
    });
    expect((screen.getByLabelText('采购单价') as HTMLInputElement).value).toBe('0.00');
  });

  it('backfills an empty list when the detail fetch resolves null', async () => {
    mockLookups();
    vi.mocked(fetchAllPages).mockImplementation(
      async () => null as unknown as PurchaseOrderItemRow[],
    );
    const onItemsLoaded = vi.fn();
    render(<FormHarness editing editingId="po-null" onItemsLoaded={onItemsLoaded} />, { wrapper });
    await waitFor(() => {
      expect(onItemsLoaded).toHaveBeenCalled();
    });
    expect((screen.getByRole('button', { name: '添加明细' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores backfill settlement after unmount', async () => {
    let rejectItems!: (reason?: unknown) => void;
    vi.mocked(fetchAllPages).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectItems = reject;
    }));
    const update = vi.fn();
    render(<PurchaseOrderFormFields form={emptyPurchaseForm()} update={update} editing editingId="po-1" />, { wrapper });
    cleanup();
    rejectItems(new Error('late rejection'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the current name when the option list never loaded', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/suppliers?')) {
        return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path.startsWith('/resources/inventoryItems?')) throw new Error('load failed');
      return {};
    });
    const update = vi.fn();
    render(<PurchaseOrderFormFields form={emptyPurchaseForm()} update={update} editing={false} editingId={null} />, { wrapper });
    const select = await screen.findByLabelText('采购项目') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'i-1' } });
    const patch = update.mock.calls.at(-1)?.[0] as { items?: Array<{ itemId: string; name: string }> };
    expect(patch?.items?.[0]?.itemId).toBe('');
    expect(patch?.items?.[0]?.name).toBe('');
  });

  it('keeps a blank name when the selected option has no name', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/suppliers?')) {
        return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [{ id: 'i-null', name: null }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<FormHarness />, { wrapper });
    const select = await screen.findByLabelText('采购项目') as HTMLSelectElement;
    await waitFor(() => {
      expect(select.options.length).toBeGreaterThan(1);
    });
    fireEvent.change(select, { target: { value: 'i-null' } });
    expect((screen.getByLabelText('采购项目') as HTMLSelectElement).value).toBe('i-null');
  });
});
