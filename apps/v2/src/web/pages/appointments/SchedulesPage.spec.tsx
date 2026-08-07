// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SchedulesPage } from './SchedulesPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

const templates = [
  { id: 't-1', name: '早班', startTime: '09:00', endTime: '18:00', workDaysJson: '[1,2,3,4,5]', workDays: [1, 2, 3, 4, 5], color: '#4F46E5', active: 1 },
  { id: 't-2', name: '周末班', startTime: '10:00', endTime: '19:00', workDaysJson: '[6,7]', workDays: [6, 7], color: null, active: 0 },
];

const users = {
  items: [{ id: 'user-doctor-001', name: '张医生' }],
  total: 1,
  page: 1,
  pageSize: 100,
};

const weekRows = [
  { id: 'w-1', userId: 'user-doctor-001', userIdLabel: '张医生', title: '早班', color: '#4F46E5', weekDay: 1, startTime: '2026-08-03T09:00:00', endTime: '2026-08-03T18:00:00', type: 'FIXED', date: '2026-08-03' },
];

function mockLookups(options?: {
  templates?: typeof templates;
  users?: { items: typeof users.items; total: number; page: number; pageSize: number };
  weekRows?: typeof weekRows;
}) {
  const templateData = options?.templates ?? templates;
  const userData = options?.users ?? users;
  const weekData = options?.weekRows ?? weekRows;
  vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit & { _retry?: boolean }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === '/shift-templates/generate') return { created: 3, skipped: 2, weekStart: '2026-08-03' };
    if (path === '/shift-templates' && method === 'POST') return { id: 't-new' };
    if (path === '/shift-templates' && method === 'GET') return templateData;
    if (path === '/resources/users?page=1&pageSize=100') return userData;
    if (path.startsWith('/schedules/week?weekStart=')) return weekData;
    if (path.startsWith('/shift-templates/') && method === 'PATCH') return { id: path.split('/').pop() };
    return {};
  });
}

describe('SchedulesPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders the header and template list with work day labels and status', async () => {
    mockLookups();
    render(<SchedulesPage />, { wrapper });
    expect(await screen.findByText('排班中心')).toBeDefined();
    expect(screen.getAllByText('班次模板').length).toBeGreaterThan(0);
    expect(await screen.findByText('周末班')).toBeDefined();
    expect(screen.getAllByText('早班').length).toBeGreaterThan(0);
    expect(screen.getAllByText('09:00 - 18:00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('周一~周五').length).toBeGreaterThan(0);
    expect(screen.getAllByText('周六~周日').length).toBeGreaterThan(0);
    expect(screen.getAllByText('启用').length).toBeGreaterThan(0);
    expect(screen.getAllByText('停用').length).toBeGreaterThan(0);
  });

  it('creates a template with the expected POST body', async () => {
    mockLookups();
    render(<SchedulesPage />, { wrapper });
    await screen.findByText('排班中心');

    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '晚班' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '13:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByLabelText('工作日 周一'));
    fireEvent.click(screen.getByLabelText('工作日 周二'));
    fireEvent.click(screen.getByLabelText('工作日 周三'));
    fireEvent.click(screen.getByLabelText('工作日 周四'));
    fireEvent.click(screen.getByLabelText('工作日 周五'));
    fireEvent.click(screen.getByLabelText('工作日 周六'));
    fireEvent.click(screen.getByLabelText('工作日 周日'));
    fireEvent.change(screen.getByLabelText('颜色'), { target: { value: '#10b981' } });
    fireEvent.click(screen.getByRole('button', { name: '新增模板' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/shift-templates', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/shift-templates' && init?.method === 'POST',
    );
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({ name: '晚班', startTime: '13:00', endTime: '22:00', color: '#10b981', active: true });
    expect(body.workDaysJson).toEqual([6, 7]);
    expect(await screen.findByText('班次模板已创建')).toBeDefined();
  });

  it('toggles template active with PATCH', async () => {
    mockLookups();
    render(<SchedulesPage />, { wrapper });
    await screen.findByText('排班中心');
    await screen.findByText('周末班');
    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/shift-templates/t-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/shift-templates/t-1' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ active: false });
    expect(await screen.findByText('模板状态已更新')).toBeDefined();
  });

  it('generates fixed schedules with the expected POST body and success toast', async () => {
    mockLookups();
    render(<SchedulesPage />, { wrapper });
    await screen.findByText('排班中心');
    await waitFor(() => {
      expect((screen.getByLabelText('选择用户') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('选择用户'), { target: { value: 'user-doctor-001' } });
    fireEvent.change(screen.getByLabelText('选择模板'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('选择周'), { target: { value: '2026-08-03' } });
    fireEvent.click(screen.getByRole('button', { name: '生成固定排班' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/shift-templates/generate', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(
      ([path, init]) => path === '/shift-templates/generate' && init?.method === 'POST',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      templateId: 't-1',
      userId: 'user-doctor-001',
      weekStart: '2026-08-03',
    });
    expect(await screen.findByText('已生成 3 条固定排班，跳过 2 条已存在')).toBeDefined();
  });

  it('renders the week view table', async () => {
    mockLookups({ templates: [], users: { items: [], total: 0, page: 1, pageSize: 100 }, weekRows });
    render(<SchedulesPage />, { wrapper });
    expect(await screen.findByText('2026-08-03（周一）')).toBeDefined();
    expect(screen.getByText('张医生')).toBeDefined();
    expect(screen.getByText('早班')).toBeDefined();
    expect(screen.getByText('09:00 - 18:00')).toBeDefined();
    expect(screen.getAllByText('固定排班').length).toBeGreaterThanOrEqual(2);
  });

  it('renders an empty state when the week has no schedules', async () => {
    mockLookups({ weekRows: [] });
    render(<SchedulesPage />, { wrapper });
    expect(await screen.findByText('本周暂无排班')).toBeDefined();
  });
});
