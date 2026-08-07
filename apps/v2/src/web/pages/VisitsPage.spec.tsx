// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VisitsPage } from './VisitsPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function mockData() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/visits?page=1&pageSize=50') {
      return {
        items: [{ id: 'v-1', patientId: 'p-1', doctorId: 'd-1', startTime: '2026-08-04T09:00:00.000Z', status: 'IN_PROGRESS', chiefComplaint: '牙痛' }],
        total: 1,
        page: 1,
        pageSize: 50,
      };
    }
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
    return {};
  });
}

describe('VisitsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('lists visits and creates a new visit with an ISO payload', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    expect(await screen.findByText('牙痛')).toBeDefined();

    fireEvent.click(screen.getByText('新建就诊'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '补牙' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'v-2' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/visits', expect.objectContaining({ method: 'POST' }));
    });
    const postCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/visits' && (call[1] as RequestInit)?.method === 'POST',
    );
    const body = JSON.parse(String((postCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      startTime: new Date('2026-08-05T09:00').toISOString(),
      status: 'IN_PROGRESS',
      chiefComplaint: '补牙',
    });
    expect(body.endTime).toBeUndefined();
    expect(await screen.findByText('就诊记录已创建')).toBeDefined();
  });

  it('validates required fields', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    await screen.findByText('牙痛');
    fireEvent.click(screen.getByText('新建就诊'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('请选择患者、医生并填写开始时间')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/visits', expect.objectContaining({ method: 'POST' }));
  });

  it('transitions visit status with a toast', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('变更就诊状态'), { target: { value: 'COMPLETED' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/visits/v-1/status', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      }));
    });
    expect(await screen.findByText('就诊状态已更新')).toBeDefined();
  });

  it('edits a visit with backfilled form and PATCH payload', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const startInput = (await screen.findByLabelText('开始时间')) as HTMLInputElement;
    const d = new Date('2026-08-04T09:00:00.000Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    const expectedLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(startInput.value).toBe(expectedLocal);
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('患者') as HTMLSelectElement).value).toBe('p-1');
    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    expect((screen.getByLabelText('医生') as HTMLSelectElement).value).toBe('d-1');
    expect((screen.getByLabelText('主诉') as HTMLTextAreaElement).value).toBe('牙痛');
    expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('IN_PROGRESS');

    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '牙痛加剧' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'v-1' });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/visits/v-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      (call) => call[0] === '/resources/visits/v-1' && (call[1] as RequestInit)?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ patientId: 'p-1', doctorId: 'd-1', chiefComplaint: '牙痛加剧' });
    expect(body.startTime).toBe(new Date(expectedLocal).toISOString());
    expect(await screen.findByText('就诊记录已更新')).toBeDefined();
  });

  it('deletes a visit after confirmation', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/visits/v-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('就诊记录已删除')).toBeDefined();
  });
});
