// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CrudPage, type CrudPageProps } from './CrudPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

type ThingRow = Record<string, unknown> & { id: string; name?: string; note?: string };
interface ThingForm { name: string; note: string }

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') return { id: 'new-1' };
    if (method === 'PATCH') return { id: 't-1' };
    if (method === 'DELETE') return { ok: true };
    const url = new URL(path, 'http://localhost');
    const page = Number(url.searchParams.get('page') ?? 1);
    if (url.searchParams.get('search')) {
      return { items: [{ id: 's-1', name: '搜索项', note: '搜索备注' }], total: 1, page, pageSize: 50 };
    }
    if (page === 2) return { items: [{ id: 't-2', name: '物品乙', note: '说明二' }], total: 120, page, pageSize: 50 };
    return { items: [{ id: 't-1', name: '物品甲', note: '说明一' }], total: 120, page, pageSize: 50 };
  });
}

function baseProps(): CrudPageProps<ThingRow, ThingForm> {
  return {
    title: '物品管理',
    createLabel: '新建物品',
    queryKey: ['things'],
    endpoint: '/resources/things',
    initialForm: { name: '', note: '' },
    validate: (form) => (form.name ? null : '请填写名称'),
    columns: [
      { key: 'name', label: '名称' },
      { key: 'note', label: '备注' },
    ],
    canEdit: true,
    canDelete: true,
    searchable: true,
    paged: true,
    renderForm: ({ form, update }) => (
      <>
        <label>名称<input value={form.name} onChange={(event) => update({ name: event.target.value })} /></label>
        <label>备注<input value={form.note} onChange={(event) => update({ note: event.target.value })} /></label>
      </>
    ),
  };
}

describe('CrudPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders the list rows, headers and create button', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    expect(await screen.findByText('物品甲')).toBeDefined();
    expect(screen.getByText('说明一')).toBeDefined();
    expect(screen.getByText('名称')).toBeDefined();
    expect(screen.getByText('备注')).toBeDefined();
    expect(screen.getByText('新建物品')).toBeDefined();
  });

  it('shows the page error when the list request fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('列表加载失败'));
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    expect(await screen.findByText('列表加载失败')).toBeDefined();
  });

  it('shows the empty state when there are no rows', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    expect(await screen.findByText('暂无数据')).toBeDefined();
  });

  it('blocks create with a toast when validation fails and does not POST', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getByText('新建物品'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请填写名称')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST' }));
  });

  it('creates with POST, shows the toast and closes the dialog', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getByText('新建物品'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新物品' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"name":"新物品"') }));
    });
    expect(await screen.findByText('创建成功')).toBeDefined();
    expect(screen.queryByLabelText('名称')).toBeNull();
  });

  it('applies toPayload before POST', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} toPayload={(form) => ({ name: `前缀-${form.name}`, note: form.note })} />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getByText('新建物品'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '甲' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"name":"前缀-甲"') }));
    });
  });

  it('edits: prefills from the row and PATCHes', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getAllByText('编辑')[0]);
    expect(screen.getByRole('dialog', { name: '编辑物品管理' })).toBeDefined();
    await waitFor(() => {
      expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('物品甲');
    });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '物品乙' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things/t-1', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"name":"物品乙"') }));
    });
    expect(await screen.findByText('更新成功')).toBeDefined();
  });

  it('delete: cancel keeps the row, confirm deletes it', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getAllByText('删除')[0]);
    expect(await screen.findByText('确定删除该记录吗？')).toBeDefined();
    fireEvent.click(screen.getByText('取消'));
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things/t-1', expect.objectContaining({ method: 'DELETE' }));
    fireEvent.click(screen.getAllByText('删除')[0]);
    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things/t-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('删除成功')).toBeDefined();
  });

  it('delete: uses a custom deleteTitle when provided', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} deleteTitle="删除物品" />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getAllByText('删除')[0]);
    expect(await screen.findByText('删除物品')).toBeDefined();
  });

  it('searches with a debounce and resets the page to 1', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getByText('下一页'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things?page=2&pageSize=50');
    });
    await screen.findByText('物品乙');
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: '甲' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things?page=1&pageSize=50&search=%E7%94%B2');
    }, { timeout: 2000 });
    expect(await screen.findByText('搜索项')).toBeDefined();
  });

  it('paginates with the pager buttons', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getByText('下一页'));
    expect(await screen.findByText('物品乙')).toBeDefined();
    fireEvent.click(screen.getByText('上一页'));
    expect(await screen.findByText('物品甲')).toBeDefined();
  });

  it('renders rowActions with access to reload', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} rowActions={(_row, ctx) => <button onClick={() => void ctx.reload()}>刷新</button>} />, { wrapper });
    await screen.findByText('物品甲');
    const listCalls = () => vi.mocked(apiRequest).mock.calls.filter((call) => String(call[0]).startsWith('/resources/things?')).length;
    const before = listCalls();
    fireEvent.click(screen.getByText('刷新'));
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });

  it('uses submitOverride instead of the default POST', async () => {
    mockData();
    render(
      <CrudPage<ThingRow, ThingForm>
        {...baseProps()}
        submitOverride={async ({ form, editing }) => {
          await apiRequest('/special/things', { method: 'POST', body: JSON.stringify({ fromOverride: form.name, editing }) });
        }}
      />,
      { wrapper },
    );
    await screen.findByText('物品甲');
    fireEvent.click(screen.getByText('新建物品'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '甲' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/special/things', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"fromOverride":"甲"') }));
    });
    expect(await screen.findByText('创建成功')).toBeDefined();
    expect(screen.queryByLabelText('名称')).toBeNull();
  });

  it('blocks submission when onBeforeSubmit returns an error', async () => {
    mockData();
    render(<CrudPage<ThingRow, ThingForm> {...baseProps()} onBeforeSubmit={async (form) => (form.name === '重复' ? '名称重复' : null)} />, { wrapper });
    await screen.findByText('物品甲');
    fireEvent.click(screen.getByText('新建物品'));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '重复' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('名称重复')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST' }));
  });
});
