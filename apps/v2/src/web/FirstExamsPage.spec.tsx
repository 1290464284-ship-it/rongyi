// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FirstExamsPage } from './FirstExamsPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

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
      status: 'DRAFT',
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
});
