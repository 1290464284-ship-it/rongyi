// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { DispenseListPanel } from './DispenseListPanel';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';
import type { Page } from '../lib/types';
import type { DispenseRow } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function queryResult(overrides: Partial<UseQueryResult<Page<DispenseRow>, Error>> = {}): UseQueryResult<Page<DispenseRow>, Error> {
  const page: Page<DispenseRow> = { items: [], total: 0, page: 1, pageSize: 20 };
  return {
    isLoading: false,
    error: null,
    data: page,
    refetch: vi.fn().mockResolvedValue({ data: page }),
    ...overrides,
  } as unknown as UseQueryResult<Page<DispenseRow>, Error>;
}

const rows: DispenseRow[] = [
  {
    id: 'disp-1',
    number: 'DISP-001',
    patientName: '张三',
    status: 'PENDING',
    itemsCount: 2,
    createdAt: '2026-08-01T10:00:00.000Z',
  },
  {
    id: 'disp-2',
    number: 'DISP-002',
    patientName: '李四',
    status: 'PARTIAL',
    itemsCount: 1,
    createdAt: '2026-08-02T10:00:00.000Z',
  },
  {
    id: 'disp-3',
    number: 'DISP-003',
    patientName: '王五',
    status: 'DISPENSED',
    itemsCount: 1,
    createdAt: '2026-08-03T10:00:00.000Z',
  },
  {
    id: 'disp-4',
    number: 'DISP-004',
    patientName: '赵六',
    status: 'RETURNED',
    itemsCount: 1,
    createdAt: '2026-08-04T10:00:00.000Z',
  },
];

const returnRow: DispenseRow = {
  id: 'disp-1',
  number: 'DISP-001',
  patientName: '王五',
  status: 'DISPENSED',
  itemsCount: 1,
  createdAt: '2026-08-03T10:00:00.000Z',
};

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'disp-1',
    number: 'DISP-001',
    patientId: 'patient-1',
    note: '',
    status: 'PENDING',
    items: [
      {
        id: 'di-1',
        itemId: 'item-1',
        batchId: null,
        name: '麻药',
        spec: null,
        quantity: 2,
        returnedQuantity: 0,
        batchManaged: 0,
        stock: 90,
      },
    ],
    ...overrides,
  };
}

function mockApi(detail?: Record<string, unknown>) {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'DELETE' && path === '/dispenses/disp-1') return { id: 'disp-1', deleted: true };
    if (method === 'POST' && path === '/dispenses/disp-1/dispense') return { status: 'DISPENSED' };
    if (method === 'POST' && path === '/dispenses/disp-1/return') return { status: 'RETURNED' };
    if (method === 'PATCH' && path === '/dispenses/disp-1') return { id: 'disp-1' };
    if (path === '/dispenses/disp-1') return detail ?? detailRow();
    if (path.startsWith('/inventory-batches?itemId=')) {
      return { batches: [{ id: 'batch-1', batchNo: 'B-2026', remainingQuantity: 10 }] };
    }
    if (path.startsWith('/resources/patients?')) {
      return { items: [{ id: 'patient-1', name: '张三' }], total: 1, page: 1, pageSize: 100 };
    }
    if (path.startsWith('/resources/inventoryItems?')) {
      return { items: [{ id: 'item-1', name: '麻药', batchManaged: 0 }], total: 1, page: 1, pageSize: 100 };
    }
    return {};
  });
}

