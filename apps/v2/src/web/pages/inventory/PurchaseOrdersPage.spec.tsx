// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => {
  const apiRequest = vi.fn();
  return {
    apiRequest,
    fetchAllPages: vi.fn(async (path: string) => {
      const data = await apiRequest(`${path}&page=1&pageSize=100`);
      return data?.items ?? [];
    }),
  };
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockRows(rows: Array<Record<string, unknown>>, stats?: Record<string, unknown>) {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/purchase-orders/review-stats') {
      return stats ?? {};
    }
    if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
      return { items: rows, total: rows.length, page: 1, pageSize: 50 };
    }
    if (path === '/resources/suppliers?page=1&pageSize=100') {
      return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/resources/inventoryItems?page=1&pageSize=100') {
      return { items: [{ id: 'i-1', name: '耗材' }], total: 1, page: 1, pageSize: 200 };
    }
    return {};
  });
}

function mockData(status = 'PENDING', reviewStatus = 'APPROVED') {
  mockRows([{ id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status, reviewStatus }]);
}

describe('PurchaseOrdersPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
    vi.restoreAllMocks();
  });

  it('creates and receives purchase orders', async () => {
    mockData();
    render(<PurchaseOrdersPage />, { wrapper });
    expect(await screen.findByText('PO-1')).toBeDefined();

    fireEvent.click(screen.getByText('新建采购单'));
    await waitFor(() => {
      expect((screen.getByLabelText('采购项目') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('采购单号'), { target: { value: 'PO-NEW' } });
    fireEvent.change(screen.getByLabelText('供应商'), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText('采购项目'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByLabelText('采购数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('采购单价'), { target: { value: '100' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'po-new' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/purchase-orders');
    const createBody = JSON.parse(String(createCall?.[1]?.body));
    expect(createBody.items[0]).toMatchObject({ itemId: 'i-1', name: '耗材', quantity: 2, unitPrice: 10000 });
    expect(createBody.supplierId).toBe('s-1');
    expect(createBody.number).toBe('PO-NEW');
    expect(await screen.findByText('采购单已创建')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '收货' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders/po-1/receive', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText('采购单已收货')).toBeDefined();
  });

  it('validates required purchase fields', async () => {
    mockData();
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByText('新建采购单'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请填写采购单号并至少添加一条有效明细')).toBeDefined();
  });

  it('disables the receive button for non-pending orders', async () => {
    mockData('RECEIVED');
    render(<PurchaseOrdersPage />, { wrapper });
    expect(await screen.findByText('PO-1')).toBeDefined();
    expect((screen.getByRole('button', { name: '收货' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders review status labels, rejection reason and summary bar', async () => {
    mockRows(
      [
        { id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status: 'PENDING', reviewStatus: 'PENDING' },
        { id: 'po-2', number: 'PO-2', supplierId: 's-1', totalAmount: 300, status: 'PENDING', reviewStatus: 'SUBMITTED' },
        { id: 'po-3', number: 'PO-3', supplierId: 's-1', totalAmount: 400, status: 'PENDING', reviewStatus: 'APPROVED' },
        { id: 'po-4', number: 'PO-4', supplierId: 's-1', totalAmount: 500, status: 'PENDING', reviewStatus: 'REJECTED', rejectionReason: '价格过高' },
      ],
      { total: 4, pending: 1, submitted: 2, approved: 3, rejected: 4, pendingAmount: 600 },
    );
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    expect(screen.getByText('待提交')).toBeDefined();
    expect(screen.getByText('待审核')).toBeDefined();
    expect(screen.getByText('已通过')).toBeDefined();
    expect(screen.getByText('已驳回')).toBeDefined();
    expect(screen.getByText('价格过高')).toBeDefined();
    expect(await screen.findByText('待审核 2 单')).toBeDefined();
    expect(await screen.findByText('待收货 3 单')).toBeDefined();
  });

  it('submits a pending order for review', async () => {
    mockData('PENDING', 'PENDING');
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders/po-1/submit', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('已提交审核')).toBeDefined();
  });

  it('approves a submitted order', async () => {
    mockData('PENDING', 'SUBMITTED');
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '通过' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders/po-1/approve', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('已通过审核')).toBeDefined();
  });

  it('rejects a submitted order with a prompt reason', async () => {
    mockData('PENDING', 'SUBMITTED');
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    fireEvent.change(screen.getByPlaceholderText('驳回原因'), { target: { value: '单价过高' } });
    fireEvent.click(screen.getByText('确认驳回'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/purchase-orders/po-1/reject',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: '单价过高' }) }),
      );
    });
    expect(await screen.findByText('已驳回')).toBeDefined();
  });

  it('skips rejection when the dialog is cancelled and rejects empty reason', async () => {
    mockData('PENDING', 'SUBMITTED');
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');

    // 取消：关闭对话框且不发起请求
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiRequest).not.toHaveBeenCalledWith('/purchase-orders/po-1/reject', expect.anything());

    // 空原因：提示必填且不发起请求，对话框保持打开
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    fireEvent.click(screen.getByText('确认驳回'));
    expect(await screen.findByText('驳回原因必填')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/purchase-orders/po-1/reject', expect.anything());
  });

  it('reopens a rejected order', async () => {
    mockRows([{ id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status: 'PENDING', reviewStatus: 'REJECTED', rejectionReason: '价格过高' }]);
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '重新提交' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders/po-1/reopen', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('已重新提交')).toBeDefined();
  });

  it('disables the receive button when reviewStatus is not APPROVED', async () => {
    mockData('PENDING', 'PENDING');
    render(<PurchaseOrdersPage />, { wrapper });
    expect(await screen.findByText('PO-1')).toBeDefined();
    expect((screen.getByRole('button', { name: '收货' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('edits a purchase order: prefills the form, PATCHes the order and reconciles items', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/review-stats') {
        return {};
      }
      if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
        return {
          items: [{ id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status: 'PENDING' }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/suppliers?page=1&pageSize=100') {
        return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [{ id: 'i-1', name: '耗材' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/purchaseOrderItems?orderId=po-1&page=1&pageSize=100') {
        return {
          items: [{ id: 'poi-1', itemId: 'i-1', name: '耗材', spec: 'S', quantity: 3, unitPrice: 10000, subtotal: 30000 }],
          total: 1,
          page: 1,
          pageSize: 100,
        };
      }
      return {};
    });


    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');


    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('采购单号') as HTMLInputElement).value).toBe('PO-1');
    });
    await waitFor(() => {
      expect((screen.getByLabelText('供应商') as HTMLSelectElement).value).toBe('s-1');
    });
    // 明细异步回填
    await waitFor(() => {
      expect((screen.getByLabelText('采购项目') as HTMLSelectElement).value).toBe('i-1');
    });
    expect((screen.getByLabelText('采购数量') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('采购单价') as HTMLInputElement).value).toBe('100.00');
    fireEvent.click(screen.getByText('保存'));


    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/purchaseOrders/po-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/resources/purchaseOrders/po-1' && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      number: 'PO-1',
      supplierId: 's-1',
      totalAmount: 30000,
      status: 'PENDING',
    });
    const itemPatchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/resources/purchaseOrderItems/poi-1' && options?.method === 'PATCH',
    );
    expect(JSON.parse(String(itemPatchCall?.[1]?.body))).toMatchObject({
      itemId: 'i-1',
      name: '耗材',
      spec: 'S',
      quantity: 3,
      unitPrice: 10000,
      subtotal: 30000,
    });
    expect(await screen.findByText('采购单已更新')).toBeDefined();
  });

  it('edits a sparse purchase order row with null supplier and status', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/review-stats') return {};
      if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
        return {
          items: [{ id: 'po-sparse', number: 'PO-SPARSE', supplierId: null, totalAmount: 100, status: null }],
          total: 1, page: 1, pageSize: 50,
        };
      }
      if (path === '/resources/suppliers?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [{ id: 'i-1', name: '耗材' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/purchaseOrderItems?orderId=po-sparse&page=1&pageSize=100') {
        return {
          items: [{ id: 'poi-1', itemId: 'i-1', name: '耗材', spec: 'S', quantity: 1, unitPrice: 100, subtotal: 100 }],
          total: 1, page: 1, pageSize: 100,
        };
      }
      return {};
    });

    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-SPARSE');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('采购项目') as HTMLSelectElement).value).toBe('i-1');
    });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/purchaseOrders/po-sparse', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/resources/purchaseOrders/po-sparse' && options?.method === 'PATCH',
    );
    const body = JSON.parse(String(patchCall?.[1]?.body)) as Record<string, unknown>;
    expect(body.supplierId).toBeUndefined();
    expect(body.status).toBe('');
    expect(body.number).toBe('PO-SPARSE');
  });

  it('blocks saving while edit detail rows are still loading', async () => {
    let resolveItems: (value: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/review-stats') return {};
      if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
        return {
          items: [{ id: 'po-load', number: 'PO-LOAD', supplierId: 's-1', totalAmount: 200, status: 'PENDING' }],
          total: 1, page: 1, pageSize: 50,
        };
      }
      if (path === '/resources/suppliers?page=1&pageSize=100') {
        return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/resources/purchaseOrderItems?orderId=po-load&page=1&pageSize=100') {
        return new Promise((resolve) => { resolveItems = resolve; });
      }
      return {};
    });

    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-LOAD');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('明细加载中，请稍候再保存')).toBeDefined();
    resolveItems({ items: [], total: 0, page: 1, pageSize: 100 });
  });

  it('deletes a purchase order after confirmation', async () => {    mockData();
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/purchaseOrders/po-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('采购单已删除')).toBeDefined();
  });
  it('shows a placeholder in the review summary bar while stats are loading', async () => {
    let resolveStats: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/review-stats') {
        return await new Promise((resolve) => { resolveStats = resolve; });
      }
      if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
        return { items: [{ id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status: 'PENDING' }], total: 1, page: 1, pageSize: 50 };
      }
      return {};
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    // L3：首屏加载中显示占位符，不显示「0 单」误导
    expect(screen.getByText('待审核 —')).toBeDefined();
    expect(screen.getByText('待收货 —')).toBeDefined();
    resolveStats?.({ submitted: 2, approved: 3 });
    expect(await screen.findByText('待审核 2 单')).toBeDefined();
    expect(await screen.findByText('待收货 3 单')).toBeDefined();
  });

  it('locks the item editor while edit backfill is loading', async () => {
    let resolveItems: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/review-stats') return {};
      if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
        return { items: [{ id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status: 'PENDING' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/suppliers?page=1&pageSize=100') {
        return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [{ id: 'i-1', name: '耗材' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/purchaseOrderItems?orderId=po-1&page=1&pageSize=100') {
        return await new Promise((resolve) => { resolveItems = resolve; });
      }
      return {};
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    // L2：回填未完成前隐藏明细编辑区并禁用添加按钮，避免整表覆盖用户输入
    expect(screen.getByText('明细加载中...')).toBeDefined();
    expect(screen.queryByLabelText('采购项目')).toBeNull();
    expect((screen.getByRole('button', { name: '添加明细' }) as HTMLButtonElement).disabled).toBe(true);
    resolveItems?.({ items: [{ id: 'poi-1', itemId: 'i-1', name: '耗材', spec: 'S', quantity: 3, unitPrice: 10000, subtotal: 30000 }], total: 1, page: 1, pageSize: 100 });
    await waitFor(() => {
      expect((screen.getByLabelText('采购项目') as HTMLSelectElement).value).toBe('i-1');
    });
    expect((screen.getByRole('button', { name: '添加明细' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports create failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/purchase-orders' && String(init?.method ?? 'GET').toUpperCase() === 'POST') throw new Error('');
      return base?.(path, init);
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByText('新建采购单'));
    await waitFor(() => {
      expect((screen.getByLabelText('采购项目') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('采购单号'), { target: { value: 'PO-NEW' } });
    fireEvent.change(screen.getByLabelText('采购项目'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByLabelText('采购数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('采购单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('创建采购单失败')).toBeDefined();
  });

  it('reports receive failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/purchase-orders/po-1/receive' && String(init?.method ?? 'GET').toUpperCase() === 'PATCH') throw new Error('');
      return base?.(path, init);
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '收货' }));
    expect(await screen.findByText('收货失败')).toBeDefined();
  });

  it('reports review action failures', async () => {
    mockData('PENDING', 'PENDING');
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/purchase-orders/po-1/submit' && String(init?.method ?? 'GET').toUpperCase() === 'POST') throw new Error('');
      return base?.(path, init);
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('reports delete failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/resources/purchaseOrders/po-1' && String(init?.method ?? 'GET').toUpperCase() === 'DELETE') throw new Error('');
      return base?.(path, init);
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByText('确认删除'));
    expect(await screen.findByText('删除采购单失败')).toBeDefined();
  });

  it('reports update failure with the partial-save hint', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/purchase-orders/review-stats') return {};
      if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
        return { items: [{ id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status: 'PENDING' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/suppliers?page=1&pageSize=100') {
        return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [{ id: 'i-1', name: '耗材' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/purchaseOrderItems?orderId=po-1&page=1&pageSize=100') {
        return { items: [{ id: 'poi-1', itemId: 'i-1', name: '耗材', spec: 'S', quantity: 3, unitPrice: 10000, subtotal: 30000 }], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/resources/purchaseOrders/po-1' && String(init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        throw new Error('');
      }
      return {};
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => {
      expect((screen.getByLabelText('采购单号') as HTMLInputElement).value).toBe('PO-1');
    });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('更新采购单失败；部分明细可能未保存，请核对后重试')).toBeDefined();
  });

  it('warns about dropped invalid detail rows', async () => {
    mockData();
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByText('新建采购单'));
    await waitFor(() => {
      expect((screen.getByLabelText('采购项目') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('采购单号'), { target: { value: 'PO-NEW' } });
    fireEvent.change(screen.getByLabelText('采购项目'), { target: { value: 'i-1' } });
    fireEvent.change(screen.getByLabelText('采购数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('采购单价'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    await waitFor(() => {
      expect(screen.getAllByLabelText('采购项目')).toHaveLength(2);
    });
    fireEvent.change(screen.getAllByLabelText('采购项目')[1], { target: { value: 'i-1' } });
    fireEvent.change(screen.getAllByLabelText('采购数量')[1], { target: { value: '' } });
    fireEvent.change(screen.getAllByLabelText('采购单价')[1], { target: { value: '100' } });
    fireEvent.click(screen.getByText('保存'));

    expect(await screen.findByText('1 条明细因数量或单价无效将被忽略')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/purchase-orders');
    const body = JSON.parse(String(createCall?.[1]?.body));
    expect(body.items).toHaveLength(1);
  });

  it('reports approve and reopen failures', async () => {
    mockData('PENDING', 'SUBMITTED');
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/purchase-orders/po-1/approve' && String(init?.method ?? 'GET').toUpperCase() === 'POST') throw new Error('');
      return base?.(path, init);
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '通过' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    cleanup();
    mockRows([
      { id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status: 'PENDING', reviewStatus: 'REJECTED', rejectionReason: '价格过高' },
    ]);
    const base2 = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/purchase-orders/po-1/reopen' && String(init?.method ?? 'GET').toUpperCase() === 'POST') throw new Error('');
      return base2?.(path, init);
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '重新提交' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('ignores a stale item backfill after closing the edit dialog', async () => {
    let resolveItems: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/review-stats') return {};
      if (path === '/resources/purchaseOrders?page=1&pageSize=50') {
        return { items: [{ id: 'po-1', number: 'PO-1', supplierId: 's-1', totalAmount: 200, status: 'PENDING' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/suppliers?page=1&pageSize=100') {
        return { items: [{ id: 's-1', name: '供应商甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [{ id: 'i-1', name: '耗材' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/purchaseOrderItems?orderId=po-1&page=1&pageSize=100') {
        return await new Promise((resolve) => { resolveItems = resolve; });
      }
      return {};
    });
    render(<PurchaseOrdersPage />, { wrapper });
    await screen.findByText('PO-1');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    resolveItems?.({ items: [{ id: 'poi-1', itemId: 'i-1', name: '耗材', quantity: 1, unitPrice: 10000, subtotal: 10000 }], total: 1, page: 1, pageSize: 100 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
