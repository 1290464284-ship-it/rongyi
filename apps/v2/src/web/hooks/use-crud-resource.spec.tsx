// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCrudResource } from './use-crud-resource';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

type HookRow = Record<string, unknown> & { id: string; name?: string; note?: string };
interface HookForm { name: string; note: string }

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockApi() {
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { id: 'new-1' };
    if (init?.method === 'PATCH') return { id: 'r-1' };
    return { items: [], total: 0, page: 1, pageSize: 50 };
  });
}

function Harness() {
  const crud = useCrudResource<HookRow, HookForm>({
    queryKey: ['hook-items'],
    endpoint: '/resources/things',
    initialForm: { name: '', note: '' },
    validate: (form) => (form.name ? null : '请填写名称'),
  });
  return (
    <div>
      <button onClick={crud.openCreate}>open-create</button>
      <button onClick={() => crud.openEdit({ id: 'r-1', name: '旧名', note: '旧备注' })}>open-edit</button>
      <button onClick={() => crud.updateForm({ name: '新名' })}>update-name</button>
      <button onClick={() => void crud.submit()}>submit</button>
      <span data-testid="name">{crud.form.name}</span>
      <span data-testid="note">{crud.form.note}</span>
      <span data-testid="editing">{String(crud.editing)}</span>
      <span data-testid="show">{String(crud.showForm)}</span>
    </div>
  );
}

