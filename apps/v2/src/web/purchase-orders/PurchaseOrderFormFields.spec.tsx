// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PurchaseOrderFormFields } from './PurchaseOrderFormFields';
import { emptyPurchaseForm } from './form';
import { apiRequest, fetchAllPages } from '../lib/api';
import type { SearchableSelectRow } from '../components';
import type { PurchaseOrderForm } from './types';

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

function FormHarness({ editing = false, editingId = null }: { editing?: boolean; editingId?: string | null }) {
  const [form, setForm] = useState<PurchaseOrderForm>(() => emptyPurchaseForm());
  const [inventoryRows, setInventoryRows] = useState<SearchableSelectRow[]>([]);
  return (
    <PurchaseOrderFormFields
      form={form}
      update={(patch) => setForm((current) => ({ ...current, ...patch }))}
      inventoryRows={inventoryRows}
      setInventoryRows={setInventoryRows}
      editing={editing}
      editingId={editingId}
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
    render(<FormHarness editing editingId="po-1" />, { wrapper });
    expect(await screen.findByText('明细加载失败，请关闭后重试')).toBeDefined();
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
});
