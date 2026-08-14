// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DispenseCreateForm } from './DispenseCreateForm';
import { BatchSelect, DispenseEditDialog } from './DispenseEditDialog';
import { DispenseNarcoticPanel } from './DispenseNarcoticPanel';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

const detail = {
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
      batchManaged: 1,
      stock: 90,
    },
  ],
};

function mockApi() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && path === '/dispenses') return { id: 'disp-1' };
    if (method === 'PATCH' && path === '/dispenses/disp-1') return { id: 'disp-1' };
    if (method === 'POST' && path === '/narcotic-registry') return { id: 'narc-1' };
    if (path === '/dispenses/disp-1') return detail;
    if (path.startsWith('/inventory-batches?itemId=')) {
      return { batches: [{ id: 'batch-1', batchNo: 'B-2026' }] };
    }
    if (path.startsWith('/resources/patients?')) {
      return { items: [{ id: 'patient-1', name: '李患者' }], total: 1, page: 1, pageSize: 100 };
    }
    if (path.startsWith('/resources/inventoryItems?')) {
      return { items: [{ id: 'item-1', name: '麻药', batchManaged: 1 }], total: 1, page: 1, pageSize: 100 };
    }
    if (path === '/narcotic-registry?page=1&pageSize=200') {
      return { items: [], total: 0, page: 1, pageSize: 200 };
    }
    return {};
  });
}

