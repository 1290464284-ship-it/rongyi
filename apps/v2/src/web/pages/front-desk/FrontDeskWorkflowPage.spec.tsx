// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FrontDeskWorkflowPage } from './FrontDeskWorkflowPage';
import { apiRequest, fetchAllPages } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), fetchAllPages: vi.fn(), downloadCsv: vi.fn() }));

vi.mocked(fetchAllPages).mockImplementation(async (path: string) => {
  const data = await vi.mocked(apiRequest)(path) as { items?: unknown[] } | unknown[];
  return Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? [];
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/registrations?page=1&pageSize=100') {
      return {
        items: [
          { id: 'r-1', status: 'REGISTERED', patientId: 'p-1', patientIdLabel: '张三' },
          { id: 'r-2', status: 'TRIAGED', patientId: 'p-2', patientIdLabel: '赵六' },
        ],
        total: 2,
      };
    }
    if (path === '/resources/departments?page=1&pageSize=100') {
      return { items: [{ id: 'dep-1', name: '正畸科' }, { id: 'dep-2', name: '种植科' }], total: 2 };
    }
    if (path === '/triage/queue') {
      return {
        items: [
          {
            id: 'q-1',
            patientName: '李四',
            departmentName: '正畸科',
            doctorName: '张医生',
            status: 'REGISTERED',
            registeredAt: '2026-08-06T01:00:00.000Z',
            triagedAt: null,
          },
        ],
        total: 1,
      };
    }
    if (path.startsWith('/triage/queue?departmentId=')) {
      return { items: [], total: 0 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    return {};
  });
}

