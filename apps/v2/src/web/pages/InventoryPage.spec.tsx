// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { InventoryPage } from './InventoryPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

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
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
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
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      throw new Error('inventory failed');
    });

    render(<InventoryPage />, { wrapper });
    // M13：itemId 必填校验，先填项目 ID 再提交以触达失败路径
    fireEvent.change(await screen.findByLabelText('库存项目 ID'), { target: { value: 'item-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存库存流水' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '生成补货建议' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
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
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

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
      if (path === '/inventory-batches?itemId=i-batch') {
        return {
          batches: [
            { id: 'b-1', batchNo: 'B-001', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 10 },
            { id: 'b-2', batchNo: 'B-002', productionDate: '2026-07-02', expiryDate: '2026-10-01', initialQuantity: 5, remainingQuantity: 3 },
          ],
          expiring: [],
        };
      }
      if (path === '/inventory-batches?days=30') {
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

  it('submits a new batch via POST /inventory-batches', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-form', name: 'Form Material', stock: 0, minStock: 0 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [{ id: 's-1', name: '供应商甲' }], total: 1 };
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
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
      expect(apiRequest).toHaveBeenCalledWith('/inventory-batches', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path === '/inventory-batches' && options?.method === 'POST');
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

  it('generates expiry alerts via POST /inventory-batches/expiry-alerts', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '生成到期提醒' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory-batches/expiry-alerts', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path === '/inventory-batches/expiry-alerts' && options?.method === 'POST');
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ days: 30 });
    expect(await screen.findByText('到期提醒已生成')).toBeDefined();
  });

  it('loads and renders the inventory detail report on the report tab', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path === '/inventory-reports/IN') {
        return {
          type: 'IN',
          from: null,
          to: null,
          total: 2,
          items: [
            {
              id: 'r-1',
              itemName: '麻药',
              spec: '5ml',
              category: '药品',
              unit: '支',
              type: 'IN',
              quantity: 10,
              beforeStock: 0,
              afterStock: 10,
              referenceType: 'PURCHASE',
              remark: '入库备注',
              createdAt: '2026-08-01T09:30:00',
            },
          ],
          supplierId: null,
        };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '库存明细报表' }));
    expect(await screen.findByText('共 2 条')).toBeDefined();
    expect(screen.getByText('麻药')).toBeDefined();
    expect(screen.getByText('5ml')).toBeDefined();
    expect(screen.getByText('药品')).toBeDefined();
    expect(screen.getByText('入库备注')).toBeDefined();
    expect(screen.getByText('PURCHASE')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory-reports/IN');
    });
  });

  it('renders the summary report aggregates on the report tab', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/inventory-reports/')) {
        return {
          type: 'SUMMARY',
          from: null,
          to: null,
          total: 1,
          items: [
            { itemId: 'm-1', name: '树脂', spec: 'A2', category: '材料', unit: '盒', currentStock: 12, inQuantity: 5, outQuantity: 2, adjustQuantity: 1 },
          ],
          supplierId: null,
        };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '库存明细报表' }));
    await screen.findByText('共 1 条');
    fireEvent.change(screen.getByLabelText('报表类型'), { target: { value: 'SUMMARY' } });
    expect(await screen.findByText('树脂')).toBeDefined();
    expect(screen.getByText('12')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory-reports/SUMMARY');
    });
  });

  it('appends from/to date filters to the report request', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/inventory-reports/')) {
        return { type: 'IN', from: '2026-08-01', to: '2026-08-31', total: 0, items: [], supplierId: null };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '库存明细报表' }));
    fireEvent.change(screen.getByLabelText('报表开始日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('报表结束日期'), { target: { value: '2026-08-31' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory-reports/IN?from=2026-08-01&to=2026-08-31');
    });
    expect(await screen.findByText('从 2026-08-01')).toBeDefined();
    expect(screen.getByText('至 2026-08-31')).toBeDefined();
  });

  it('shows report errors on the report tab', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/inventory-reports/')) throw new Error('report failed');
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '库存明细报表' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('edits a batch via the dialog and PATCH /inventory-batches/:id', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [{ id: 's-1', name: '供应商甲' }], total: 1 };
      if (path === '/inventory-batches?itemId=i-batch') {
        return {
          batches: [
            { id: 'b-1', batchNo: 'B-001', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 10, supplierId: 's-1' },
          ],
          expiring: [],
        };
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });

    render(<InventoryPage />, { wrapper });
    await screen.findByText('B-001');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);

    expect(await screen.findByRole('dialog', { name: '编辑批次' })).toBeDefined();
    expect(screen.getByDisplayValue('B-001')).toBeDefined();
    expect(screen.getByDisplayValue('2026-07-01')).toBeDefined();
    expect(screen.getByDisplayValue('2026-09-01')).toBeDefined();
    expect((screen.getByLabelText('编辑供应商') as HTMLSelectElement).value).toBe('s-1');

    fireEvent.change(screen.getByLabelText('编辑批次号'), { target: { value: 'B-001-EDITED' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory-batches/b-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(([path, options]) => path === '/inventory-batches/b-1' && options?.method === 'PATCH');
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      batchNo: 'B-001-EDITED',
      productionDate: '2026-07-01',
      expiryDate: '2026-09-01',
      supplierId: 's-1',
    });
    expect(await screen.findByText('批次已更新')).toBeDefined();
  });

  it('deletes a batch after confirming the dialog via DELETE /inventory-batches/:id', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches?itemId=i-batch') {
        return {
          batches: [
            { id: 'b-1', batchNo: 'B-001', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 0 },
          ],
          expiring: [],
        };
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });

    render(<InventoryPage />, { wrapper });
    await screen.findByText('B-001');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);

    expect(await screen.findByText('确定删除该批次吗？')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory-batches/b-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('批次已删除')).toBeDefined();
  });
});