describe('DispenseEditDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders loading then shows the detail form and batch select for batch-managed items', async () => {
    mockApi();
    render(<DispenseEditDialog dispenseId="disp-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    expect(await screen.findByLabelText('编辑单号')).toBeDefined();
    await waitFor(() => {
      expect((screen.getByLabelText('编辑单号') as HTMLInputElement).value).toBe('DISP-001');
      expect((screen.getByLabelText('编辑批次') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
  });

  it('rejects an empty effective form before submit', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('Load failed'));
    const onClose = vi.fn();
    render(<DispenseEditDialog dispenseId="missing" onClose={onClose} onDone={vi.fn()} />, { wrapper });
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();
  });

  it('patches edited quantities and reports dropped invalid rows', async () => {
    mockApi();
    const onDone = vi.fn();
    render(<DispenseEditDialog dispenseId="disp-1" onClose={vi.fn()} onDone={onDone} />, { wrapper });
    await screen.findByLabelText('编辑单号');
    await waitFor(() => {
      expect(screen.queryByLabelText('编辑发药数量')).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText('编辑发药数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses/disp-1', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(await screen.findByText('发药单已更新')).toBeDefined();
    expect(onDone).toHaveBeenCalled();
  });

  it('requires at least one valid item before patching', async () => {
    mockApi();
    render(<DispenseEditDialog dispenseId="disp-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    await screen.findByLabelText('编辑单号');
    await waitFor(() => {
      expect(screen.queryByLabelText('编辑发药数量')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: '移除' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('请选择患者、填写单号并至少填写一条有效发药明细')).toBeDefined();
  });

  it('handles detail rows with null fields and no items', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/dispenses/disp-empty') {
        return { id: 'disp-empty', number: null, patientId: null, note: null, status: 'PENDING', items: [] };
      }
      if (path.startsWith('/resources/patients?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseEditDialog dispenseId="disp-empty" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    const numberInput = (await screen.findByLabelText('编辑单号')) as HTMLInputElement;
    expect(numberInput.value).toBe('');
    expect(screen.queryByLabelText('编辑发药数量')).toBeNull();
  });

  it('shows an error toast when the PATCH fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/dispenses/disp-1' && method === 'PATCH') throw new Error('');
      if (path === '/dispenses/disp-1') return detail;
      if (path.startsWith('/inventory-batches?itemId=')) return { batches: [] };
      if (path.startsWith('/resources/patients?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseEditDialog dispenseId="disp-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    await screen.findByLabelText('编辑单号');
    await waitFor(() => {
      expect(screen.queryByLabelText('编辑发药数量')).not.toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('更新发药单失败')).toBeDefined();
  });

  it('changes items, adds details and reports dropped invalid rows', async () => {
    mockApi();
    render(<DispenseEditDialog dispenseId="disp-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    await screen.findByLabelText('编辑单号');
    await waitFor(() => {
      expect(screen.queryByLabelText('编辑发药数量')).not.toBeNull();
    });

    fireEvent.change(screen.getByLabelText('编辑物品'), { target: { value: 'item-1' } });
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    await waitFor(() => {
      expect(screen.getAllByLabelText('编辑物品')).toHaveLength(2);
    });
    fireEvent.change(screen.getAllByLabelText('编辑物品')[1], { target: { value: 'item-1' } });
    fireEvent.change(screen.getAllByLabelText('编辑发药数量')[1], { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByText('1 条明细因数量无效将被忽略')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses/disp-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/dispenses/disp-1' && options?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body.items).toHaveLength(1);
  });

  it('cancels the edit dialog', async () => {
    mockApi();
    const onClose = vi.fn();
    render(<DispenseEditDialog dispenseId="disp-1" onClose={onClose} onDone={vi.fn()} />, { wrapper });
    await screen.findByLabelText('编辑单号');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('prefills null detail fields and hides batch select for non-batch items', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/dispenses/disp-null') {
        return {
          id: 'disp-null',
          number: null,
          patientId: null,
          note: null,
          status: 'PENDING',
          items: [{ id: 'di-1', itemId: 'item-1', batchId: null, name: '麻药', spec: null, quantity: 1, returnedQuantity: 0, batchManaged: 0, stock: 5 }],
        };
      }
      if (path.startsWith('/resources/patients?')) {
        return { items: [{ id: 'patient-1', name: '李患者' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [{ id: 'item-1', name: '麻药', batchManaged: 0 }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseEditDialog dispenseId="disp-null" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    await screen.findByLabelText('编辑单号');
    await waitFor(() => {
      expect(screen.queryByLabelText('编辑发药数量')).not.toBeNull();
    });
    expect((screen.getByLabelText('编辑单号') as HTMLInputElement).value).toBe('');
    expect(screen.queryByLabelText('编辑批次')).toBeNull();
  });

  it('renders batch ids and errors in BatchSelect', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/inventory-batches?itemId=')) {
        if (path.includes('err')) throw new Error('batches failed');
        return { batches: [{ id: 'b-1', batchNo: null }] };
      }
      return {};
    });
    const onChange = vi.fn();
    const { rerender } = render(<BatchSelect itemId="item-1" value="" onChange={onChange} ariaLabel="批次" />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('批次') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('批次') as HTMLSelectElement).textContent).toContain('b-1');
    fireEvent.change(screen.getByLabelText('批次'), { target: { value: 'b-1' } });
    expect(onChange).toHaveBeenCalledWith('b-1');

    rerender(<BatchSelect itemId="err-item" value="" onChange={onChange} ariaLabel="批次" />);
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });
});

describe('DispenseCreateForm', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('validates required patient, number and item before creating', () => {
    render(<DispenseCreateForm onCreated={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '创建发药单' }));
    expect(screen.getByText('请选择患者、填写单号并至少填写一条有效发药明细')).toBeDefined();
  });

  it('creates a dispense and resets the form', async () => {
    mockApi();
    const onCreated = vi.fn();
    render(<DispenseCreateForm onCreated={onCreated} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'patient-1' } });
    fireEvent.change(screen.getByLabelText('单号'), { target: { value: 'DISP-101' } });
    fireEvent.change(screen.getByLabelText('物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('发药数量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '创建发药单' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('发药单已创建')).toBeDefined();
    expect(onCreated).toHaveBeenCalled();
  });

  it('adds and removes detail rows', async () => {
    mockApi();
    render(<DispenseCreateForm onCreated={vi.fn()} />, { wrapper });
    expect(screen.getAllByLabelText('物品')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    expect(screen.getAllByLabelText('物品')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]);
    expect(screen.getAllByLabelText('物品')).toHaveLength(1);
  });

  it('drops invalid rows with a warning and sends batch selections', async () => {
    mockApi();
    render(<DispenseCreateForm onCreated={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'patient-1' } });
    fireEvent.change(screen.getByLabelText('单号'), { target: { value: 'DISP-102' } });
    await waitFor(() => {
      expect((screen.getByLabelText('物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('发药数量'), { target: { value: '1' } });
    await waitFor(() => {
      expect((screen.getByLabelText('批次') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('批次'), { target: { value: 'batch-1' } });
    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    await waitFor(() => {
      expect(screen.getAllByLabelText('物品')).toHaveLength(2);
    });
    fireEvent.change(screen.getAllByLabelText('物品')[1], { target: { value: 'item-1' } });
    fireEvent.change(screen.getAllByLabelText('发药数量')[1], { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '创建发药单' }));

    expect(await screen.findByText('1 条明细因数量无效将被忽略')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses', expect.objectContaining({ method: 'POST' }));
    });
    const createCall = vi.mocked(apiRequest).mock.calls.find((entry) => entry[0] === '/dispenses');
    const body = JSON.parse(String((createCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ items: [{ itemId: 'item-1', quantity: 1, batchId: 'batch-1' }] });
    expect(await screen.findByText('发药单已创建')).toBeDefined();
  });

  it('shows an error toast when creation fails', async () => {
    mockApi();
    render(<DispenseCreateForm onCreated={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'patient-1' } });
    fireEvent.change(screen.getByLabelText('单号'), { target: { value: 'DISP-103' } });
    await waitFor(() => {
      expect((screen.getByLabelText('物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('发药数量'), { target: { value: '1' } });
    vi.mocked(apiRequest).mockImplementationOnce(() => Promise.reject(new Error('')));
    fireEvent.click(screen.getByRole('button', { name: '创建发药单' }));
    expect(await screen.findByText('创建发药单失败')).toBeDefined();
  });

  it('ignores a duplicate create submit while busy', async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/dispenses') {
        return await new Promise((resolve) => { resolvePost = resolve; });
      }
      if (path.startsWith('/resources/patients?')) {
        return { items: [{ id: 'patient-1', name: '李患者' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [{ id: 'item-1', name: '麻药' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    const { container } = render(<DispenseCreateForm onCreated={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'patient-1' } });
    fireEvent.change(screen.getByLabelText('单号'), { target: { value: 'DISP-104' } });
    await waitFor(() => {
      expect((screen.getByLabelText('物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('发药数量'), { target: { value: '1' } });
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    const postCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/dispenses' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    resolvePost?.({ id: 'disp-1' });
    expect(await screen.findByText('发药单已创建')).toBeDefined();
  });

  it('treats items without a batchManaged flag as non-batch', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.startsWith('/resources/patients?')) {
        return { items: [{ id: 'patient-1', name: '李患者' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [{ id: 'item-1', name: '麻药' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseCreateForm onCreated={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('物品'), { target: { value: 'item-1' } });
    await waitFor(() => {
      expect((screen.getByLabelText('物品') as HTMLSelectElement).value).toBe('item-1');
    });
    expect(screen.queryByLabelText('批次')).toBeNull();
  });
});

describe('DispenseNarcoticPanel', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('validates the narcotic form before submitting', async () => {
    mockApi();
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('暂无麻药登记');
    fireEvent.change(screen.getByLabelText('登记日期'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '登记' }));
    expect(screen.getByText('请填写登记日期、麻药物品和有效的麻药数量')).toBeDefined();
  });

  it('submits a narcotic registration and refreshes the list', async () => {
    mockApi();
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('暂无麻药登记');
    await waitFor(() => {
      expect((screen.getByLabelText('麻药物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('登记日期'), { target: { value: '2026-08-06' } });
    fireEvent.change(screen.getByLabelText('麻药物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('麻药数量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '登记' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/narcotic-registry', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('麻药登记成功')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/narcotic-registry?page=1&pageSize=200');
    });
  });

  it('shows an error state when the registry fails to load', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/narcotic-registry?page=1&pageSize=200') throw new Error('Load failed');
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();
  });

  it('shows a truncated notice and renders registry rows', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return {
          items: [
            {
              id: 'n-1',
              recordDate: '2026-08-05',
              itemName: '麻药',
              batchNo: 'N-001',
              quantity: 1,
              usage: '局部麻醉',
              balanceBefore: 10,
              balanceAfter: 9,
            },
          ],
          total: 250,
          page: 1,
          pageSize: 200,
          truncated: true,
        };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    expect(await screen.findByText('N-001')).toBeDefined();
    expect(screen.getByText(/麻药登记超过 200 条/)).toBeDefined();
  });

  it('shows an error toast when registration fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/narcotic-registry') throw new Error('');
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [{ id: 'item-1', name: '麻药' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('暂无麻药登记');
    await waitFor(() => {
      expect((screen.getByLabelText('麻药物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('登记日期'), { target: { value: '2026-08-06' } });
    fireEvent.change(screen.getByLabelText('麻药物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('麻药数量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '登记' }));
    expect(await screen.findByText('麻药登记失败')).toBeDefined();
  });

  it('shows an error toast when deleting a registry entry fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE' && path === '/narcotic-registry/n-1') throw new Error('');
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return {
          items: [{ id: 'n-1', recordDate: '2026-08-05', itemName: '麻药', batchNo: 'N-001', quantity: 1 }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('N-001');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    expect(await screen.findByText('删除麻药登记失败')).toBeDefined();
  });

  it('validates the edit form before patching', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return {
          items: [{ id: 'n-1', recordDate: '2026-08-05', itemName: '麻药', batchNo: 'N-001', quantity: 1 }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('N-001');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByLabelText('编辑登记日期');
    fireEvent.change(screen.getByLabelText('编辑登记日期'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('请填写登记日期、麻药物品和有效的麻药数量')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/narcotic-registry/n-1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('shows an error toast when updating a registry entry fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/narcotic-registry/n-1') throw new Error('');
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return {
          items: [{ id: 'n-1', recordDate: '2026-08-05', itemId: 'item-1', itemName: '麻药', batchNo: 'N-001', quantity: 1 }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('N-001');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByLabelText('编辑登记日期');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('更新麻药登记失败')).toBeDefined();
  });

  it('cancels the edit dialog and the delete confirmation', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return {
          items: [{ id: 'n-1', recordDate: '2026-08-05', itemId: 'item-1', itemName: '麻药', batchNo: 'N-001', quantity: 1 }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      if (path.startsWith('/resources/inventoryItems?')) return { items: [], total: 0, page: 1, pageSize: 100 };
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('N-001');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByLabelText('编辑登记日期');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('编辑登记日期')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(apiRequest).not.toHaveBeenCalledWith('/narcotic-registry/n-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('submits a narcotic registration with all optional fields', async () => {
    mockApi();
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('暂无麻药登记');
    await waitFor(() => {
      expect((screen.getByLabelText('麻药物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('登记日期'), { target: { value: '2026-08-06' } });
    fireEvent.change(screen.getByLabelText('麻药物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('批号'), { target: { value: 'B-001' } });
    fireEvent.change(screen.getByLabelText('麻药数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('用途'), { target: { value: '局部麻醉' } });
    fireEvent.change(screen.getByLabelText('余量前'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('余量后'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '库存核对' } });
    fireEvent.click(screen.getByRole('button', { name: '登记' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/narcotic-registry', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/narcotic-registry');
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      recordDate: '2026-08-06',
      itemId: 'item-1',
      batchNo: 'B-001',
      quantity: 2,
      usage: '局部麻醉',
      balanceBefore: 10,
      balanceAfter: 8,
      remark: '库存核对',
    });
    expect(await screen.findByText('麻药登记成功')).toBeDefined();
  });

  it('edits a registry entry successfully with all editable fields', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/narcotic-registry/n-1') return { id: 'n-1' };
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return {
          items: [{
            id: 'n-1',
            recordDate: '2026-08-05',
            itemId: 'item-1',
            itemName: '麻药',
            batchNo: 'N-001',
            quantity: 1,
            usage: '局部麻醉',
            balanceBefore: 10,
            balanceAfter: 9,
            remark: '旧备注',
          }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [{ id: 'item-1', name: '麻药' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('N-001');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByLabelText('编辑登记日期');

    fireEvent.change(screen.getByLabelText('编辑麻药物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('编辑批号'), { target: { value: 'N-002' } });
    fireEvent.change(screen.getByLabelText('编辑用途'), { target: { value: '种植手术' } });
    fireEvent.change(screen.getByLabelText('编辑余量前'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('编辑余量后'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('编辑备注'), { target: { value: '术后核对' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/narcotic-registry/n-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/narcotic-registry/n-1' && options?.method === 'PATCH',
    );
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      recordDate: '2026-08-05',
      itemId: 'item-1',
      batchNo: 'N-002',
      quantity: 1,
      usage: '种植手术',
      balanceBefore: 9,
      balanceAfter: 8,
      remark: '术后核对',
    });
    expect(await screen.findByText('麻药登记已更新')).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByLabelText('编辑登记日期')).toBeNull();
    });
  });

  it('deletes a registry entry successfully', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE' && path === '/narcotic-registry/n-1') return { ok: true };
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return { items: [{ id: 'n-1', recordDate: '2026-08-05', itemName: '麻药', batchNo: 'N-001', quantity: 1 }], total: 1, page: 1, pageSize: 200 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('N-001');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/narcotic-registry/n-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('麻药登记已删除')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/narcotic-registry?page=1&pageSize=200');
    });
  });

  it('ignores a duplicate registration submit while busy', async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/narcotic-registry') {
        return await new Promise((resolve) => { resolvePost = resolve; });
      }
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [{ id: 'item-1', name: '麻药' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    const { container } = render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('暂无麻药登记');
    await waitFor(() => {
      expect((screen.getByLabelText('麻药物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('登记日期'), { target: { value: '2026-08-06' } });
    fireEvent.change(screen.getByLabelText('麻药物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('麻药数量'), { target: { value: '1' } });
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    const postCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/narcotic-registry' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    resolvePost?.({ id: 'narc-1' });
    expect(await screen.findByText('麻药登记成功')).toBeDefined();
  });

  it('ignores a duplicate edit submit while busy', async () => {
    let resolvePatch: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/narcotic-registry/n-1') {
        return await new Promise((resolve) => { resolvePatch = resolve; });
      }
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return {
          items: [{ id: 'n-1', recordDate: '2026-08-05', itemId: 'item-1', itemName: '麻药', batchNo: 'N-001', quantity: 1 }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      if (path.startsWith('/resources/inventoryItems?')) {
        return { items: [{ id: 'item-1', name: '麻药' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    const { container } = render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('N-001');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByLabelText('编辑登记日期');
    const forms = container.querySelectorAll('form');
    const dialogForm = forms[forms.length - 1];
    fireEvent.submit(dialogForm);
    fireEvent.submit(dialogForm);

    const patchCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/narcotic-registry/n-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    resolvePatch?.({ id: 'n-1' });
    expect(await screen.findByText('麻药登记已更新')).toBeDefined();
  });
});