describe('FrontDeskWorkflowPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders registration rows with triage actions for the front desk', async () => {
    mockData();
    render(<FrontDeskWorkflowPage />, { wrapper });
    expect(await screen.findByText('挂号分诊工作台')).toBeDefined();
    expect(await screen.findByText('张三')).toBeDefined();
    expect(screen.getByText('分诊队列')).toBeDefined();
    expect(screen.getByText('赵六')).toBeDefined();
    expect(screen.getAllByRole('button', { name: '分诊' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '划价' }).length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll('.triage-badge')).toHaveLength(1);
  });

  it('transitions a REGISTERED registration to TRIAGED', async () => {
    mockData();
    render(<FrontDeskWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '已分诊' }))[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/r-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/registrations/r-1/status');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ status: 'TRIAGED' });
    expect(await screen.findByText(/挂号已更新为/)).toBeDefined();
  });

  it('submits a triage from the registration row', async () => {
    mockData();
    render(<FrontDeskWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '分诊' }))[0]);

    await waitFor(() => {
      expect((screen.getByLabelText('分诊科室') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('分诊科室'), { target: { value: 'dep-1' } });
    fireEvent.change(screen.getByLabelText('分诊医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('分诊备注'), { target: { value: '牙体牙髓' } });
    fireEvent.click(screen.getByText('提交分诊'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/r-1/triage', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/registrations/r-1/triage');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({ departmentId: 'dep-1', doctorId: 'd-1', triageNote: '牙体牙髓' });
    expect(await screen.findByText('分诊已提交')).toBeDefined();
  });

  it('submits a charge from the registration row', async () => {
    mockData();
    render(<FrontDeskWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '划价' }))[0]);

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '洁牙' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'GENERAL' } });
    fireEvent.change(screen.getByLabelText('单价(元)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('提交划价'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/charges', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/charges');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      items: [{ name: '洁牙', category: 'GENERAL', price: 10000, quantity: 2 }],
    });
    expect(await screen.findByText('划价已提交')).toBeDefined();
  });

  it('renders the triage queue with department filter and start visit', async () => {
    mockData();
    render(<FrontDeskWorkflowPage />, { wrapper });
    expect(await screen.findByText('李四')).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: '开始就诊' })[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/q-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/registrations/q-1/status');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ status: 'IN_PROGRESS' });

    fireEvent.change(screen.getByLabelText('科室筛选'), { target: { value: 'dep-1' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/triage/queue?departmentId=dep-1');
    });
  });

  it('opens and closes the follow-up dialog from a registration row', async () => {
    mockData();
    render(<FrontDeskWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '回访' }))[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('新建回访')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('reports registration status transition failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/registrations/r-1/status' && String(init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        throw new Error('');
      }
      if (path === '/resources/registrations?page=1&pageSize=100') {
        return { items: [{ id: 'r-1', status: 'REGISTERED', patientId: 'p-1', patientIdLabel: '张三' }], total: 1 };
      }
      if (path === '/triage/queue') return { items: [], total: 0 };
      return {};
    });
    render(<FrontDeskWorkflowPage />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '已分诊' }))[0]);
    expect(await screen.findByText('状态更新失败')).toBeDefined();
  });

  it('moves a registration card between kanban columns', async () => {
    mockData();
    render(<FrontDeskWorkflowPage />, { wrapper });
    await screen.findByText('张三');
    const dataTransfer = { setData: vi.fn(), getData: () => 'r-1' };
    const card = screen.getByText('张三').closest('.ui-kanban-card') as HTMLElement;
    const doneColumn = screen.getByText('已完成').closest('.ui-kanban-col') as HTMLElement;
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(doneColumn, { dataTransfer });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/registrations/r-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/registrations/r-1/status');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ status: 'COMPLETED' });
  });

  it('renders unknown registration statuses without transition buttons', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') {
        return { items: [{ id: 'r-x', status: 'WEIRD', patientId: 'p-x' }], total: 1 };
      }
      if (path === '/triage/queue') return { items: [], total: 0 };
      return {};
    });
    render(<FrontDeskWorkflowPage />, { wrapper });
    expect(await screen.findByText('p-x')).toBeDefined();
    expect(screen.getByText('WEIRD')).toBeDefined();
    expect(screen.queryByRole('button', { name: '分诊' })).toBeNull();
  });

  it('ignores board transitions while the registration list is stale', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') {
        return { items: [{ id: 'r-1', status: 'REGISTERED', patientId: 'p-1', patientIdLabel: '张三' }], total: 150 };
      }
      if (path === '/resources/registrations?page=2&pageSize=100') return new Promise(() => {});
      if (path === '/triage/queue') return { items: [], total: 0 };
      return {};
    });
    render(<FrontDeskWorkflowPage />, { wrapper });
    await screen.findByText('张三');
    fireEvent.click(screen.getAllByRole('button', { name: '下一页' })[0]);
    await waitFor(() => {
      expect((screen.getAllByRole('button', { name: '下一页' })[0] as HTMLButtonElement).disabled).toBe(true);
    });
    const dataTransfer = { setData: vi.fn(), getData: () => 'r-1' };
    const card = screen.getByText('张三').closest('.ui-kanban-card') as HTMLElement;
    const doneColumn = screen.getByText('已完成').closest('.ui-kanban-col') as HTMLElement;
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(doneColumn, { dataTransfer });
    await waitFor(() => {
      expect(apiRequest).not.toHaveBeenCalledWith('/registrations/r-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('ignores same-tick duplicate transition clicks', async () => {
    const pending: Array<() => void> = [];
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/registrations?page=1&pageSize=100') {
        return { items: [{ id: 'r-1', status: 'REGISTERED', patientId: 'p-1', patientIdLabel: '张三' }], total: 1 };
      }
      if (path === '/triage/queue') return { items: [], total: 0 };
      if (path === '/registrations/r-1/status') {
        return new Promise((resolve) => { pending.push(() => resolve({})); });
      }
      return {};
    });
    render(<FrontDeskWorkflowPage />, { wrapper });
    const button = (await screen.findAllByRole('button', { name: '已分诊' }))[0];
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    const calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/registrations/r-1/status');
    expect(calls).toHaveLength(1);
    pending.forEach((resolve) => resolve());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });
});
