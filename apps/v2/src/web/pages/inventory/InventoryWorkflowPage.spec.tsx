// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InventoryWorkflowPage } from './InventoryWorkflowPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('InventoryWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('applies selected replenishment suggestions', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') {
        return { items: [{ id: 'po-1', status: 'PENDING', totalAmount: 150 }], total: 1 };
      }
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') {
        return {
          items: [
            { id: 'pi-1', orderId: 'po-1', name: 'Dental Material', quantity: 2, unitPrice: 100, subtotal: 200 },
            { id: 'pi-2', orderId: null, name: null, quantity: null, unitPrice: null, subtotal: null },
          ],
          total: 2,
        };
      }
      if (path === '/resources/processingOrders?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') {
        return { items: [{ id: 's-1', inventoryId: 'item-1', rop: 5, suggestedQty: 3, status: 'OPEN' }], total: 1 };
      }
      return {};
    });

    render(<InventoryWorkflowPage />, { wrapper });
    expect(await screen.findByText('Dental Material')).toBeDefined();
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '应用选中建议' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory/replenishment/apply', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  it('generates suggestions and transitions processing orders', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/processingOrders?page=1&pageSize=100') {
        return { items: [{ id: 'proc-1', status: 'DRAFT' }], total: 1 };
      }
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      return {};
    });

    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '生成补货建议' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory/replenishment/generate', expect.objectContaining({ method: 'POST' }));
    });

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'SENT' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/processing-orders/proc-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('reports replenishment apply failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/processingOrders?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') {
        return { items: [{ id: 's-2', inventoryId: 'item-2', rop: 5, suggestedQty: 3, status: 'OPEN' }], total: 1 };
      }
      if (path === '/stocktakes?page=1&pageSize=200') {
        return { items: [], total: 0 };
      }
      throw new Error('apply failed');
    });

    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '应用选中建议' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory/replenishment/apply', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('uses a generic message for non-error workflow failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/processingOrders?page=1&pageSize=100') {
        return { items: [], total: 0 };
      }
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') {
        return { items: [{ id: 's-3', inventoryId: 'item-3', rop: 5, suggestedQty: 3, status: 'OPEN' }], total: 1 };
      }
      throw 'boom';
    });

    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '应用选中建议' }));
    expect(await screen.findByText('操作失败')).toBeDefined();
  });

  it('renders stocktake list with status labels and per-status actions', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return {
          items: [
            { id: 'st-1', number: 'PD-001', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 2, differenceCount: 0 },
            { id: 'st-2', number: 'PD-002', status: 'LOCKED', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 3, differenceCount: 1 },
            { id: 'st-3', number: 'PD-003', status: 'COMPLETED', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', completedById: 'user-1', completedAt: '2026-08-05T12:00:00.000Z', itemCount: 2, differenceCount: 0 },
            { id: 'st-4', number: 'PD-004', status: 'CANCELLED', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 1, differenceCount: 0 },
          ],
          total: 4,
        };
      }
      return {};
    });

    render(<InventoryWorkflowPage />, { wrapper });
    expect(await screen.findByText('PD-001')).toBeDefined();
    expect(screen.getByText('PD-002')).toBeDefined();
    expect(screen.getByText('PD-003')).toBeDefined();
    expect(screen.getByText('PD-004')).toBeDefined();
    expect(screen.getByText('进行中')).toBeDefined();
    expect(screen.getByText('已锁定')).toBeDefined();
    expect(screen.getByText('已完成')).toBeDefined();
    expect(screen.getByText('已取消')).toBeDefined();
    expect(screen.getByRole('button', { name: '录入' })).toBeDefined();
    expect(screen.getByRole('button', { name: '完成盘点' })).toBeDefined();
    expect(screen.getAllByRole('button', { name: '锁定' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '取消' })).toHaveLength(2);
  });

  it('creates a stocktake from the form', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') return { items: [], total: 0 };
      return {};
    });

    render(<InventoryWorkflowPage />, { wrapper });
    await screen.findByText('库存盘点');
    fireEvent.change(screen.getByLabelText('盘点单号'), { target: { value: 'PD-NEW-1' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '月末盘点' } });
    fireEvent.click(screen.getByRole('button', { name: '开始盘点' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/stocktakes', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ number: 'PD-NEW-1', note: '月末盘点' }),
      }));
    });
  });

  it('expands a stocktake and records counted stock per item', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return { items: [{ id: 'st-1', number: 'PD-001', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 2, differenceCount: 0 }], total: 1 };
      }
      if (path === '/stocktakes/st-1/items') {
        return [
          { id: 'sti-1', itemId: 'item-x', name: '物品X', code: 'X-1', systemStock: 10, countedStock: null, difference: 0 },
          { id: 'sti-2', itemId: 'item-y', name: '物品Y', code: 'Y-1', systemStock: 5, countedStock: null, difference: 0 },
        ];
      }
      return {};
    });

    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '录入' }));
    expect(await screen.findByText('物品X')).toBeDefined();
    expect(screen.getByText('物品Y')).toBeDefined();

    const inputs = screen.getAllByLabelText('实盘数量');
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: '12' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/stocktakes/st-1/items/item-x', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ countedStock: 12 }),
      }));
    });
  });

  it('triggers lock, complete and cancel APIs by status', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return {
          items: [
            { id: 'st-2', number: 'PD-002', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 2, differenceCount: 0 },
            { id: 'st-3', number: 'PD-003', status: 'LOCKED', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 2, differenceCount: 1 },
          ],
          total: 2,
        };
      }
      return {};
    });

    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '锁定' }));
    fireEvent.click(screen.getByRole('button', { name: '完成盘点' }));

    // busy 守卫：等待锁定请求完成后再操作同一行的取消按钮
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/stocktakes/st-2/lock', expect.objectContaining({ method: 'POST' }));
      expect(apiRequest).toHaveBeenCalledWith('/stocktakes/st-3/complete', expect.objectContaining({ method: 'POST' }));
    });

    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[0]);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/stocktakes/st-2/cancel', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('receives pending purchase orders and guards duplicate clicks', async () => {
    let resolveReceive: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') {
        return { items: [{ id: 'po-1', number: 'PO-1', status: 'PENDING', totalAmount: 150 }], total: 1 };
      }
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') return { items: [], total: 0 };
      if (method === 'PATCH' && path === '/purchase-orders/po-1/receive') {
        return await new Promise((resolve) => { resolveReceive = resolve; });
      }
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '收货' }));
    expect(screen.getByRole('button', { name: '收货中...' })).toBeDefined();
    resolveReceive?.({ received: true });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/purchase-orders/po-1/receive', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('applies nothing when no suggestion is selected and unchecks a selection', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') {
        return { items: [{ id: 's-1', inventoryId: 'item-1', rop: 5, suggestedQty: 3, status: 'OPEN' }], total: 1 };
      }
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(screen.getByRole('button', { name: '应用选中建议' }));
    expect(apiRequest).not.toHaveBeenCalledWith('/inventory/replenishment/apply', expect.anything());

    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: '应用选中建议' }));
    expect(apiRequest).not.toHaveBeenCalledWith('/inventory/replenishment/apply', expect.anything());
  });

  it('validates stocktake input and reports save failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return { items: [{ id: 'st-1', number: 'PD-001', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 1, differenceCount: 0 }], total: 1 };
      }
      if (path === '/stocktakes/st-1/items') {
        return [{ id: 'sti-1', itemId: 'item-x', name: '物品X', code: 'X-1', systemStock: 10, countedStock: null, difference: 0 }];
      }
      if (method === 'PATCH' && path === '/stocktakes/st-1/items/item-x') throw new Error('save failed');
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '录入' }));
    const input = await screen.findByLabelText('实盘数量');
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('录入数量必须是非负整数')).toBeDefined();

    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('requires a stocktake number and cancels locked stocktakes', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return {
          items: [
            { id: 'st-1', number: 'PD-001', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 1, differenceCount: 0 },
            { id: 'st-2', number: 'PD-002', status: 'LOCKED', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 1, differenceCount: 0 },
          ],
          total: 2,
        };
      }
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '开始盘点' }));
    expect(await screen.findByText('请填写盘点单号')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/stocktakes', expect.objectContaining({ method: 'POST' }));

    const cancelButtons = screen.getAllByRole('button', { name: '取消' });
    fireEvent.click(cancelButtons[1]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/stocktakes/st-2/cancel', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('renders sparse rows with fallbacks and unknown statuses', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') {
        return { items: [{ id: 'po-9', status: 'PENDING' }], total: 1 };
      }
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') {
        return { items: [{ id: 'pi-9', orderId: null, name: null, quantity: null, unitPrice: null, subtotal: null }], total: 1 };
      }
      if (path === '/resources/processingOrders?page=1&pageSize=100') {
        return { items: [{ id: 'proc-9', status: 'WEIRD' }], total: 1 };
      }
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') {
        return { items: [{ id: 's-9', inventoryId: null, rop: null, suggestedQty: null, status: 'OPEN' }], total: 1 };
      }
      if (path === '/stocktakes?page=1&pageSize=200') {
        return { items: [{ id: 'st-9', status: 'WEIRD' }], total: 1 };
      }
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    expect(await screen.findByText('po-9')).toBeDefined();
    expect(screen.getAllByText('WEIRD').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('checkbox')).toBeDefined();
    expect(screen.queryByRole('button', { name: '录入' })).toBeNull();
  });

  it('transitions processing orders through every status option', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') {
        return { items: [{ id: 'proc-1', status: 'DRAFT' }], total: 1 };
      }
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') return { items: [], total: 0 };
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    const select = await screen.findByRole('combobox');
    for (const status of ['IN_PROGRESS', 'COMPLETED', 'RECEIVED']) {
      fireEvent.change(select, { target: { value: status } });
      await waitFor(() => {
        expect(apiRequest).toHaveBeenCalledWith(
          '/processing-orders/proc-1/status',
          expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status }) }),
        );
      });
    }
  });

  it('validates empty counted stock and saves with fallback columns', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return {
          items: [{ id: 'st-1', number: null, status: 'IN_PROGRESS', startedById: null, startedAt: null, itemCount: null, differenceCount: null }],
          total: 1,
        };
      }
      if (path === '/stocktakes/st-1/items') {
        return [{ id: 'sti-1', itemId: 'item-x', name: null, code: null, systemStock: null, countedStock: null, difference: null }];
      }
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '录入' }));
    const input = await screen.findByLabelText('实盘数量');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('录入数量必须是非负整数')).toBeDefined();
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/stocktakes/st-1/items/item-x', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('reports stocktake action failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return {
          items: [{ id: 'st-1', number: 'PD-001', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 1, differenceCount: 0 }],
          total: 1,
        };
      }
      if (method === 'POST' && path === '/stocktakes/st-1/lock') throw new Error('');
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '锁定' }));
    expect(await screen.findByText('操作失败')).toBeDefined();
  });

  it('shows the truncated stocktake notice and existing counted stock fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') {
        return { items: [{ id: 'po-2', number: 'PO-2', supplierId: 'sup-1', status: 'PENDING', totalAmount: 150 }], total: 1 };
      }
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return {
          items: [
            { id: 'st-1', number: 'PD-001', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 1, differenceCount: 0 },
            { id: 'st-2', number: 'PD-002', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 1, differenceCount: 0 },
          ],
          total: 3,
          pageSize: 200,
          truncated: true,
        };
      }
      if (path === '/stocktakes/st-1/items') {
        return [
          { id: 'sti-1', itemId: 'item-x', name: '物料X', code: 'X-1', systemStock: 10, countedStock: 7, difference: 0 },
        ];
      }
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    expect(await screen.findByText('sup-1')).toBeDefined();
    expect(await screen.findByText('盘点单超过 200 条，仅显示前 2 条')).toBeDefined();

    fireEvent.click(screen.getAllByRole('button', { name: '录入' })[0]);
    const input = (await screen.findByLabelText('实盘数量')) as HTMLInputElement;
    expect(input.value).toBe('7');
  });

  it('includes null-status suggestions as open and applies them', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') {
        return {
          items: [
            { id: 's-1', inventoryId: null, rop: 3, suggestedQty: 2, status: null },
            { id: 's-2', inventoryId: 'item-2', rop: 4, suggestedQty: 1, status: 'OPEN' },
          ],
          total: 2,
        };
      }
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    const checkboxes = await screen.findAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole('button', { name: '应用选中建议' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory/replenishment/apply', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['s-1'] }),
      }));
    });
  });

  it('collapses an expanded stocktake and shows stocktake load errors', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') {
        return {
          items: [{ id: 'st-1', number: 'PD-001', status: 'IN_PROGRESS', startedById: 'user-1', startedAt: '2026-08-05T10:00:00.000Z', itemCount: 1, differenceCount: 0 }],
          total: 1,
        };
      }
      if (path === '/stocktakes/st-1/items') {
        return [{ id: 'sti-1', itemId: 'item-x', name: '物品X', code: 'X-1', systemStock: 10, countedStock: null, difference: 0 }];
      }
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '录入' }));
    expect(await screen.findByLabelText('实盘数量')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByLabelText('实盘数量')).toBeNull();
  });

  it('shows stocktake list errors without crashing', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') throw new Error('stocktake list failed');
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('creates a stocktake without a note', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 0 };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') return { items: [], total: 0 };
      if (path === '/stocktakes?page=1&pageSize=200') return { items: [], total: 0 };
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    await screen.findByText('库存盘点');
    fireEvent.change(screen.getByLabelText('盘点单号'), { target: { value: 'PD-NO-NOTE' } });
    fireEvent.click(screen.getByRole('button', { name: '开始盘点' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/stocktakes', expect.objectContaining({
        method: 'POST',
      }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/stocktakes');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ number: 'PD-NO-NOTE' });
  });

  it('shows truncated notices for purchase, processing, and suggestions panels', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/purchaseOrders?page=1&pageSize=100') return { items: [], total: 0, truncated: true };
      if (path === '/resources/purchaseOrderItems?page=1&pageSize=200') return { items: [], total: 1, truncated: true };
      if (path === '/resources/processingOrders?page=1&pageSize=100') return { items: [], total: 0, truncated: true };
      if (path === '/resources/inventoryReplenishmentSuggestions?page=1&pageSize=100') {
        return { items: [], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/stocktakes?page=1&pageSize=200') return { items: [], total: 0 };
      return {};
    });
    render(<InventoryWorkflowPage />, { wrapper });
    await screen.findByText('库存盘点');
    expect(await screen.findByText('采购单超过 100 条，仅显示部分数据')).toBeDefined();
    expect(screen.getByText('采购明细超过 200 条，仅显示部分数据')).toBeDefined();
    expect(screen.getByText('加工单超过 100 条，仅显示部分数据')).toBeDefined();
    expect(screen.getByText('补货建议超过 100 条，仅显示部分数据')).toBeDefined();
  });
});
