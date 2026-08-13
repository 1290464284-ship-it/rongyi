// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ResourcePage } from './ResourcePage';
import { apiRequest, downloadCsv } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { ToastProvider } from './toast';
import { downloadTextFile } from '../pages/analytics/analytics-utils';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));
vi.mock('../pages/analytics/analytics-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pages/analytics/analytics-utils')>();
  return { ...actual, downloadTextFile: vi.fn() };
});

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
    vi.mocked(downloadTextFile).mockReset();
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

  it('exports endpoint reports as CSV', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'p1', name: 'Alice', rfm: 'CHAMPION' }]);
    render(<ResourcePage title="RFM" endpoint="/analytics/rfm" />, { wrapper });
    fireEvent.click(await screen.findByText('导出'));
    expect(vi.mocked(downloadTextFile)).toHaveBeenCalledWith(
      'RFM.csv',
      expect.stringContaining('"id","name","rfm"'),
    );
    expect(vi.mocked(downloadTextFile).mock.calls[0][1]).toContain('Alice');
  });

  it('supports batch delete with row selection', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({
        items: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }],
        total: 2,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    await screen.findByText('A');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByText('删除选中'));
    fireEvent.click(screen.getByText('批量删除'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'DELETE' }),
    ));
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p2',
      expect.objectContaining({ method: 'DELETE' }),
    );
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
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(false);
    });
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 30, page: 1, pageSize: 20 });
    fireEvent.click(screen.getByText('上一页'));
    expect(await screen.findByText('第 1 页')).toBeDefined();
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: 'Alice' } });
    expect(await screen.findByText('暂无记录')).toBeDefined();
  });

  it('does not submit an edit while the list is stale', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('编辑'));
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: 'stale' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients?page=1&pageSize=20&search=stale');
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(vi.mocked(apiRequest).mock.calls.some(([path, options]) =>
      path === '/resources/patients/p1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
    )).toBe(false);
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

  it('round-trips datetime and number values in edit forms', async () => {
    const typedResource = {
      name: 'appointments',
      table: 'Appointment',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'startTime', type: 'datetime' },
        { name: 'price', type: 'number' },
      ],
      capabilities: { create: true, update: true, delete: false, softDelete: false },
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([typedResource])
      .mockResolvedValueOnce({
        items: [{
          id: 'a1',
          name: 'Appt',
          startTime: '2026-08-05T02:00:00.000Z',
          price: 12,
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    render(<ResourcePage resource="appointments" />, { wrapper });
    fireEvent.click(await screen.findByText('编辑'));
    expect((screen.getByLabelText('startTime') as HTMLInputElement).value).toMatch(/^2026-08-05T/);
    expect((screen.getByLabelText('price') as HTMLInputElement).value).toBe('12');
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 'a1' } })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByLabelText('price'), { target: { value: '15' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/appointments/a1');
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
      expect(body.price).toBe(15);
    });
  });

  it('renders endpoint report tables with formatted columns and errors', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/stats/demo') {
        return [{
          id: 's1',
          label: 'demo',
          revenue: 123456,
          createdAt: '2026-08-01T02:00:00.000Z',
          planDate: '2026-08-05',
          nested: { a: 1 },
          empty: null,
        }];
      }
      return [];
    });
    render(<ResourcePage title="报表" endpoint="/stats/demo" />, { wrapper });
    expect(await screen.findByText('¥1234.56')).toBeDefined();
    expect(screen.getByText(formatDateTime('2026-08-01T02:00:00.000Z'))).toBeDefined();
    expect(screen.getByText('2026/8/5')).toBeDefined();
    expect(screen.getByText('{"a":1}')).toBeDefined();

    cleanup();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/stats/demo') throw new Error('report failed');
      return [];
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <ResourcePage title="报表" endpoint="/stats/demo" />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('selects all rows, cancels selection and cancels the batch dialog', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], total: 2, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    await screen.findByText('A');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(screen.getByText('已选 2 项')).toBeDefined();
    fireEvent.click(checkboxes[0]);
    expect(screen.queryByText('已选 2 项')).toBeNull();
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText('已选 1 项')).toBeDefined();
    fireEvent.click(screen.getByText('取消选择'));
    expect(screen.queryByText('删除选中')).toBeNull();

    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByText('删除选中'));
    fireEvent.click(await screen.findByText('取消'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('reports partial batch delete failures', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], total: 2, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    await screen.findByText('A');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByText('删除选中'));
    fireEvent.click(screen.getByText('批量删除'));
    expect(await screen.findByText('已删除 1 项')).toBeDefined();
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('falls back one page after deleting the last row on a later page', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }], total: 30, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }], total: 30, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ items: [], total: 30, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 30, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    await screen.findByText('A');
    fireEvent.click(screen.getByText('下一页'));
    await screen.findByText('第 2 页');
    const deleteButton = await screen.findByRole('button', { name: '删除' });
    await waitFor(() => expect((deleteButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(deleteButton);
    fireEvent.click(await screen.findByText('确认删除'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'DELETE' }),
    ));
    expect(await screen.findByText('第 1 页')).toBeDefined();
  });

  it('exports the current resource as CSV with search', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice' }], total: 1, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.change(await screen.findByPlaceholderText('搜索...'), { target: { value: 'Alice' } });
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(expect.stringContaining('search=Alice')));
    fireEvent.click(screen.getByText('导出'));
    expect(vi.mocked(downloadCsv)).toHaveBeenCalledWith('patients', 'Alice');
  });

  it('renders paged endpoint reports with truncated notices', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [{ id: 's1', name: 'Alice' }],
      total: 250,
      page: 1,
      pageSize: 200,
      truncated: true,
    });
    render(<ResourcePage title="报表" endpoint="/stats/demo" />, { wrapper });
    expect(await screen.findByText('Alice')).toBeDefined();
    expect(screen.getByText('超过显示上限，仅显示部分数据')).toBeDefined();
  });

  it('steps back a page when the refreshed list omits items', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }], total: 30, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }], total: 30, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ total: 30, page: 2, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    await screen.findByText('A');
    fireEvent.click(screen.getByText('下一页'));
    await screen.findByText('第 2 页');
    const deleteButton = await screen.findByRole('button', { name: '删除' });
    await waitFor(() => expect((deleteButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(deleteButton);
    fireEvent.click(await screen.findByText('确认删除'));
    await waitFor(() => {
      expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('第 1 页')).toBeDefined();
  });

  it('shows the fallback message for non-Error query failures', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockRejectedValueOnce('boom');
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ResourcePage resource="patients" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('加载失败')).toBeDefined();
  });

  it('falls back to the resource name when the definition has no label', async () => {
    const noLabel = { ...writable, label: undefined };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([noLabel])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    expect(await screen.findByRole('heading', { name: 'patients' })).toBeDefined();
  });

  it('renders rows without ids using their index as the key', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ name: 'NoId' }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    expect(await screen.findByText('NoId')).toBeDefined();
  });

  it('renders truncated endpoint reports without an items array', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ truncated: true });
    render(<ResourcePage title="报表" endpoint="/stats/demo" />, { wrapper });
    expect(await screen.findByText('超过显示上限，仅显示部分数据')).toBeDefined();
    expect(screen.getByText('暂无数据')).toBeDefined();
  });

  it('round-trips number fields and renders invalid datetime values as blank', async () => {
    const typedResource = {
      name: 'typed',
      table: 'Typed',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'price', type: 'number' },
        { name: 'startTime', type: 'datetime' },
      ],
      capabilities: { create: true, update: true, delete: false, softDelete: false },
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([typedResource])
      .mockResolvedValueOnce({
        items: [{ id: 't1', name: 'Item', price: 12, startTime: 'not-a-date' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    render(<ResourcePage resource="typed" />, { wrapper });
    fireEvent.click(await screen.findByText('编辑'));
    expect((screen.getByLabelText('price') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('startTime') as HTMLInputElement).value).toBe('');
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 't1' } })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/typed/t1');
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
      expect(body.price).toBe(12);
      expect(body.startTime).toBeNull();
    });
  });

  it('guards batch delete when the selection is cleared before confirming', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    await screen.findByText('A');
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByText('删除选中'));
    fireEvent.click(screen.getByText('取消选择'));
    fireEvent.click(screen.getByRole('button', { name: '批量删除' }));
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'DELETE' }));
    expect(screen.getByRole('dialog', { name: '批量删除确认' })).toBeDefined();
  });

  it('uses the default report title when none is provided', async () => {
    vi.mocked(apiRequest).mockResolvedValue([]);
    render(<ResourcePage endpoint="/stats/demo" />, { wrapper });
    expect(await screen.findByRole('heading', { name: '报表' })).toBeDefined();
  });

  it('reports all-failed batch delete and keeps the confirmation open', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], total: 2, page: 1, pageSize: 20 })
      .mockRejectedValueOnce(new Error('first failed'))
      .mockRejectedValueOnce(new Error('second failed'))
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    await screen.findByText('A');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByText('删除选中'));
    fireEvent.click(screen.getByText('批量删除'));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.queryByText(/已删除 \d+ 项/)).toBeNull();
    expect(screen.getByRole('dialog', { name: '批量删除确认' })).toBeDefined();
  });

  it('unchecks a single selected row', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], total: 2, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    await screen.findByText('A');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText('已选 1 项')).toBeDefined();
    fireEvent.click(checkboxes[1]);
    expect(screen.queryByText('删除选中')).toBeNull();
  });

  it('renders a read-only report when the endpoint returns undefined', async () => {
    vi.mocked(apiRequest).mockResolvedValue(null);
    render(<ResourcePage title="报表" endpoint="/stats/demo" />, { wrapper });
    expect(await screen.findByText('暂无数据')).toBeDefined();
  });

  it('renders an empty state when the resource list omits items', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    expect(await screen.findByText('暂无记录')).toBeDefined();
  });
});