describe('DispenseListPanel', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders loading, error and empty states', () => {
    const { rerender } = render(
      <DispenseListPanel dispenses={queryResult({ isLoading: true })} dispensePage={1} setDispensePage={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByText('加载发药单...')).toBeDefined();

    rerender(
      <DispenseListPanel
        dispenses={queryResult({ error: new Error('Load failed') })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
    );
    expect(screen.getByText('网络请求失败，请重试')).toBeDefined();

    rerender(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: [], total: 0, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
    );
    expect(screen.getByText('暂无发药单')).toBeDefined();
  });

  it('renders an empty list when the query data is undefined', () => {
    render(
      <DispenseListPanel dispenses={queryResult({ data: undefined as never })} dispensePage={1} setDispensePage={vi.fn()} />,
      { wrapper },
    );
    expect(screen.getByText('暂无发药单')).toBeDefined();
  });

  it('renders status-specific action buttons', () => {
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows, total: 4, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getAllByText('发药')).toHaveLength(2);
    expect(screen.getAllByText('退药')).toHaveLength(2);
    expect(screen.getAllByText('编辑')).toHaveLength(1);
    expect(screen.getAllByText('删除')).toHaveLength(1);
  });

  it('closes the action panel when the page changes', () => {
    const setDispensePage = vi.fn();
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 21, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={setDispensePage}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '发药' }));
    expect(screen.getByText(/发药：DISP-001/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.queryByText(/发药：DISP-001/)).toBeNull();
    expect(setDispensePage).toHaveBeenCalledTimes(1);
  });

  it('opens the edit dialog from a pending row', async () => {
    mockApi();
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(await screen.findByLabelText('编辑单号')).toBeDefined();
  });

  it('deletes a pending dispense and steps back on an emptied page', async () => {
    mockApi();
    const refetch = vi.fn().mockResolvedValue({ data: { items: [], total: 0, page: 2, pageSize: 20 } });
    const setDispensePage = vi.fn();
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 21, page: 2, pageSize: 20 }, refetch })}
        dispensePage={2}
        setDispensePage={setDispensePage}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(await screen.findByText('发药单已删除')).toBeDefined();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(setDispensePage).toHaveBeenCalledWith(expect.any(Function));
    const calls = setDispensePage.mock.calls;
    const updater = calls[calls.length - 1][0] as (value: number) => number;
    expect(updater(2)).toBe(1);
  });

  it('shows an error toast when delete fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE' && path === '/dispenses/disp-1') throw new Error('');
      return {};
    });
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(await screen.findByText('删除发药单失败')).toBeDefined();
  });

  it('dispenses a pending order for non-batch items', async () => {
    mockApi();
    const refetch = vi.fn().mockResolvedValue({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 } });
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 }, refetch })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '发药' }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认发药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认发药' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses/disp-1/dispense', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('发药成功')).toBeDefined();
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认发药' })).toBeNull());
  });

  it('requires a batch for batch-managed items before dispensing', async () => {
    mockApi(
      detailRow({
        items: [
          {
            id: 'di-1',
            itemId: 'item-1',
            batchId: null,
            name: '麻药',
            spec: null,
            quantity: 2,
            returnedQuantity: 0,
            batchManaged: 1,
            stock: 90,
          },
        ],
      }),
    );
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '发药' }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认发药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认发药' }));
    expect(await screen.findByText('请为批次管理物品选择批次')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/dispenses/disp-1/dispense', expect.objectContaining({ method: 'POST' }));
  });

  it('dispenses batch-managed items after selecting a batch', async () => {
    mockApi(
      detailRow({
        items: [
          {
            id: 'di-1',
            itemId: 'item-1',
            batchId: null,
            name: '麻药',
            spec: null,
            quantity: 2,
            returnedQuantity: 0,
            batchManaged: 1,
            stock: 90,
          },
        ],
      }),
    );
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '发药' }));
    const batchSelect = (await screen.findByLabelText('发药批次')) as HTMLSelectElement;
    await waitFor(() => {
      expect(batchSelect.options.length).toBeGreaterThan(1);
    });
    fireEvent.change(batchSelect, { target: { value: 'batch-1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认发药' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses/disp-1/dispense', expect.objectContaining({ method: 'POST' }));
    });
    const dispenseCall = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/dispenses/disp-1/dispense');
    const body = JSON.parse(String((dispenseCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ items: [{ dispenseItemId: 'di-1', batchId: 'batch-1' }] });
  });

  it('shows an error toast when dispense fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/dispenses/disp-1/dispense') throw new Error('');
      if (path === '/dispenses/disp-1') return detailRow();
      return {};
    });
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '发药' }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认发药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认发药' }));
    expect(await screen.findByText('发药失败')).toBeDefined();
  });

  it('returns a dispensed order with a partial status message', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/dispenses/disp-1/return') return { status: 'PARTIAL' };
      if (path === '/dispenses/disp-1') return detailRow({ status: 'DISPENSED' });
      return {};
    });
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: [returnRow], total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '退药' }));
    const input = (await screen.findByLabelText('退回数量')) as HTMLInputElement;
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认退药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退药' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses/disp-1/return', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('退药成功')).toBeDefined();
  });

  it('requires a return quantity', async () => {
    mockApi();
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: [returnRow], total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '退药' }));
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认退药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认退药' }));
    expect(await screen.findByText('请填写退回数量')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/dispenses/disp-1/return', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects a return quantity above the pending quantity', async () => {
    mockApi(detailRow({
      status: 'DISPENSED',
      items: [
        {
          id: 'di-1',
          itemId: 'item-1',
          batchId: null,
          name: '麻药',
          spec: null,
          quantity: 5,
          returnedQuantity: 3,
          batchManaged: 0,
          stock: 90,
        },
      ],
    }));
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: [returnRow], total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '退药' }));
    const input = (await screen.findByLabelText('退回数量')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退药' }));
    expect(await screen.findByText('退回数量不能超过未退数量')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/dispenses/disp-1/return', expect.objectContaining({ method: 'POST' }));
  });

  it('shows an error toast when return fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/dispenses/disp-1/return') throw new Error('');
      if (path === '/dispenses/disp-1') return detailRow({ status: 'DISPENSED' });
      return {};
    });
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: [returnRow], total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '退药' }));
    const input = (await screen.findByLabelText('退回数量')) as HTMLInputElement;
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认退药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退药' }));
    expect(await screen.findByText('退药失败')).toBeDefined();
  });

  it('shows an error when the action detail fails to load', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/dispenses/disp-1') throw new Error('Load failed');
      return {};
    });
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '发药' }));
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();
  });

  it('falls back for sparse rows and renders unknown statuses verbatim', () => {
    const sparseRows: DispenseRow[] = [
      { id: 'x-1', number: 'X-1', patientName: null, patientId: 'p-9', status: null, createdAt: null },
      { id: 'x-2', number: 'X-2', status: 'UNKNOWN', itemsCount: undefined },
      { id: 'x-3', number: 'X-3', patientId: null, status: 'PENDING', itemsCount: 3 },
    ];
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: sparseRows, total: 3, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText('p-9')).toBeDefined();
    expect(screen.getByText('UNKNOWN')).toBeDefined();
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.getByText('X-3')).toBeDefined();
    expect(screen.getAllByRole('button', { name: '编辑' })).toHaveLength(1);
  });

  it('uses the default batch and renders item specs in the dispense panel', async () => {
    mockApi(
      detailRow({
        items: [
          {
            id: 'di-1',
            itemId: 'item-1',
            batchId: 'batch-1',
            name: '麻药',
            spec: '5ml',
            quantity: 2,
            returnedQuantity: 0,
            batchManaged: 1,
            stock: 90,
          },
        ],
      }),
    );
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '发药' }));
    expect(await screen.findByText('麻药（5ml）')).toBeDefined();
    const batchSelect = (await screen.findByLabelText('发药批次')) as HTMLSelectElement;
    expect(batchSelect.value).toBe('batch-1');
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认发药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认发药' }));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/dispenses/disp-1/dispense');
      expect(call).toBeDefined();
      expect(JSON.parse(String((call?.[1] as RequestInit)?.body))).toMatchObject({
        items: [{ dispenseItemId: 'di-1', batchId: 'batch-1' }],
      });
    });
  });

  it('shows a full return message when the order is returned completely', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/dispenses/disp-1/return') return { status: 'RETURNED' };
      if (path === '/dispenses/disp-1') return detailRow({ status: 'DISPENSED' });
      return {};
    });
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: [returnRow], total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '退药' }));
    const input = (await screen.findByLabelText('退回数量')) as HTMLInputElement;
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认退药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退药' }));
    expect(await screen.findByText('已全部退药')).toBeDefined();
  });

  it('enables the next page when more rows remain', () => {
    const setDispensePage = vi.fn();
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: rows.slice(0, 1), total: 21, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={setDispensePage}
      />,
      { wrapper },
    );
    const next = screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(setDispensePage).toHaveBeenCalledWith(2);
  });

  it('renders blank patient cells when both name and id are missing', () => {
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: [{ id: 'x-4', number: 'X-4', status: 'PENDING', itemsCount: 1 }], total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText('X-4')).toBeDefined();
  });

  it('renders action details with missing item names and quantities', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/dispenses/disp-1') {
        return detailRow({
          status: 'DISPENSED',
          items: [
            { id: 'di-1', itemId: 'item-1', batchId: null, name: null, spec: null, batchManaged: 0, stock: 90 },
          ],
        });
      }
      if (method === 'POST' && path === '/dispenses/disp-1/return') return { status: 'PARTIAL' };
      return {};
    });
    render(
      <DispenseListPanel
        dispenses={queryResult({ data: { items: [returnRow], total: 1, page: 1, pageSize: 20 } })}
        dispensePage={1}
        setDispensePage={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '退药' }));
    const input = (await screen.findByLabelText('退回数量')) as HTMLInputElement;
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '确认退药' }) as HTMLButtonElement).disabled).toBe(false);
    });
    expect(input.max).toBe('0');
    expect(screen.getByText('0')).toBeDefined();
  });
});
