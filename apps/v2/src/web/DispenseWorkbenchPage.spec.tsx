// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DispenseWorkbenchPage } from './DispenseWorkbenchPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    if (method === 'POST' && path === '/dispenses') return { id: 'disp-9', number: 'DISP-101', status: 'PENDING' };
    if (method === 'POST' && path === '/dispenses/disp-1/dispense') return { status: 'DISPENSED' };
    if (method === 'POST' && path === '/dispenses/disp-2/return') return { status: 'PARTIAL' };
    if (method === 'POST' && path === '/narcotic-registry') return { id: 'narc-1' };
    if (path === '/dispenses') {
      return [
        { id: 'disp-1', number: 'DISP-001', patientId: 'patient-demo-001', patientName: 'Demo Patient', status: 'PENDING', itemsCount: 2, createdAt: '2026-08-01T10:00:00.000Z' },
        { id: 'disp-2', number: 'DISP-002', patientId: 'patient-demo-001', patientName: 'Demo Patient', status: 'DISPENSED', itemsCount: 1, createdAt: '2026-08-02T10:00:00.000Z' },
        { id: 'disp-3', number: 'DISP-003', patientId: 'patient-demo-001', patientName: 'Demo Patient', status: 'RETURNED', itemsCount: 1, createdAt: '2026-08-03T10:00:00.000Z' },
      ];
    }
    if (path === '/dispenses/disp-1') {
      return {
        id: 'disp-1',
        number: 'DISP-001',
        status: 'PENDING',
        items: [{ id: 'di-1', itemId: 'inventory-demo-001', batchId: null, name: 'Dental Material', spec: null, quantity: 2, returnedQuantity: 0, batchManaged: 0, stock: 90 }],
      };
    }
    if (path === '/dispenses/disp-2') {
      return {
        id: 'disp-2',
        number: 'DISP-002',
        status: 'DISPENSED',
        items: [{ id: 'di-2', itemId: 'inventory-demo-001', batchId: null, name: 'Dental Material', spec: null, quantity: 1, returnedQuantity: 0, batchManaged: 0, stock: 90 }],
      };
    }
    if (path === '/narcotic-registry') return [];
    if (path.startsWith('/inventory-batches?itemId=')) {
      return { batches: [{ id: 'batch-1', batchNo: 'B-2026', remainingQuantity: 10 }], expiring: [] };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'patient-demo-001', name: 'Demo Patient' }], total: 1, page: 1, pageSize: 100 };
    }
    if (path === '/resources/inventoryItems?page=1&pageSize=100') {
      return { items: [{ id: 'inventory-demo-001', name: 'Dental Material', batchManaged: 0 }], total: 1, page: 1, pageSize: 100 };
    }
    return {};
  });
}

describe('DispenseWorkbenchPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders the dispense list with status labels', async () => {
    mockData();
    render(<DispenseWorkbenchPage />, { wrapper });
    expect(await screen.findByText('药房工作台')).toBeDefined();
    expect(await screen.findByText('DISP-001')).toBeDefined();
    expect(screen.getByText('DISP-002')).toBeDefined();
    expect(screen.getByText('DISP-003')).toBeDefined();
    expect(screen.getByText('待发药')).toBeDefined();
    expect(screen.getByText('已发药')).toBeDefined();
    expect(screen.getByText('已退药')).toBeDefined();
  });

  it('creates a dispense order', async () => {
    mockData();
    render(<DispenseWorkbenchPage />, { wrapper });
    await screen.findByText('DISP-001');
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'patient-demo-001' } });
    fireEvent.change(screen.getByLabelText('单号'), { target: { value: 'DISP-101' } });
    await waitFor(() => {
      expect((screen.getByLabelText('物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('物品'), { target: { value: 'inventory-demo-001' } });
    fireEvent.change(screen.getByLabelText('发药数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('创建发药单'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find(
      (entry) => entry[0] === '/dispenses' && String((entry[1] as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    const body = JSON.parse(String((createCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      number: 'DISP-101',
      patientId: 'patient-demo-001',
      items: [{ itemId: 'inventory-demo-001', quantity: 2 }],
    });
    expect(await screen.findByText('发药单已创建')).toBeDefined();
  });

  it('dispenses a pending order with item batch assignment', async () => {
    mockData();
    render(<DispenseWorkbenchPage />, { wrapper });
    await screen.findByText('DISP-001');
    fireEvent.click(screen.getByText('发药'));
    await waitFor(() => {
      expect((screen.getByText('确认发药') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByText('确认发药'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses/disp-1/dispense', expect.objectContaining({ method: 'POST' }));
    });
    const dispenseCall = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/dispenses/disp-1/dispense');
    const body = JSON.parse(String((dispenseCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ items: [{ dispenseItemId: 'di-1', batchId: null }] });
    expect(await screen.findByText('发药成功')).toBeDefined();
  });

  it('returns items of a dispensed order', async () => {
    mockData();
    render(<DispenseWorkbenchPage />, { wrapper });
    await screen.findByText('DISP-002');
    fireEvent.click(screen.getByText('退药'));
    await screen.findByLabelText('退回数量');
    await waitFor(() => {
      expect((screen.getByText('确认退药') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.change(screen.getByLabelText('退回数量'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('确认退药'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses/disp-2/return', expect.objectContaining({ method: 'POST' }));
    });
    const returnCall = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/dispenses/disp-2/return');
    const body = JSON.parse(String((returnCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ items: [{ dispenseItemId: 'di-2', quantity: 1 }] });
    expect(await screen.findByText('退药成功')).toBeDefined();
  });

  it('records a narcotic entry', async () => {
    mockData();
    render(<DispenseWorkbenchPage />, { wrapper });
    await screen.findByText('DISP-001');
    fireEvent.change(screen.getByLabelText('登记日期'), { target: { value: '2026-08-06' } });
    await waitFor(() => {
      expect((screen.getByLabelText('麻药物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('麻药物品'), { target: { value: 'inventory-demo-001' } });
    fireEvent.change(screen.getByLabelText('麻药数量'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('登记'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/narcotic-registry', expect.objectContaining({ method: 'POST' }));
    });
    const narcoticCall = vi.mocked(apiRequest).mock.calls.find(
      (entry) => entry[0] === '/narcotic-registry' && String((entry[1] as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    const body = JSON.parse(String((narcoticCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ recordDate: '2026-08-06', itemId: 'inventory-demo-001', quantity: 1 });
    expect(await screen.findByText('麻药登记成功')).toBeDefined();
  });
});
