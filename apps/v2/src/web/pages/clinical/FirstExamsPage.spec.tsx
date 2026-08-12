// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FirstExamsPage } from './FirstExamsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/firstExams?page=1&pageSize=50') {
      return {
        items: [{ id: 'f-1', patientId: 'p-1', doctorId: 'd-1', status: 'DRAFT', chiefComplaint: '牙痛' }],
        total: 1,
        page: 1,
        pageSize: 50,
      };
    }
    if (path === '/first-exams/tracking-overview') {
      return { NONE: 0, PENDING: 3, HORIZONTAL_SHOULD: 2, HORIZONTAL_DONE: 1, LOST: 2, total: 8, dueToday: 2 };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    if (path === '/resources/firstExamTeeth?examId=f-1&page=1&pageSize=200') {
      return {
        items: [
          { id: 't-1', examId: 'f-1', toothNumber: 16, toothStatus: 'CARIES', isChief: true, chiefMark: 'NONE' },
          { id: 't-2', examId: 'f-1', toothNumber: 26, toothStatus: 'HEALTHY', isChief: false, chiefMark: 'HORIZONTAL_SHOULD' },
        ],
        total: 2,
        page: 1,
        pageSize: 200,
      };
    }
    if (path === '/first-exams/history?patientId=p-1') {
      return [
        { id: 'f-1', patientId: 'p-1', status: 'DRAFT', followUpStatus: 'PENDING', dentition: 'DECIDUOUS', previousExamId: null, restartedAt: null, chiefComplaint: '牙痛', createdAt: '2026-08-01T02:00:00.000Z' },
        { id: 'f-0', patientId: 'p-1', status: 'COMPLETED', followUpStatus: 'NONE', dentition: 'PERMANENT', previousExamId: null, restartedAt: null, chiefComplaint: '旧主诉', createdAt: '2026-07-20T02:00:00.000Z' },
      ];
    }
    return {};
  });
}

