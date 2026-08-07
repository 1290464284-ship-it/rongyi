// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
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
});
