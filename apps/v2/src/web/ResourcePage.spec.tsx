// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ResourcePage } from './ResourcePage';
import { apiRequest, downloadCsv } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const writable = {
  name: 'patients',
  table: 'Patient',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'active', type: 'boolean' },
    { name: 'phone', type: 'text' },
    { name: 'price', type: 'money' },
    { name: 'data', type: 'json' },
  ],
  capabilities: { create: true, update: true, delete: true, softDelete: true },
};

const readOnly = {
  ...writable,
  capabilities: { create: false, update: false, delete: false, softDelete: false },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  </MemoryRouter>
);

describe('ResourcePage', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(downloadCsv).mockReset();
  });

  it('exports the current resource as CSV', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([readOnly])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice' }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('导出'));
    expect(vi.mocked(downloadCsv)).toHaveBeenCalledWith('patients');
  });

  it('shows an export error toast when CSV export fails', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([readOnly])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice' }], total: 1, page: 1, pageSize: 20 });
    vi.mocked(downloadCsv).mockRejectedValueOnce(new Error('export failed'));
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('导出'));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('renders rows and hides write controls for read-only resources', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([readOnly])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    expect(await screen.findByText('Alice')).toBeDefined();
    expect(screen.queryByText('新建')).toBeNull();
    expect(screen.queryByText('编辑')).toBeNull();
    expect(screen.queryByText('删除')).toBeNull();
  });

  it('submits a create form for writable resources', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('新建'));
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 'p2' } })
      .mockResolvedValueOnce({ items: [{ id: 'p2', name: 'Bob', active: true }], total: 1, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Bob' } });
    fireEvent.change(screen.getByLabelText('phone'), { target: { value: '' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('deletes rows when delete is confirmed', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    const deleteButton = await screen.findByText('删除');
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: true, data: { id: 'p1' } });
    fireEvent.click(deleteButton);
    fireEvent.click(await screen.findByText('确认删除'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('submits an edit form and advances pages', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 30, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('编辑'));
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 'p1' } })
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice Updated', active: true }], total: 30, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Alice Updated' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 30, page: 2, pageSize: 20 });
    fireEvent.click(screen.getByText('下一页'));
    expect(await screen.findByText('第 2 页')).toBeDefined();
  });

  it('renders enum, relation, json, and long text form controls', async () => {
    const formResource = {
      name: 'wechatMessages',
      table: 'WechatMessage',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'status', type: 'enum', enumValues: ['PENDING', 'SENT'] },
        { name: 'patientId', type: 'relation', relation: { resource: 'patients', labelField: 'name' } },
        { name: 'notes', type: 'longText' },
        { name: 'data', type: 'json' },
        { name: 'active', type: 'boolean' },
      ],
      capabilities: { create: true, update: false, delete: false, softDelete: false },
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([formResource])
      .mockResolvedValueOnce({
        items: [{
          id: 'w1',
          name: 'Message',
          status: 'PENDING',
          patientId: 'p1',
          notes: 'note',
          data: { key: 'value' },
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'p1', name: 'Alice' }, { id: 'p2' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    render(<ResourcePage resource="wechatMessages" />, { wrapper });
    fireEvent.click(await screen.findByText('新建'));
    expect(await screen.findByText('Alice')).toBeDefined();
    expect(screen.getByLabelText('status')).toBeDefined();
    expect(screen.getByLabelText('notes')).toBeDefined();
    expect(screen.getByLabelText('data')).toBeDefined();
    expect(screen.getByLabelText('active')).toBeDefined();
    expect(screen.getByText('{"key":"value"}')).toBeDefined();
    expect(screen.getByText('p2')).toBeDefined();
    fireEvent.click(screen.getByLabelText('active'));
    fireEvent.change(screen.getByLabelText('status'), { target: { value: 'SENT' } });
    fireEvent.change(screen.getByLabelText('patientId'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('notes'), { target: { value: 'note updated' } });
    fireEvent.change(screen.getByLabelText('data'), { target: { value: '{}' } });
    fireEvent.change(screen.getByLabelText('搜索patients'), { target: { value: 'Alice' } });
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients?page=1&pageSize=50&search=Alice',
    ));
  });

  it('cancels create forms and hides write controls', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('新建'));
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText('保存')).toBeNull();
  });

  it('supports search and pager navigation', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 30, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 30, page: 2, pageSize: 20 });
    fireEvent.click(await screen.findByText('下一页'));
    expect(await screen.findByText('第 2 页')).toBeDefined();
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 30, page: 1, pageSize: 20 });
    fireEvent.click(screen.getByText('上一页'));
    expect(await screen.findByText('第 1 页')).toBeDefined();
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: 'Alice' } });
    expect(await screen.findByText('暂无记录')).toBeDefined();
  });

  it('renders null cell values without crashing', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true, phone: null }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    expect(await screen.findByText('Alice')).toBeDefined();
  });

  it('reads the resource from route params and shows list errors', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockRejectedValueOnce(new Error('list failed'));
    render(
      <MemoryRouter initialEntries={['/resources/patients']}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/resources/:resource" element={<ResourcePage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('edits complex fields and skips empty optional values', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({
        items: [{ id: 'p1', name: 'Alice', active: true, phone: '13000000000', price: 1000, data: { key: 'value' } }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('编辑'));
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 'p1' } })
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice Updated', active: true, phone: '', price: 2500, data: {} }], total: 1, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Alice Updated' } });
    fireEvent.change(screen.getByLabelText('price'), { target: { value: '25.00' } });
    fireEvent.change(screen.getByLabelText('phone'), { target: { value: '' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    const editCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/patients/p1');
    expect(JSON.parse(String(editCall?.[1]?.body)).price).toBe(2500);
  });

  it('does not delete when the user cancels confirmation', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('删除'));
    fireEvent.click(await screen.findByText('取消'));
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('shows not found for unknown resources', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce([writable]);
    render(<ResourcePage resource="missing" />, { wrapper });
    expect(await screen.findByText('资源不存在')).toBeDefined();
  });

  it('falls back to patients when no route param is present', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <MemoryRouter initialEntries={['/']}>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/" element={<ResourcePage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('暂无记录')).toBeDefined();
  });

  it('shows save failures as toast', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('新建'));
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('save failed'));
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('shows delete failures as toast', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('删除'));
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('delete failed'));
    fireEvent.click(await screen.findByText('确认删除'));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('hides hidden fields, keeps read-only fields out of forms, and renders help text', async () => {
    const constrained = {
      name: 'patients',
      table: 'Patient',
      fields: [
        { name: 'name', type: 'text', required: true, readOnly: true },
        { name: 'secret', type: 'text', hidden: true },
        { name: 'notes', type: 'text', helpText: '备注帮助' },
      ],
      capabilities: { create: true, update: true, delete: true, softDelete: true },
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([constrained])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', notes: 'note' }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    expect(await screen.findByText('Alice')).toBeDefined();
    expect(screen.queryByText('secret')).toBeNull();
    fireEvent.click(screen.getByText('新建'));
    expect(screen.queryByLabelText('name')).toBeNull();
    expect(await screen.findByText('备注帮助')).toBeDefined();
  });

  it('shows a retry state when resource metadata fails to load', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('meta failed'));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ResourcePage resource="patients" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByText('重试')).toBeDefined();
    fireEvent.click(screen.getByText('重试'));
  });

  it('closes the resource form from the dialog backdrop', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('新建'));
    // 关闭动画依赖定时器，先完成异步加载再启用 fake timers
    vi.useFakeTimers();
    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!);
    // 关闭动画 120ms 播放完成后表单才移除
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByText('保存')).toBeNull();
  });

  it('shows export errors as toast', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([readOnly])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    vi.mocked(downloadCsv).mockRejectedValueOnce(new Error('export failed'));
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('导出'));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('converts datetime-local form values to ISO before submitting', async () => {
    const datetimeResource = {
      name: 'appointments',
      table: 'Appointment',
      fields: [{ name: 'startTime', type: 'datetime', required: true }],
      capabilities: { create: true, update: false, delete: false, softDelete: false },
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([datetimeResource])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ id: 'a1' })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="appointments" />, { wrapper });
    fireEvent.click(await screen.findByText('新建'));
    fireEvent.change(screen.getByLabelText('startTime'), { target: { value: '2026-08-05T10:00' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
        '/resources/appointments',
        expect.objectContaining({
          body: expect.stringContaining('"startTime":"2026-08-05T'),
        }),
      );
    });
  });
});
