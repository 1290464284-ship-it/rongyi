// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DispenseNarcoticPanel } from './DispenseNarcoticPanel';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockList(items: Array<Record<string, unknown>> = []) {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/narcotic-registry?page=1&pageSize=200') {
      return { items, total: items.length, page: 1, pageSize: 200 };
    }
    if (path === '/resources/inventoryItems?page=1&pageSize=100') {
      return { items: [{ id: 'item-1', name: '麻药甲', batchManaged: 0 }], total: 1, page: 1, pageSize: 100 };
    }
    if (init?.method === 'POST' && path === '/narcotic-registry') return { id: 'n-new' };
    if (init?.method === 'PATCH' && path === '/narcotic-registry/n-1') return { id: 'n-1' };
    if (init?.method === 'DELETE' && path === '/narcotic-registry/n-1') return { deleted: true };
    return {};
  });
}

describe('DispenseNarcoticPanel', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders sparse narcotic rows with blank fallbacks', async () => {
    mockList([{ id: 'n-9', itemName: null, itemId: null, batchNo: null, quantity: null, usage: null, balanceBefore: null, balanceAfter: null }]);
    render(<DispenseNarcoticPanel />, { wrapper });
    expect(await screen.findByText('麻药登记记录')).toBeDefined();
    expect(await screen.findByRole('table')).toBeDefined();
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(2);
  });

  it('edits a sparse narcotic record with blank fallbacks', async () => {
    mockList([{ id: 'n-1', itemId: null, batchNo: null, quantity: null, usage: null, balanceBefore: null, balanceAfter: null, remark: null }]);
    render(<DispenseNarcoticPanel />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const dialog = await screen.findByRole('dialog', { name: '编辑麻药登记' });
    expect((within(dialog).getByLabelText('编辑登记日期') as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText('编辑麻药数量') as HTMLInputElement).value).toBe('0');
    expect((within(dialog).getByLabelText('编辑用途') as HTMLInputElement).value).toBe('');
    expect((within(dialog).getByLabelText('编辑批号') as HTMLInputElement).value).toBe('');
  });

  it('submits an edit with empty batch as undefined', async () => {
    mockList([{ id: 'n-1', recordDate: '2026-08-05', itemId: 'item-1', batchNo: 'B-1', quantity: 1, usage: 'x', balanceBefore: '5', balanceAfter: '4', remark: 'r' }]);
    render(<DispenseNarcoticPanel />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const dialog = await screen.findByRole('dialog', { name: '编辑麻药登记' });
    fireEvent.change(within(dialog).getByLabelText('编辑批号'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));
    await waitFor(() => {
      const patchCall = vi.mocked(apiRequest).mock.calls.find(
        ([path, options]) => path === '/narcotic-registry/n-1' && (options as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body)) as Record<string, unknown>;
      expect(body.batchNo).toBeUndefined();
    });
    expect(await screen.findByText('麻药登记已更新')).toBeDefined();
  });

  it('validates the create form and deletes a record after confirmation', async () => {
    mockList([{ id: 'n-1', recordDate: '2026-08-05', itemId: 'item-1', batchNo: 'B-1', quantity: 1 }]);
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('麻药登记记录');
    fireEvent.click(screen.getByRole('button', { name: '登记' }));
    expect(await screen.findByText('请填写登记日期、麻药物品和有效的麻药数量')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog', { name: '删除麻药登记' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/narcotic-registry/n-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('麻药登记已删除')).toBeDefined();
  });

  it('falls back to empty rows and zero total when the list omits keys', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/narcotic-registry?page=1&pageSize=200') return {};
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    expect(await screen.findByText('暂无麻药登记')).toBeDefined();
  });

  it('ignores delete confirmation while a create is in flight', async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/narcotic-registry?page=1&pageSize=200') {
        return { items: [{ id: 'n-1', recordDate: '2026-08-05', itemId: 'item-1', batchNo: 'B-1', quantity: 1 }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/inventoryItems?page=1&pageSize=100') {
        return { items: [{ id: 'item-1', name: '麻药甲', batchManaged: 0 }], total: 1, page: 1, pageSize: 100 };
      }
      if (init?.method === 'POST' && path === '/narcotic-registry') {
        return await new Promise((resolve) => { resolvePost = resolve; });
      }
      return {};
    });
    render(<DispenseNarcoticPanel />, { wrapper });
    await screen.findByText('麻药登记记录');
    await waitFor(() => {
      expect((screen.getByLabelText('麻药物品') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('登记日期'), { target: { value: '2026-08-05' } });
    fireEvent.change(screen.getByLabelText('麻药物品'), { target: { value: 'item-1' } });
    fireEvent.change(screen.getByLabelText('麻药数量'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '登记' }));

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog', { name: '删除麻药登记' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));

    expect(apiRequest).not.toHaveBeenCalledWith('/narcotic-registry/n-1', expect.objectContaining({ method: 'DELETE' }));

    resolvePost?.({ id: 'n-new' });
    expect(await screen.findByText('麻药登记成功')).toBeDefined();
  });
});
