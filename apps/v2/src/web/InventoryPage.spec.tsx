// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { InventoryPage } from './InventoryPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
  </MemoryRouter>
);

describe('InventoryPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders inventory, low stock, and expiring data', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return {
          items: [
            { id: 'i-1', name: 'Material', stock: 5, minStock: 2 },
            { id: 'i-2', code: 'CODE-ONLY', stock: null, minStock: null },
            { id: 'i-3', name: null, code: null, stock: null, minStock: null },
          ],
          total: 3,
        };
      }
      if (path === '/inventory/low-stock') {
        return [
          { id: 'i-2', name: 'Low', stock: 1, minStock: 2 },
          { id: 'i-4', name: null, code: 'LOW-CODE', stock: null, minStock: null },
        ];
      }
      if (path === '/inventory/expiring?days=30') {
        return [
          { id: 'i-3', name: 'Expiring', expireDate: '2026-08-10', stock: 3 },
          { id: 'i-5', name: null, code: 'EXP-CODE', expireDate: null, stock: null },
        ];
      }
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path.startsWith('/api/v2/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });

    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('Material')).toBeDefined();
    expect(screen.getByText('Low')).toBeDefined();
    expect(screen.getByText('Expiring')).toBeDefined();
  });

  it('submits inventory transactions and generates replenishment', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [], total: 0 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('库存项目 ID'), { target: { value: 'item-new' } });
    fireEvent.change(screen.getByDisplayValue('IN'), { target: { value: 'OUT' } });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    fireEvent.click(await screen.findByRole('button', { name: '保存库存流水' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory/transactions', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('库存流水已记录')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '生成补货建议' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory/replenishment/generate', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('补货建议已生成')).toBeDefined();
  });

  it('reports transaction and generation failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [], total: 0 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path.startsWith('/api/v2/inventory-batches')) return { batches: [], expiring: [] };
      throw new Error('inventory failed');
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '保存库存流水' }));
    expect(await screen.findByText('inventory failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '生成补货建议' }));
    expect(await screen.findByText('inventory failed')).toBeDefined();
  });

  it('uses generic fallback messages for non-error failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [], total: 0 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      throw 'boom';
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '保存库存流水' }));
    expect(await screen.findByText('保存库存流水失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '生成补货建议' }));
    expect(await screen.findByText('生成补货建议失败')).toBeDefined();
  });

  it('initializes the item id from the first inventory item once the list is loaded', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-real-1', name: 'Real Material', stock: 3, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });

    render(<InventoryPage />, { wrapper });
    expect(await screen.findByDisplayValue('i-real-1')).toBeDefined();
  });

  it('prefers the URL id parameter over the list first item when initializing', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-list-1', name: 'List Material', stock: 3, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/inventory', search: '?id=url-item-9' }]}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <InventoryPage />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('url-item-9')).toBeDefined();
  });

  it('renders batch tables and expiring batch alerts', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [{ id: 's-1', name: '供应商甲' }], total: 1 };
      if (path === '/api/v2/inventory-batches?itemId=i-batch') {
        return {
          batches: [
            { id: 'b-1', batchNo: 'B-001', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 10 },
            { id: 'b-2', batchNo: 'B-002', productionDate: '2026-07-02', expiryDate: '2026-10-01', initialQuantity: 5, remainingQuantity: 3 },
          ],
          expiring: [],
        };
      }
      if (path === '/api/v2/inventory-batches?days=30') {
        return {
          batches: [],
          expiring: [
            { id: 'b-3', batchNo: 'B-003', itemName: '麻醉剂', itemCode: 'MAT-009', expiryDate: '2026-08-12', remainingQuantity: 3 },
          ],
        };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('B-001')).toBeDefined();
    expect(screen.getByText('B-002')).toBeDefined();
    expect(screen.getByText('B-003')).toBeDefined();
    expect(screen.getByText('麻醉剂')).toBeDefined();
    expect(screen.getByRole('button', { name: '生成到期提醒' })).toBeDefined();
  });

  it('submits a new batch via POST /api/v2/inventory-batches', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-form', name: 'Form Material', stock: 0, minStock: 0 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [{ id: 's-1', name: '供应商甲' }], total: 1 };
      if (path.startsWith('/api/v2/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });

    render(<InventoryPage />, { wrapper });
    await waitFor(() => {
      expect(screen.getByLabelText('供应商').textContent).toContain('供应商甲');
    });
    fireEvent.change(await screen.findByLabelText('批次号'), { target: { value: 'B-FORM-1' } });
    fireEvent.change(screen.getByLabelText('生产日期'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('效期日期'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('入库数量'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('供应商'), { target: { value: 's-1' } });
    fireEvent.click(screen.getByRole('button', { name: '新增批次' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v2/inventory-batches', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path === '/api/v2/inventory-batches' && options?.method === 'POST');
    expect(JSON.parse(String(postCall?.[1]?.body))).toMatchObject({
      itemId: 'i-form',
      batchNo: 'B-FORM-1',
      productionDate: '2026-07-01',
      expiryDate: '2026-09-01',
      initialQuantity: 8,
      supplierId: 's-1',
    });
    expect(await screen.findByText('批次已入库')).toBeDefined();
  });

  it('generates expiry alerts via POST /api/v2/inventory-batches/expiry-alerts', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path.startsWith('/api/v2/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '生成到期提醒' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/api/v2/inventory-batches/expiry-alerts', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path === '/api/v2/inventory-batches/expiry-alerts' && options?.method === 'POST');
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ days: 30 });
    expect(await screen.findByText('到期提醒已生成')).toBeDefined();
  });
});