describe('FirstExamsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('lists first exams and creates a new one with an optional consultant', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    expect(await screen.findByText('牙痛')).toBeDefined();

    fireEvent.click(screen.getByText('新建首诊'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('会诊医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '补牙' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'f-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/firstExams', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/firstExams' && (call[1] as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse(String((postCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      consultantId: 'd-1',
      chiefComplaint: '补牙',
    });
    expect(body.presentIllness).toBeUndefined();
    expect(await screen.findByText('首诊记录已创建')).toBeDefined();
  });

  it('validates required fields', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');
    fireEvent.click(screen.getByText('新建首诊'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者和医生')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/firstExams', expect.objectContaining({ method: 'POST' }));
  });

  it('transitions first exam status with a toast', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('变更首诊状态'), { target: { value: 'SUBMITTED' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/status', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'SUBMITTED' }),
      }));
    });
    expect(await screen.findByText('首诊状态已更新')).toBeDefined();
  });

  it('renders the tracking overview chips', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    expect(await screen.findByText('待跟进 3')).toBeDefined();
    expect(screen.getByText('需横向转诊 2')).toBeDefined();
    expect(screen.getByText('横向已转 1')).toBeDefined();
    expect(screen.getByText('已流失 2')).toBeDefined();
    expect(screen.getByText('今日应跟进 2')).toBeDefined();
  });

  it('marks a first exam as lost through the tracking dialog', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '追踪' }));
    fireEvent.change(await screen.findByLabelText('追踪状态'), { target: { value: 'LOST' } });
    fireEvent.change(await screen.findByLabelText('流失原因类型'), { target: { value: 'COST' } });
    fireEvent.change(screen.getByLabelText('流失原因'), { target: { value: '价格超出预算' } });
    fireEvent.change(screen.getByLabelText('追踪备注'), { target: { value: '电话回访确认流失' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/tracking', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find((call) => call[0] === '/first-exams/f-1/tracking');
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ followUpStatus: 'LOST', lossReasonType: 'COST', lossReason: '价格超出预算' });
    expect(await screen.findByText('追踪状态已更新')).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByLabelText('流失原因类型')).toBeNull();
    });
  });

  it('switches the dentition with a toast', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('切换牙列'), { target: { value: 'PERMANENT' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/dentition', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ dentition: 'PERMANENT' }),
      }));
    });
    expect(await screen.findByText('牙列已更新')).toBeDefined();
  });

  it('marks a chief tooth through the teeth dialog', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '牙齿标记' }));
    expect(await screen.findByText('16')).toBeDefined();
    fireEvent.change(await screen.findByLabelText('牙齿 16 主诉标记'), { target: { value: 'HORIZONTAL_DONE' } });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/teeth/t-1/chief-mark', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chiefMark: 'HORIZONTAL_DONE' }),
      }));
    });
    expect(await screen.findByText('牙齿 16 主诉标记已更新')).toBeDefined();
  });

  it('restarts a first exam after confirmation', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '重启检查' }));
    fireEvent.click(screen.getByRole('button', { name: '确认重启' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/first-exams/f-1/restart', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('首诊已重启')).toBeDefined();
  });

  it('shows the patient history through the history dialog', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '历史' }));
    expect(await screen.findByText('旧主诉')).toBeDefined();
    await waitFor(() => {
      expect(vi.mocked(apiRequest).mock.calls.some((call) => call[0] === '/first-exams/history?patientId=p-1')).toBe(true);
    });
  });

  it('edits a first exam with backfilled consultant and PATCH payload', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect((await screen.findByLabelText('主诉') as HTMLTextAreaElement).value).toBe('牙痛');
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('患者') as HTMLSelectElement).value).toBe('p-1');
    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('医生') as HTMLSelectElement).value).toBe('d-1');
    expect((screen.getByLabelText('会诊医生') as HTMLSelectElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '补牙' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'f-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/firstExams/f-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/firstExams/f-1' && (call[1] as RequestInit)?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ patientId: 'p-1', doctorId: 'd-1', chiefComplaint: '补牙' });
    expect(body.consultantId).toBeUndefined();
    expect(await screen.findByText('首诊记录已更新')).toBeDefined();
  });

  it('deletes a first exam after confirmation', async () => {
    mockData();
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/firstExams/f-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('首诊记录已删除')).toBeDefined();
  });

  it('reports create, update and delete failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/resources/firstExams') throw new Error('');
      if (method === 'PATCH' && path === '/resources/firstExams/f-1') throw new Error('');
      if (method === 'DELETE' && path === '/resources/firstExams/f-1') throw new Error('');
      return base?.(path, init);
    });
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByText('新建首诊'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('创建首诊失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByLabelText('主诉');
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '补牙' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('更新失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(await screen.findByText('删除失败')).toBeDefined();
  });

  it('reports status, dentition and restart failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/first-exams/f-1/status') throw new Error('');
      if (method === 'POST' && path === '/first-exams/f-1/dentition') throw new Error('');
      if (method === 'POST' && path === '/first-exams/f-1/restart') throw new Error('');
      return base?.(path, init);
    });
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.change(await screen.findByLabelText('变更首诊状态'), { target: { value: 'SUBMITTED' } });
    expect(await screen.findByText('状态更新失败')).toBeDefined();
    fireEvent.change(screen.getByLabelText('切换牙列'), { target: { value: 'PERMANENT' } });
    expect(await screen.findByText('牙列更新失败')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重启检查' }));
    fireEvent.click(screen.getByRole('button', { name: '确认重启' }));
    expect(await screen.findByText('重启检查失败')).toBeDefined();
  });

  it('reports tracking and teeth mark failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/first-exams/f-1/tracking') throw new Error('');
      if (method === 'POST' && path === '/first-exams/f-1/teeth/t-1/chief-mark') throw new Error('');
      return base?.(path, init);
    });
    render(<FirstExamsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '追踪' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存' }));
    expect(await screen.findByText('更新失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '牙齿标记' }));
    const select = await screen.findByLabelText('牙齿 16 主诉标记');
    fireEvent.change(select, { target: { value: 'HORIZONTAL_DONE' } });
    expect(await screen.findByText('主诉标记更新失败')).toBeDefined();
  });

  it('closes the teeth, history and restart dialogs through cancel paths', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/firstExams?page=1&pageSize=50') {
        return { items: [{ id: 'fe-1', patientId: 'p-1', status: 'DRAFT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 200 };
      if (path === '/doctors') return [];
      if (path === '/first-exams/overview') return { total: 0, today: 0, pending: 0 };
      return {};
    });
    render(<FirstExamsPage />, { wrapper });
    await screen.findByLabelText('变更首诊状态');

    fireEvent.click(screen.getByRole('button', { name: '牙齿标记' }));
    expect(await screen.findByRole('dialog', { name: '主诉牙齿标记' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '主诉牙齿标记' })).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '历史' }));
    expect(await screen.findByRole('dialog', { name: '首诊历史' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '首诊历史' })).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '重启检查' }));
    expect(await screen.findByRole('dialog', { name: '重启检查' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '重启检查' })).toBeNull();
    });
    expect(apiRequest).not.toHaveBeenCalledWith('/first-exams/fe-1/restart', expect.anything());
  });

  it('edits a sparse first exam with blank fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/firstExams?page=1&pageSize=50') {
        return { items: [{ id: 'fe-9', patientId: null, doctorId: null, consultantId: null, status: null }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 200 };
      if (path === '/doctors') return [];
      if (path === '/first-exams/overview') return { total: 0, today: 0, pending: 0 };
      return {};
    });
    render(<FirstExamsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect(await screen.findByLabelText('主诉')).toBeDefined();
    expect((screen.getByLabelText('患者') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('医生') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('主诉') as HTMLTextAreaElement).value).toBe('');
  });

  it('resets the status and dentition selects without calling the API', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/firstExams?page=1&pageSize=50') {
        return { items: [{ id: 'fe-1', patientId: 'p-1', status: 'DRAFT', dentition: 'PERMANENT' }], total: 1, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 200 };
      if (path === '/doctors') return [];
      if (path === '/first-exams/overview') return { total: 0, today: 0, pending: 0 };
      return {};
    });
    render(<FirstExamsPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('变更首诊状态'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('切换牙列'), { target: { value: '' } });
    expect(apiRequest).not.toHaveBeenCalledWith('/first-exams/fe-1/status', expect.anything());
    expect(apiRequest).not.toHaveBeenCalledWith('/first-exams/fe-1/dentition', expect.anything());
  });
});
