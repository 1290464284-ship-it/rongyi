// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InventoryWorkflowPage } from './InventoryWorkflowPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
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
      throw new Error('apply failed');
    });

    render(<InventoryWorkflowPage />, { wrapper });
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '应用选中建议' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/inventory/replenishment/apply', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('apply failed')).toBeDefined();
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
});