describe('useCrudResource', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('updateForm merges partial updates into the form', async () => {
    mockApi();
    render(<Harness />, { wrapper });
    fireEvent.click(screen.getByText('open-create'));
    fireEvent.click(screen.getByText('update-name'));
    expect(screen.getByTestId('name').textContent).toBe('新名');
    expect(screen.getByTestId('note').textContent).toBe('');
  });

  it('openEdit copies same-named fields from the row', async () => {
    mockApi();
    render(<Harness />, { wrapper });
    fireEvent.click(screen.getByText('open-edit'));
    expect(screen.getByTestId('name').textContent).toBe('旧名');
    expect(screen.getByTestId('note').textContent).toBe('旧备注');
    expect(screen.getByTestId('editing').textContent).toBe('true');
  });

  it('openCreate resets the form and clears the editing state', async () => {
    mockApi();
    render(<Harness />, { wrapper });
    fireEvent.click(screen.getByText('open-edit'));
    fireEvent.click(screen.getByText('open-create'));
    expect(screen.getByTestId('name').textContent).toBe('');
    expect(screen.getByTestId('note').textContent).toBe('');
    expect(screen.getByTestId('editing').textContent).toBe('false');
    expect(screen.getByTestId('show').textContent).toBe('true');
  });

  it('resets the form, closes the dialog and toasts after a successful create', async () => {
    mockApi();
    render(<Harness />, { wrapper });
    fireEvent.click(screen.getByText('open-create'));
    fireEvent.click(screen.getByText('update-name'));
    fireEvent.click(screen.getByText('submit'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('创建成功')).toBeDefined();
    expect(screen.getByTestId('name').textContent).toBe('');
    expect(screen.getByTestId('show').textContent).toBe('false');
  });

  it('PATCHes when editing and toasts the update message', async () => {
    mockApi();
    render(<Harness />, { wrapper });
    fireEvent.click(screen.getByText('open-edit'));
    fireEvent.click(screen.getByText('submit'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things/r-1', expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"name":"旧名"') }));
    });
    expect(await screen.findByText('更新成功')).toBeDefined();
    expect(screen.getByTestId('show').textContent).toBe('false');
  });

  it('validation failure blocks submit with a toast', async () => {
    mockApi();
    render(<Harness />, { wrapper });
    fireEvent.click(screen.getByText('open-create'));
    fireEvent.click(screen.getByText('submit'));
    expect(await screen.findByText('请填写名称')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST' }));
  });

  it('syncs the search input when initialSearch changes', async () => {
    mockApi();
    function SyncHarness() {
      const [initial, setInitial] = useState('a');
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['hook-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        initialSearch: initial,
      });
      return (
        <div>
          <button onClick={() => setInitial('b')}>change-initial</button>
          <button onClick={() => crud.setPage(2)}>page-2</button>
          <span data-testid="search">{crud.searchInput}</span>
          <span data-testid="page">{crud.page}</span>
        </div>
      );
    }
    render(<SyncHarness />, { wrapper });
    expect(screen.getByTestId('search').textContent).toBe('a');
    fireEvent.click(screen.getByText('page-2'));
    expect(screen.getByTestId('page').textContent).toBe('2');
    fireEvent.click(screen.getByText('change-initial'));
    expect(screen.getByTestId('search').textContent).toBe('b');
    expect(screen.getByTestId('page').textContent).toBe('1');
  });

  it('resets the submit lock when validation throws unexpectedly', async () => {
    mockApi();
    function ThrowingValidateHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['hook-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        validate: (form) => {
          if (form.name === 'boom') throw new Error('validator crashed');
          return form.name ? null : '请填写名称';
        },
      });
      return (
        <div>
          <button onClick={crud.openCreate}>open-create</button>
          <button onClick={() => crud.updateForm({ name: 'boom' })}>set-boom</button>
          <button onClick={() => crud.updateForm({ name: 'ok' })}>set-ok</button>
          <button onClick={() => void crud.submit()}>submit</button>
        </div>
      );
    }
    render(<ThrowingValidateHarness />, { wrapper });
    fireEvent.click(screen.getByText('open-create'));
    fireEvent.click(screen.getByText('set-boom'));
    fireEvent.click(screen.getByText('submit'));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.click(screen.getByText('set-ok'));
    fireEvent.click(screen.getByText('submit'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST' }));
    });
  });

  it('submits without validation and stores a null id when create omits it', async () => {
    const onSaved = vi.fn();
    function NoValidateHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['hook-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        onSaved,
      });
      return (
        <div>
          <button onClick={crud.openCreate}>open-create</button>
          <button onClick={() => void crud.submit()}>submit</button>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return {};
      return { items: [], total: 0, page: 1, pageSize: 50 };
    });
    render(<NoValidateHarness />, { wrapper });
    fireEvent.click(screen.getByText('open-create'));
    fireEvent.click(screen.getByText('submit'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('创建成功')).toBeDefined();
    expect(onSaved).toHaveBeenCalledWith(null, false, expect.any(Object));
  });

  it('honours onBeforeSubmit blocking and deleteOverride paths', async () => {
    const deleteOverride = vi.fn().mockResolvedValue(undefined);
    function ExtendedHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['hook-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        onBeforeSubmit: async () => 'blocked by rule',
        deleteOverride,
      });
      return (
        <div>
          <button onClick={crud.openCreate}>open-create</button>
          <button onClick={() => void crud.submit()}>submit</button>
          <button onClick={() => crud.requestDelete({ id: 'r-1' })}>request-delete</button>
          <button onClick={() => void crud.confirmDelete()}>confirm-delete</button>
        </div>
      );
    }
    mockApi();
    render(<ExtendedHarness />, { wrapper });
    fireEvent.click(screen.getByText('open-create'));
    fireEvent.click(screen.getByText('submit'));
    expect(await screen.findByText('blocked by rule')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST' }));

    fireEvent.click(screen.getByText('request-delete'));
    fireEvent.click(screen.getByText('confirm-delete'));
    await waitFor(() => {
      expect(deleteOverride).toHaveBeenCalledWith({ id: 'r-1' });
    });
    expect(await screen.findByText('删除成功')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things/r-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('steps back a page after deleting the last row', async () => {
    function PagedHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['hook-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
      });
      return (
        <div>
          <button onClick={() => crud.setPage(2)}>page-2</button>
          <button onClick={() => crud.requestDelete({ id: 'r-1' })}>request-delete</button>
          <button onClick={() => void crud.confirmDelete()}>confirm-delete</button>
          <span data-testid="page">{crud.page}</span>
          <span data-testid="stale">{String(crud.isStale)}</span>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { deleted: true };
      if (String(path).includes('page=2')) return { items: [], total: 0, page: 2, pageSize: 50 };
      return { items: [{ id: 'r-1' }], total: 1, page: 1, pageSize: 50 };
    });
    render(<PagedHarness />, { wrapper });
    fireEvent.click(screen.getByText('page-2'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('2');
      expect(screen.getByTestId('stale').textContent).toBe('false');
    });
    fireEvent.click(screen.getByText('request-delete'));
    fireEvent.click(screen.getByText('confirm-delete'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('1');
    });

    fireEvent.click(screen.getByText('page-2'));
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { deleted: true };
      if (String(path).includes('page=2')) return { items: [{ id: 'r-2' }], total: 1, page: 2, pageSize: 50 };
      return { items: [], total: 0, page: 1, pageSize: 50 };
    });
    fireEvent.click(screen.getByText('request-delete'));
    fireEvent.click(screen.getByText('confirm-delete'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('2');
    });
  });

  it('uses keyset cursor pagination when enabled', async () => {
    function CursorHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['cursor-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        cursorPagination: true,
      });
      return (
        <div>
          <button onClick={crud.goNext}>next</button>
          <button onClick={crud.goPrev}>prev</button>
          <span data-testid="page">{crud.page}</span>
          <span data-testid="has-next">{String(crud.hasNext)}</span>
          <span data-testid="can-prev">{String(crud.canGoPrev)}</span>
          <span data-testid="next-cursor">{String(crud.query.data?.nextCursor ?? '')}</span>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (String(path).includes('cursor=cursor-1')) {
        return { items: [{ id: 'r-2' }], total: 2, page: 1, pageSize: 50, nextCursor: 'cursor-2' };
      }
      if (String(path).includes('cursor=cursor-2')) {
        return { items: [], total: 2, page: 1, pageSize: 50 };
      }
      return { items: [{ id: 'r-1' }], total: 2, page: 1, pageSize: 50, nextCursor: 'cursor-1' };
    });
    render(<CursorHarness />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('has-next').textContent).toBe('true'));

    fireEvent.click(screen.getByText('next'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('cursor=cursor-1'));
      expect(screen.getByTestId('page').textContent).toBe('2');
      expect(screen.getByTestId('can-prev').textContent).toBe('true');
      expect(screen.getByTestId('next-cursor').textContent).toBe('cursor-2');
    });

    fireEvent.click(screen.getByText('next'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('cursor=cursor-2'));
      expect(screen.getByTestId('has-next').textContent).toBe('false');
      expect(screen.getByTestId('next-cursor').textContent).toBe('');
    });

    fireEvent.click(screen.getByText('next'));
    expect(screen.getByTestId('page').textContent).toBe('3');

    fireEvent.click(screen.getByText('prev'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('2');
      expect(screen.getByTestId('can-prev').textContent).toBe('true');
      expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('cursor=cursor-1'));
    });

    fireEvent.click(screen.getByText('prev'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('1');
      expect(screen.getByTestId('can-prev').textContent).toBe('false');
    });
  });

  it('guards cursor setPage and empty next/prev navigation', async () => {
    function CursorPageHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['cursor-page-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        cursorPagination: true,
      });
      return (
        <div>
          <button onClick={crud.goNext}>next</button>
          <button onClick={crud.goPrev}>prev</button>
          <button onClick={() => crud.setPage(2)}>set-2</button>
          <button onClick={() => crud.setPage(1)}>set-1</button>
          <span data-testid="page">{crud.page}</span>
          <span data-testid="can-prev">{String(crud.canGoPrev)}</span>
          <span data-testid="has-next">{String(crud.hasNext)}</span>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (String(path).includes('cursor=cursor-1')) {
        return { items: [{ id: 'r-2' }], total: 2, page: 1, pageSize: 50 };
      }
      return { items: [{ id: 'r-1' }], total: 2, page: 1, pageSize: 50, nextCursor: 'cursor-1' };
    });
    render(<CursorPageHarness />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('has-next').textContent).toBe('true'));

    fireEvent.click(screen.getByText('set-2'));
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('2'));
    expect(screen.getByTestId('can-prev').textContent).toBe('true');

    fireEvent.click(screen.getByText('next'));
    await waitFor(() => expect(screen.getByTestId('has-next').textContent).toBe('false'));
    expect(screen.getByTestId('page').textContent).toBe('2');

    fireEvent.click(screen.getByText('set-1'));
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('1'));
    expect(screen.getByTestId('can-prev').textContent).toBe('false');

    fireEvent.click(screen.getByText('prev'));
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('1'));
  });

  it('blocks edits, submits, and deletes while the list shows placeholder data', async () => {
    function StaleHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['stale-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
      });
      return (
        <div>
          <button onClick={() => crud.setSearch('new')}>search-new</button>
          <button onClick={() => crud.openEdit({ id: 'r-1', name: 'x' })}>open-edit</button>
          <button onClick={() => void crud.submit()}>submit</button>
          <button onClick={() => crud.requestDelete({ id: 'r-1' })}>request-delete</button>
          <span data-testid="stale">{String(crud.isStale)}</span>
          <span data-testid="show">{String(crud.showForm)}</span>
          <span data-testid="delete">{String(crud.deleteTarget !== null)}</span>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (String(path).includes('search=new')) {
        return new Promise(() => {});
      }
      return { items: [{ id: 'r-1', name: 'x' }], total: 1, page: 1, pageSize: 50 };
    });
    render(<StaleHarness />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('stale').textContent).toBe('false'));

    fireEvent.click(screen.getByText('search-new'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await waitFor(() => expect(screen.getByTestId('stale').textContent).toBe('true'));

    fireEvent.click(screen.getByText('open-edit'));
    fireEvent.click(screen.getByText('submit'));
    fireEvent.click(screen.getByText('request-delete'));
    expect(screen.getByTestId('show').textContent).toBe('false');
    expect(screen.getByTestId('delete').textContent).toBe('false');
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things/r-1', expect.objectContaining({ method: 'PATCH' }));
  });

  it('blocks duplicate create submits while one is pending', async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    function PendingCreateHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['pending-create'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
      });
      return (
        <div>
          <button onClick={crud.openCreate}>open-create</button>
          <button onClick={() => void crud.submit()}>submit</button>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'POST' && path === '/resources/things') {
        return await new Promise((resolve) => {
          resolvePost = resolve;
        });
      }
      return { items: [], total: 0, page: 1, pageSize: 50 };
    });
    render(<PendingCreateHarness />, { wrapper });
    fireEvent.click(screen.getByText('open-create'));
    fireEvent.click(screen.getByText('submit'));
    fireEvent.click(screen.getByText('submit'));
    expect(vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/resources/things' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'POST',
    )).toHaveLength(1);
    resolvePost?.({ id: 'r-new' });
    expect(await screen.findByText('创建成功')).toBeDefined();
  });

  it('blocks an edit submit after the list becomes stale', async () => {
    function StaleEditHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['stale-edit-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
      });
      return (
        <div>
          <button onClick={() => crud.openEdit({ id: 'r-1', name: '旧名' })}>open-edit</button>
          <button onClick={() => crud.setSearch('new')}>search-new</button>
          <button onClick={() => void crud.submit()}>submit</button>
          <span data-testid="note">{crud.form.note}</span>
          <span data-testid="stale">{String(crud.isStale)}</span>
          <span data-testid="show">{String(crud.showForm)}</span>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (String(path).includes('search=new')) return new Promise(() => {});
      return { items: [{ id: 'r-1', name: '旧名' }], total: 1, page: 1, pageSize: 50 };
    });
    render(<StaleEditHarness />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('stale').textContent).toBe('false'));
    fireEvent.click(screen.getByText('open-edit'));
    await waitFor(() => expect(screen.getByTestId('show').textContent).toBe('true'));
    expect(screen.getByTestId('note').textContent).toBe('');
    fireEvent.click(screen.getByText('search-new'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await waitFor(() => expect(screen.getByTestId('stale').textContent).toBe('true'));
    fireEvent.click(screen.getByText('submit'));
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things/r-1', expect.objectContaining({ method: 'PATCH' }));
    expect(screen.getByTestId('show').textContent).toBe('true');
  });

  it('ignores confirmDelete without a target', async () => {
    function DeleteGuardHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['delete-guard-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
      });
      return (
        <div>
          <button onClick={() => void crud.confirmDelete()}>confirm-delete</button>
        </div>
      );
    }
    mockApi();
    render(<DeleteGuardHarness />, { wrapper });
    fireEvent.click(screen.getByText('confirm-delete'));
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/things/r-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('resets cursor state when initialSearch changes', async () => {
    function SyncCursorHarness() {
      const [initial, setInitial] = useState<string | undefined>('a');
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['cursor-sync-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        initialSearch: initial,
        cursorPagination: true,
      });
      return (
        <div>
          <button onClick={() => setInitial('b')}>change-initial</button>
          <button onClick={() => setInitial(undefined)}>clear-initial</button>
          <span data-testid="search">{crud.searchInput}</span>
          <span data-testid="page">{crud.page}</span>
        </div>
      );
    }
    mockApi();
    render(<SyncCursorHarness />, { wrapper });
    expect(screen.getByTestId('search').textContent).toBe('a');
    fireEvent.click(screen.getByText('change-initial'));
    expect(screen.getByTestId('search').textContent).toBe('b');
    expect(screen.getByTestId('page').textContent).toBe('1');
    fireEvent.click(screen.getByText('clear-initial'));
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('guards goPrev while cursor data is stale', async () => {
    function CursorStaleHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['cursor-stale-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        cursorPagination: true,
      });
      return (
        <div>
          <button onClick={crud.goNext}>next</button>
          <button onClick={crud.goPrev}>prev</button>
          <button onClick={() => crud.setSearch('new')}>search-new</button>
          <span data-testid="page">{crud.page}</span>
          <span data-testid="stale">{String(crud.isStale)}</span>
          <span data-testid="fetching">{String(crud.query.isFetching)}</span>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (String(path).includes('search=new')) return new Promise(() => {});
      if (String(path).includes('cursor=cursor-1')) return { items: [{ id: 'r-2' }], total: 2, page: 1, pageSize: 50 };
      return { items: [{ id: 'r-1' }], total: 2, page: 1, pageSize: 50, nextCursor: 'cursor-1' };
    });
    render(<CursorStaleHarness />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('fetching').textContent).toBe('false'));
    fireEvent.click(screen.getByText('next'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('2');
      expect(screen.getByTestId('fetching').textContent).toBe('false');
      expect(screen.getByTestId('stale').textContent).toBe('false');
    });
    fireEvent.click(screen.getByText('search-new'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await waitFor(() => expect(screen.getByTestId('stale').textContent).toBe('true'));
    fireEvent.click(screen.getByText('prev'));
    expect(screen.getByTestId('page').textContent).toBe('1');
  });

  it('steps back a page when the refreshed page omits items', async () => {
    function PagedHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['hook-items-omit'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
      });
      return (
        <div>
          <button onClick={() => crud.setPage(2)}>page-2</button>
          <button onClick={() => crud.requestDelete({ id: 'r-1' })}>request-delete</button>
          <button onClick={() => void crud.confirmDelete()}>confirm-delete</button>
          <span data-testid="page">{crud.page}</span>
          <span data-testid="stale">{String(crud.isStale)}</span>
          <span data-testid="fetching">{String(crud.query.isFetching)}</span>
        </div>
      );
    }
    let deleted = false;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'DELETE') {
        deleted = true;
        return { deleted: true };
      }
      if (String(path).includes('page=2')) {
        return deleted ? {} : { items: [{ id: 'r-1' }], total: 2, page: 2, pageSize: 50 };
      }
      return { items: [{ id: 'r-1' }], total: 1, page: 1, pageSize: 50 };
    });
    render(<PagedHarness />, { wrapper });
    fireEvent.click(screen.getByText('page-2'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('2');
      expect(screen.getByTestId('fetching').textContent).toBe('false');
      expect(screen.getByTestId('stale').textContent).toBe('false');
    });
    fireEvent.click(screen.getByText('request-delete'));
    fireEvent.click(screen.getByText('confirm-delete'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('1');
    });
  });

  it('guards cursor setPage during stale reloads and on the current page', async () => {
    function CursorGuardHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['cursor-guard-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        cursorPagination: true,
      });
      return (
        <div>
          <button onClick={() => crud.setSearch('new')}>search-new</button>
          <button onClick={() => crud.setPage(2)}>set-2</button>
          <button onClick={() => crud.setPage(1)}>set-1</button>
          <span data-testid="page">{crud.page}</span>
          <span data-testid="stale">{String(crud.isStale)}</span>
          <span data-testid="loaded">{String(Boolean(crud.query.data))}</span>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (String(path).includes('search=new')) {
        return new Promise(() => {});
      }
      return { items: [{ id: 'r-1' }], total: 2, page: 1, pageSize: 50, nextCursor: 'cursor-1' };
    });
    render(<CursorGuardHarness />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    // 当前页 setPage(1)：no-op
    fireEvent.click(screen.getByText('set-1'));
    expect(screen.getByTestId('page').textContent).toBe('1');
    // 搜索换键进入 placeholder：setPage(2) 被拦截
    fireEvent.click(screen.getByText('search-new'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await waitFor(() => expect(screen.getByTestId('stale').textContent).toBe('true'));
    fireEvent.click(screen.getByText('set-2'));
    expect(screen.getByTestId('page').textContent).toBe('1');
  });

  it('keeps the page when setPage has no next cursor to advance through', async () => {
    function CursorNoNextHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['cursor-nonext-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        cursorPagination: true,
      });
      return (
        <div>
          <button onClick={() => crud.setPage(3)}>set-3</button>
          <span data-testid="page">{crud.page}</span>
        </div>
      );
    }
    vi.mocked(apiRequest).mockResolvedValue({ items: [{ id: 'r-1' }], total: 1, page: 1, pageSize: 50 });
    render(<CursorNoNextHarness />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('1'));
    fireEvent.click(screen.getByText('set-3'));
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('1'));
  });

  it('steps back a cursor page after deleting the last row', async () => {
    function CursorDeleteHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['cursor-delete-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        cursorPagination: true,
      });
      return (
        <div>
          <button onClick={crud.goNext}>next</button>
          <button onClick={() => crud.requestDelete({ id: 'r-2' })}>request-delete</button>
          <button onClick={() => void crud.confirmDelete()}>confirm-delete</button>
          <span data-testid="page">{crud.page}</span>
          <span data-testid="stale">{String(crud.isStale)}</span>
          <span data-testid="loaded">{String(Boolean(crud.query.data))}</span>
        </div>
      );
    }
    let deleted = false;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'DELETE') {
        deleted = true;
        return { deleted: true };
      }
      if (String(path).includes('cursor=cursor-1')) {
        return deleted ? { total: 2 } : { items: [{ id: 'r-2' }], total: 2, page: 1, pageSize: 50 };
      }
      return { items: [{ id: 'r-1' }], total: 2, page: 1, pageSize: 50, nextCursor: 'cursor-1' };
    });
    render(<CursorDeleteHarness />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    fireEvent.click(screen.getByText('next'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('2');
      expect(screen.getByTestId('stale').textContent).toBe('false');
    });
    fireEvent.click(screen.getByText('request-delete'));
    fireEvent.click(screen.getByText('confirm-delete'));
    await waitFor(() => {
      expect(screen.getByTestId('page').textContent).toBe('1');
    });
  });

  it('patches total-less pages and tolerates missing cache data', async () => {
    function TotalLessHarness({ enabled }: { enabled?: boolean }) {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['total-less-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        enabled,
      });
      return (
        <div>
          <button onClick={() => crud.openCreate()}>open-create</button>
          <button onClick={() => void crud.submit()}>submit</button>
          <button onClick={() => crud.requestDelete({ id: 'r-1' })}>request-delete</button>
          <button onClick={() => void crud.confirmDelete()}>confirm-delete</button>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'POST') return { id: 'r-new' };
      if (String(init?.method ?? 'GET').toUpperCase() === 'DELETE') return { deleted: true };
      // 无 total 字段的列表页
      return { items: [{ id: 'r-1' }], page: 1, pageSize: 50 };
    });
    render(<TotalLessHarness />, { wrapper });
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    fireEvent.click(screen.getByText('open-create'));
    fireEvent.click(screen.getByText('submit'));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/resources/things', expect.objectContaining({ method: 'POST' })));
    fireEvent.click(screen.getByText('request-delete'));
    fireEvent.click(screen.getByText('confirm-delete'));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/resources/things/r-1', expect.objectContaining({ method: 'DELETE' })));
  });

  it('tolerates optimistic removal without cached list data', async () => {
    function DisabledHarness() {
      const crud = useCrudResource<HookRow, HookForm>({
        queryKey: ['disabled-items'],
        endpoint: '/resources/things',
        initialForm: { name: '', note: '' },
        enabled: false,
      });
      return (
        <div>
          <button onClick={() => crud.requestDelete({ id: 'r-1' })}>request-delete</button>
          <button onClick={() => void crud.confirmDelete()}>confirm-delete</button>
        </div>
      );
    }
    vi.mocked(apiRequest).mockImplementation(async (_path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'DELETE') return { deleted: true };
      return { items: [], total: 0, page: 1, pageSize: 50 };
    });
    render(<DisabledHarness />, { wrapper });
    fireEvent.click(screen.getByText('request-delete'));
    fireEvent.click(screen.getByText('confirm-delete'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/things/r-1', expect.objectContaining({ method: 'DELETE' }));
    });
  });
});
