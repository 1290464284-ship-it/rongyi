// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router';
import { InventoryPage } from './InventoryPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
  </MemoryRouter>
);

describe('InventoryPage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it('shows truncation notices when low stock or expiring exceed the cap', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [], total: 0 };
      }
      if (path === '/inventory/low-stock') {
        return { items: [{ id: 'l1', name: 'Low', stock: 1, minStock: 2 }], truncated: true };
      }
      if (path === '/inventory/expiring?days=30') {
        return { items: [], truncated: false };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('低库存超过 100 条，仅显示前 100 条')).toBeDefined();
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

  it('does not submit transactions while the inventory list is stale', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [], total: 30, page: 1, pageSize: 20 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByLabelText('库存项目 ID');
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    fireEvent.change(screen.getByLabelText('库存项目 ID'), { target: { value: 'item-new' } });
    fireEvent.change(screen.getByDisplayValue('IN'), { target: { value: 'OUT' } });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    const form = screen.getByRole('button', { name: '保存库存流水' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/inventory/transactions' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    )).toHaveLength(0);

    // 批次表单同样在 stale 阶段被守卫拦截（fireEvent.submit 可绕过 disabled 提交按钮）
    const batchForm = screen.getByRole('button', { name: '新增批次' }).closest('form');
    expect(batchForm).not.toBeNull();
    fireEvent.submit(batchForm as HTMLFormElement);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/inventory-batches' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    )).toHaveLength(0);
  });

  it('clears the item id when paging the inventory list', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [], total: 30, page: 1, pageSize: 20 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });
    render(<InventoryPage />, { wrapper });
    const input = await screen.findByLabelText('库存项目 ID') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'old-item' } });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect((screen.getByLabelText('库存项目 ID') as HTMLInputElement).value).toBe('');
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

  it('shows a truncated notice on the detail report', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path === '/inventory-reports/IN') {
        return { type: 'IN', from: null, to: null, total: 3, items: [{ id: 'r-1', itemName: '材料' }], supplierId: null, truncated: true };
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '库存明细报表' }));
    expect(await screen.findByText(/仅显示前/)).toBeDefined();
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

  it('validates item id and quantity before saving a transaction', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '保存库存流水' }));
    expect(await screen.findByText('请填写库存项目 ID')).toBeDefined();

    fireEvent.change(screen.getByLabelText('库存项目 ID'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '保存库存流水' }));
    expect(await screen.findByText('请输入有效的库存数量')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/inventory/transactions', expect.objectContaining({ method: 'POST' }));
  });

  it('validates batch submission inputs', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '新增批次' }));
    expect(await screen.findByText('请先填写库存项目 ID')).toBeDefined();

    fireEvent.change(screen.getByLabelText('库存项目 ID'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByLabelText('入库数量'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '新增批次' }));
    expect(await screen.findByText('请输入有效的入库数量')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/inventory-batches', expect.objectContaining({ method: 'POST' }));
  });

  it('locates items by barcode and reports missing matches', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/inventoryItems?page=1&pageSize=20&search=')) {
        const search = new URL(path, 'http://localhost').searchParams.get('search');
        if (search === 'BC-1') {
          return { items: [{ id: 'i-bc', name: '条码物品', barcode: 'BC-1', code: 'C-1' }], total: 1 };
        }
        return { items: [], total: 0 };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    await screen.findByText('库存管理');
    fireEvent.change(screen.getByLabelText('条码扫码'), { target: { value: 'BC-1' } });
    fireEvent.click(screen.getByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('已定位：条码物品')).toBeDefined();
    expect((screen.getByLabelText('库存项目 ID') as HTMLInputElement).value).toBe('i-bc');

    fireEvent.change(screen.getByLabelText('条码扫码'), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('未找到匹配的库存项目')).toBeDefined();
  });

  it('shows the barcode dialog and validates empty barcode search', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-bc', name: '条码物品', barcode: 'BC-1', code: 'C-1' }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('请输入条码或编码')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '条码' }));
    expect(await screen.findByRole('dialog', { name: '条码标签：条码物品' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '条码标签：条码物品' })).toBeNull();
    });
  });

  it('shows loading and retry states for the main queries', async () => {
    let resolveList!: (value: unknown) => void;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return new Promise((resolve) => {
          resolveList = resolve;
        });
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });
    render(<InventoryPage />, { wrapper });
    expect(screen.getByText('库存数据加载中...')).toBeDefined();
    resolveList({ items: [], total: 0 });
    expect(await screen.findByText('库存管理')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') throw new Error('Load failed');
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });
    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('reports batch and alert failures with fallback messages', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path.startsWith('/inventory-batches')) {
        const method = String(init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && path === '/inventory-batches') throw new Error('');
        if (method === 'POST' && path === '/inventory-batches/expiry-alerts') throw new Error('');
        return { batches: [], expiring: [] };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('库存项目 ID'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByLabelText('入库数量'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '新增批次' }));
    expect(await screen.findByText('批次入库失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '生成到期提醒' }));
    expect(await screen.findByText('生成到期提醒失败')).toBeDefined();
  });

  it('reports batch edit and delete failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches?itemId=i-batch') {
        return {
          batches: [
            { id: 'b-1', batchNo: 'B-001', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 10 },
          ],
          expiring: [],
        };
      }
      if (path.startsWith('/inventory-batches')) {
        const method = String(init?.method ?? 'GET').toUpperCase();
        if (method === 'PATCH' && path === '/inventory-batches/b-1') throw new Error('');
        if (method === 'DELETE' && path === '/inventory-batches/b-1') throw new Error('');
        return { batches: [], expiring: [] };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    await screen.findByText('B-001');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    await screen.findByRole('dialog', { name: '编辑批次' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('批次更新失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '编辑批次' })).toBeNull();
    });
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: '确认' }));
    expect(await screen.findByText('删除批次失败')).toBeDefined();
  });

  it('shows the expiring truncation notice independently of low stock', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return { items: [], truncated: false };
      if (path === '/inventory/expiring?days=30') {
        return { items: [{ id: 'e1', name: '临期', expireDate: '2026-08-12', stock: 2 }], truncated: true };
      }
      return {};
    });

    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('临期项目超过 100 条，仅显示前 100 条')).toBeDefined();
  });

  it('falls back to the code when opening a barcode label without a name', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-9', code: 'CODE-9', stock: 1, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '条码' }));
    expect(await screen.findByRole('dialog', { name: '条码标签：CODE-9' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  });

  it('edits a batch row with missing optional fields using blank fallbacks', async () => {
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
            { id: 'b-9', batchNo: null, productionDate: null, expiryDate: null, initialQuantity: 10, remainingQuantity: 10, supplierId: null },
          ],
          expiring: [],
        };
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });

    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    await screen.findByRole('dialog', { name: '编辑批次' });
    expect((screen.getByLabelText('编辑批次号') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('编辑生产日期') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('编辑效期日期') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('编辑供应商') as HTMLSelectElement).value).toBe('');
  });

  it('retries the main queries from the error state', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') throw new Error('Load failed');
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });
    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('库存管理')).toBeDefined();
  });

  it('matches barcode searches by code and reports scan failures', async () => {
    let failScan = false;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/inventoryItems?page=1&pageSize=20&search=')) {
        if (failScan) throw 'scan failed';
        return { items: [{ id: 'i-c', code: 'C-9', name: null }], total: 1 };
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByText('库存管理');

    fireEvent.change(screen.getByLabelText('条码扫码'), { target: { value: 'C-9' } });
    fireEvent.click(screen.getByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('已定位：C-9')).toBeDefined();
    expect((screen.getByLabelText('库存项目 ID') as HTMLInputElement).value).toBe('i-c');

    failScan = true;
    fireEvent.change(screen.getByLabelText('条码扫码'), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('扫码定位失败')).toBeDefined();
  });

  it('locates an item by code when the barcode field is missing', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/inventoryItems?page=1&pageSize=20&search=')) {
        return { items: [{ id: 'i-code', code: 'CODE-X', name: '编码材料' }], total: 1 };
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByText('库存管理');
    fireEvent.change(screen.getByLabelText('条码扫码'), { target: { value: 'CODE-X' } });
    fireEvent.click(screen.getByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('已定位：编码材料')).toBeDefined();
  });

  it('switches back to the overview tab after viewing the report', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/inventory-reports/')) {
        return { type: 'IN', from: null, to: null, total: 0, items: [], supplierId: null };
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('tab', { name: '库存明细报表' }));
    await screen.findByText('暂无报表数据');
    fireEvent.click(screen.getByRole('tab', { name: '库存概览' }));
    expect(screen.getByText('低库存')).toBeDefined();
  });

  it('closes the barcode and edit-batch dialogs through the dialog close path', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-1', name: 'Item', barcode: 'BC-1', stock: 1, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches?itemId=i-1') {
        return { batches: [{ id: 'b-1', batchNo: 'B-1', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 10 }], expiring: [] };
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByText('Item');

    fireEvent.click(screen.getByRole('button', { name: '条码' }));
    expect(await screen.findByRole('dialog', { name: '条码标签：Item' })).toBeDefined();
    vi.useFakeTimers();
    fireEvent.keyDown(document.querySelector('.modal')!, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('dialog', { name: '条码标签：Item' })).toBeNull();
    vi.useRealTimers();

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    expect(await screen.findByRole('dialog', { name: '编辑批次' })).toBeDefined();
    vi.useFakeTimers();
    fireEvent.keyDown(document.querySelector('.modal')!, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('dialog', { name: '编辑批次' })).toBeNull();
    vi.useRealTimers();
  });

  it('renders sparse expiring and batch rows with blank fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-1', name: 'Item', stock: 1, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') {
        return { items: [{ id: 'e1', name: null, code: null, expireDate: null, stock: null }], total: 1 };
      }
      if (path === '/inventory-batches?itemId=i-1') {
        return {
          batches: [{ id: 'b-1', batchNo: null, productionDate: null, expiryDate: null, initialQuantity: null, remainingQuantity: null }],
          expiring: [],
        };
      }
      if (path === '/inventory-batches?days=30') {
        return {
          batches: [],
          expiring: [{ id: 'eb-1', itemName: null, itemCode: null, batchNo: null, expiryDate: null, remainingQuantity: null }],
        };
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('Item')).toBeDefined();
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(5);
  });

  it('renders string load errors through the String fallback', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') throw 'boom';
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });
    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('edits batch dates through the dialog inputs', async () => {
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
            { id: 'b-1', batchNo: 'B-001', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 10 },
          ],
          expiring: [],
        };
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });
    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    await screen.findByRole('dialog', { name: '编辑批次' });
    fireEvent.change(screen.getByLabelText('编辑生产日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('编辑效期日期'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        ([path, options]) => path === '/inventory-batches/b-1' && (options as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String((patchCall?.[1] as RequestInit)?.body))).toMatchObject({
        productionDate: '2026-08-01',
        expiryDate: '2026-10-01',
      });
    });
  });

  it('cancels the delete-batch confirmation through the dialog close path', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches?itemId=i-batch') {
        return { batches: [{ id: 'b-1', batchNo: 'B-001', initialQuantity: 10, remainingQuantity: 10 }], expiring: [] };
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });
    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    expect(await screen.findByRole('dialog', { name: '删除确认' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '删除确认' })).toBeNull();
    });
    expect(apiRequest).not.toHaveBeenCalledWith('/inventory-batches/b-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('handles barcode searches without items and without display fields', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/inventoryItems?page=1&pageSize=20&search=')) {
        const search = new URL(path, 'http://localhost').searchParams.get('search');
        if (search === 'EMPTY') return {};
        return { items: [{ id: 'i-x', name: null, code: null, barcode: 'X-1' }], total: 1 };
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByText('库存管理');

    fireEvent.change(screen.getByLabelText('条码扫码'), { target: { value: 'EMPTY' } });
    fireEvent.click(screen.getByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('未找到匹配的库存项目')).toBeDefined();

    fireEvent.change(screen.getByLabelText('条码扫码'), { target: { value: 'X-1' } });
    fireEvent.click(screen.getByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('已定位：')).toBeDefined();
    expect((screen.getByLabelText('库存项目 ID') as HTMLInputElement).value).toBe('i-x');
  });

  it('ignores a second transaction submit while one is pending', async () => {
    let resolveTransaction: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path === '/inventory/transactions' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return await new Promise((resolve) => { resolveTransaction = resolve; });
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByText('库存管理');
    fireEvent.change(screen.getByLabelText('库存项目 ID'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    const submit = screen.getByRole('button', { name: '保存库存流水' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/inventory/transactions')).toHaveLength(1);
    resolveTransaction?.({ id: 'tx-1' });
  });

  it('ignores a second expiry alert request while one is pending', async () => {
    let resolveAlerts: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path === '/inventory-batches/expiry-alerts' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return await new Promise((resolve) => { resolveAlerts = resolve; });
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    const button = await screen.findByRole('button', { name: '生成到期提醒' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/inventory-batches/expiry-alerts')).toHaveLength(1);
    resolveAlerts?.({ ok: true });
  });

  it('ignores duplicate batch edit submits and closes the dialog on success', async () => {
    let resolvePatch: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches?itemId=i-batch') {
        return {
          batches: [{ id: 'b-1', batchNo: 'B-001', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 10 }],
          expiring: [],
        };
      }
      if (path === '/inventory-batches/b-1' && String(init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        return await new Promise((resolve) => { resolvePatch = resolve; });
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const save = await screen.findByRole('button', { name: '保存' });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(apiRequest).toHaveBeenCalledWith('/inventory-batches/b-1', expect.objectContaining({ method: 'PATCH' }));
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/inventory-batches/b-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
    )).toHaveLength(1);
    resolvePatch?.({ id: 'b-1' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '编辑批次' })).toBeNull();
    });
  });

  it('ignores a duplicate batch delete confirmation while one is pending', async () => {
    let resolveDelete: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches?itemId=i-batch') {
        return {
          batches: [{ id: 'b-1', batchNo: 'B-001', productionDate: '2026-07-01', expiryDate: '2026-09-01', initialQuantity: 10, remainingQuantity: 10 }],
          expiring: [],
        };
      }
      if (path === '/inventory-batches/b-1' && String(init?.method ?? 'GET').toUpperCase() === 'DELETE') {
        return await new Promise((resolve) => { resolveDelete = resolve; });
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    const confirm = await screen.findByRole('button', { name: '确认' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/inventory-batches/b-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'DELETE',
    )).toHaveLength(1);
    resolveDelete?.({ ok: true });
  });

  it('renders truncated notices when list payloads omit items arrays', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [] };
      if (path === '/inventory/low-stock') return { truncated: true };
      if (path === '/inventory/expiring?days=30') return { truncated: true };
      return {};
    });
    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('低库存超过 100 条，仅显示前 100 条')).toBeDefined();
    expect(screen.getByText('临期项目超过 100 条，仅显示前 100 条')).toBeDefined();
  });

  it('moves between inventory tabs with arrow keys', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/inventory-reports/')) {
        return { type: 'IN', from: null, to: null, total: 0, items: [], supplierId: null };
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    const overviewTab = await screen.findByRole('tab', { name: '库存概览' });
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '库存明细报表' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: '库存明细报表' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: '库存概览' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(overviewTab, { key: 'Enter' });
    expect(screen.getByRole('tab', { name: '库存概览' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: '库存明细报表' }), { key: 'Enter' });
    expect(screen.getByRole('tab', { name: '库存明细报表' }).getAttribute('aria-selected')).toBe('false');
  });

  it('updates the item id when the URL id changes', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      return {};
    });
    function UrlChangeHarness() {
      const navigate = useNavigate();
      return (
        <div>
          <button onClick={() => navigate('/inventory?id=url-new')}>go-url</button>
          <InventoryPage />
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={['/inventory?id=url-old']}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <UrlChangeHarness />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('url-old')).toBeDefined();
    fireEvent.click(screen.getByText('go-url'));
    expect(await screen.findByDisplayValue('url-new')).toBeDefined();
  });

  it('renders batch rows with missing quantity fields as blank', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-1', name: '材料', stock: 1, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path === '/inventory-batches?itemId=i-1') {
        return {
          batches: [{ id: 'b-1', batchNo: 'B-1', initialQuantity: null, remainingQuantity: null }],
          expiring: [],
        };
      }
      if (path === '/inventory-batches?days=30') return { batches: [], expiring: [] };
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      return {};
    });
    render(<InventoryPage />, { wrapper });
    expect(await screen.findByText('批次管理')).toBeDefined();
    expect(await screen.findByText('B-1')).toBeDefined();
  });

  it('ignores a second replenishment request while one is pending', async () => {
    let resolveReplenish: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path === '/inventory/replenishment/generate' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return await new Promise((resolve) => { resolveReplenish = resolve; });
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    const button = await screen.findByRole('button', { name: '生成补货建议' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/inventory/replenishment/generate')).toHaveLength(1);
    resolveReplenish?.({ ok: true });
  });

  it('ignores replenishment while a transaction is still pending', async () => {
    let resolveTransaction: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path === '/inventory/transactions' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return await new Promise((resolve) => { resolveTransaction = resolve; });
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('库存项目 ID'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存库存流水' }));
    await screen.findByRole('button', { name: '保存中...' });
    fireEvent.click(screen.getByRole('button', { name: '生成补货建议' }));
    expect(vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/inventory/replenishment/generate')).toHaveLength(0);
    resolveTransaction?.({ id: 'tx-1' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '保存中...' })).toBeNull();
    });
  });

  it('ignores a second batch submit while one is pending', async () => {
    let resolveBatch: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return await new Promise((resolve) => { resolveBatch = resolve; });
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByDisplayValue('i-batch');
    fireEvent.change(screen.getByLabelText('入库数量'), { target: { value: '8' } });
    const button = screen.getByRole('button', { name: '新增批次' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/inventory-batches' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    )).toHaveLength(1);
    resolveBatch?.({ id: 'b-new' });
  });

  it('ignores a batch edit submit while a previous edit is pending', async () => {
    let resolvePatch: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches?itemId=i-batch') {
        return { batches: [{ id: 'b-1', batchNo: 'B-001', initialQuantity: 10, remainingQuantity: 10 }], expiring: [] };
      }
      if (path === '/inventory-batches/b-1' && String(init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        return await new Promise((resolve) => { resolvePatch = resolve; });
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });
    render(<InventoryPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    await screen.findByRole('dialog', { name: '编辑批次' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByRole('button', { name: '保存中...' });
    const form = screen.getByRole('button', { name: '保存中...' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/inventory-batches/b-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
    )).toHaveLength(1);
    resolvePatch?.({ id: 'b-1' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '编辑批次' })).toBeNull();
    });
  });

  it('ignores a batch delete confirmation while a transaction is pending', async () => {
    let resolveTransaction: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') {
        return { items: [{ id: 'i-batch', name: 'Batch Material', stock: 10, minStock: 1 }], total: 1 };
      }
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/suppliers')) return { items: [], total: 0 };
      if (path === '/inventory-batches?itemId=i-batch') {
        return { batches: [{ id: 'b-1', batchNo: 'B-001', initialQuantity: 10, remainingQuantity: 10 }], expiring: [] };
      }
      if (path === '/inventory/transactions' && String(init?.method ?? 'GET').toUpperCase() === 'POST') {
        return await new Promise((resolve) => { resolveTransaction = resolve; });
      }
      if (path.startsWith('/inventory-batches')) return { batches: [], expiring: [] };
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByText('B-001');
    fireEvent.change(screen.getByLabelText('库存项目 ID'), { target: { value: 'i-batch' } });
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存库存流水' }));
    await screen.findByRole('button', { name: '保存中...' });
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: '确认' }));
    expect(vi.mocked(apiRequest).mock.calls.filter(([path, options]) =>
      path === '/inventory-batches/b-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'DELETE',
    )).toHaveLength(0);
    resolveTransaction?.({ id: 'tx-1' });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '保存中...' })).toBeNull();
    });
  });

  it('misses barcode matches when only the code is missing', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/inventoryItems?page=1&pageSize=20') return { items: [], total: 0 };
      if (path === '/inventory/low-stock') return [];
      if (path === '/inventory/expiring?days=30') return [];
      if (path.startsWith('/resources/inventoryItems?page=1&pageSize=20&search=')) {
        return { items: [{ id: 'i-x', barcode: 'BC-9', code: null }], total: 1 };
      }
      return {};
    });
    render(<InventoryPage />, { wrapper });
    await screen.findByText('库存管理');
    fireEvent.change(screen.getByLabelText('条码扫码'), { target: { value: 'ZZ-9' } });
    fireEvent.click(screen.getByRole('button', { name: '扫码定位' }));
    expect(await screen.findByText('未找到匹配的库存项目')).toBeDefined();
  });
});
