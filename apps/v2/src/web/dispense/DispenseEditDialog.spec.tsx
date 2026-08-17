// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BatchSelect, DispenseEditDialog } from './DispenseEditDialog';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';
import type { DispenseDetail } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const detail: DispenseDetail = {
  id: 'd-1',
  number: 'D-1',
  patientId: 'p-1',
  note: '发药备注',
  items: [
    { id: 'li-1', itemId: 'item-1', quantity: 2, batchId: 'b-1' },
    { id: '', itemId: 'item-2', quantity: 3, batchId: ' ' },
  ],
};

function mockData(customDetail: DispenseDetail = detail) {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/dispenses/d-1') return customDetail;
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 };
    }
    if (path === '/resources/inventoryItems?page=1&pageSize=100') {
      return {
        items: [
          { id: 'item-1', name: '药品甲', batchManaged: 1 },
          { id: 'item-2', name: '药品乙', batchManaged: 0 },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
      };
    }
    if (path === '/inventory-batches?itemId=item-1') {
      return { batches: [{ id: 'b-1', batchNo: 'B-001' }, { id: 'b-2', batchNo: 'B-002' }] };
    }
    return {};
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('DispenseEditDialog', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('shows a loading state while the detail is pending', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    expect(screen.getByText('加载发药单...')).toBeDefined();
  });

  it('shows an error state when the detail request fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue('detail failed');
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    expect(await screen.findByText('加载发药单失败')).toBeDefined();
  });

  it('prefills the form and submits an updated dispense with server item ids', async () => {
    mockData();
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    expect(await screen.findByDisplayValue('D-1')).toBeDefined();
    expect(screen.getByDisplayValue('发药备注')).toBeDefined();

    fireEvent.change(screen.getByLabelText('编辑单号'), { target: { value: 'D-1-EDITED' } });
    fireEvent.change(screen.getByLabelText('编辑发药备注'), { target: { value: '新备注' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/dispenses/d-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/dispenses/d-1' && (options as RequestInit)?.method === 'PATCH',
    );
    expect(JSON.parse(String((patchCall?.[1] as RequestInit)?.body))).toEqual({
      number: 'D-1-EDITED',
      patientId: 'p-1',
      note: '新备注',
      items: [
        { id: 'li-1', itemId: 'item-1', quantity: 2, batchId: 'b-1' },
        { itemId: 'item-2', quantity: 3 },
      ],
    });
    expect(await screen.findByText('发药单已更新')).toBeDefined();
  });

  it('changes the patient and submits the updated dispense', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/dispenses/d-1') return detail;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }, { id: 'p-2', name: '患者乙' }], total: 2, page: 1, pageSize: 100 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [{ id: 'item-1', name: '药品甲', batchManaged: 1 }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('编辑患者') as HTMLSelectElement).options.length).toBeGreaterThan(2);
    });
    fireEvent.change(screen.getByLabelText('编辑患者'), { target: { value: 'p-2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        ([path, options]) => path === '/dispenses/d-1' && (options as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String((patchCall?.[1] as RequestInit)?.body)).patientId).toBe('p-2');
    });
  });

  it('drops invalid quantities and warns before submitting', async () => {
    mockData({
      ...detail,
      items: [
        { id: 'li-1', itemId: 'item-1', quantity: 2, batchId: 'b-1' },
        { id: 'li-2', itemId: 'item-2', quantity: 0, batchId: '' },
      ],
    });
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('编辑患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    const dialog = screen.getByRole('dialog', { name: '编辑发药单' });
    fireEvent.submit(dialog.querySelector('form')!);

    await waitFor(() => {
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        ([path, options]) => path === '/dispenses/d-1' && (options as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String((patchCall?.[1] as RequestInit)?.body)).items).toEqual([
        { id: 'li-1', itemId: 'item-1', quantity: 2, batchId: 'b-1' },
      ]);
    });
    expect(await screen.findByText('1 条明细因数量无效将被忽略')).toBeDefined();
  });

  it('requires a patient, number and at least one valid item', async () => {
    mockData({
      ...detail,
      number: '',
      items: [{ id: '', itemId: '', quantity: 1, batchId: '' }],
    });
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('请选择患者、填写单号并至少填写一条有效发药明细')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/dispenses/d-1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('removes and adds detail rows', async () => {
    mockData();
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    await screen.findByDisplayValue('D-1');
    expect(screen.getAllByLabelText('编辑物品')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0]);
    expect(screen.getAllByLabelText('编辑物品')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '添加明细' }));
    expect(screen.getAllByLabelText('编辑物品')).toHaveLength(2);
  });

  it('shows the batch selector for batch-managed items and submits the selected batch', async () => {
    mockData();
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    const batchSelect = await screen.findByLabelText('编辑批次');
    await waitFor(() => {
      expect(Array.from((batchSelect as HTMLSelectElement).options).map((option) => option.value)).toContain('b-2');
    });

    fireEvent.change(batchSelect, { target: { value: 'b-2' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        ([path, options]) => path === '/dispenses/d-1' && (options as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
      expect(body.items.find((item: { id: string }) => item.id === 'li-1').batchId).toBe('b-2');
    });
  });

  it('reports update failures as a toast', async () => {
    mockData();
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('编辑患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    vi.mocked(apiRequest).mockRejectedValueOnce('patch failed');
    fireEvent.click(await screen.findByRole('button', { name: '保存修改' }));
    expect(await screen.findByText('更新发药单失败')).toBeDefined();
  });

  it('prefills sparse detail rows with blank and zero fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/dispenses/disp-9') {
        return {
          id: 'disp-9',
          number: 'D-9',
          patientId: null,
          note: null,
          items: [{ id: 'i9', itemId: null, quantity: null, batchId: null }],
        };
      }
      if (path.startsWith('/resources/patients?')) {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseEditDialog dispenseId="disp-9" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    expect((await screen.findByLabelText('编辑发药数量') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('编辑单号') as HTMLInputElement).value).toBe('D-9');
  });

  it('renders zero item rows when the detail omits items', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/dispenses/disp-empty') {
        return { id: 'disp-empty', number: 'D-E', patientId: 'p-1', note: null };
      }
      if (path.startsWith('/resources/patients?')) {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseEditDialog dispenseId="disp-empty" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    expect(await screen.findByDisplayValue('D-E')).toBeDefined();
    expect(screen.queryAllByLabelText('编辑物品')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '添加明细' })).toBeDefined();
  });

  it('ignores a submit while stale', async () => {
    mockData();
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} stale />, { wrapper });
    await waitFor(() => {
      expect((screen.getByLabelText('编辑患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    const dialog = screen.getByRole('dialog', { name: '编辑发药单' });
    fireEvent.submit(dialog.querySelector('form')!);
    expect(apiRequest).not.toHaveBeenCalledWith('/dispenses/d-1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('treats items without a batchManaged flag as non-batch-managed', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/dispenses/d-1') {
        return { ...detail, items: [{ id: 'li-1', itemId: 'item-1', quantity: 2, batchId: 'b-1' }] };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 100 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [{ id: 'item-1', name: '药品甲' }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseEditDialog dispenseId="d-1" onClose={vi.fn()} onDone={vi.fn()} />, { wrapper });
    // 等物品下拉加载出真实选项（药品甲）再断言：value 非空时 MissingSelectOption
    // 会先渲染占位 option（文本为 id），不能以 options.length 判断加载完成。
    await waitFor(() => {
      expect(screen.getByRole('option', { name: '药品甲' })).toBeDefined();
    });
    expect(screen.queryByLabelText('编辑批次')).toBeNull();
  });
});

describe('BatchSelect', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('loads batches and reports changes', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      batches: [{ id: 'b-1', batchNo: 'B-001' }, { id: 'b-2', batchNo: 'B-002' }],
    });
    const onChange = vi.fn();
    render(<BatchSelect itemId="item-1" value="b-1" onChange={onChange} ariaLabel="测试批次" />, { wrapper });
    const select = await screen.findByLabelText('测试批次');
    await waitFor(() => {
      expect(Array.from((select as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
        '选择批次',
        'B-001',
        'B-002',
      ]);
    });
    fireEvent.change(select, { target: { value: 'b-2' } });
    expect(onChange).toHaveBeenCalledWith('b-2');
  });

  it('shows an error when batches fail to load', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('batches failed'));
    render(<BatchSelect itemId="item-1" value="" onChange={vi.fn()} ariaLabel="测试批次" />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });
});
