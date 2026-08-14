// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VisitsPage } from './VisitsPage';
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

  it('shows loading, error, and empty states', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<VisitsPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('visits failed'));
    render(<VisitsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    render(<VisitsPage />, { wrapper });
    expect(await screen.findByText('暂无就诊')).toBeDefined();
  });

  it('keeps the visit when delete confirmation is cancelled', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith(
      '/resources/visits/v-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('reports create, update and delete failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && path === '/resources/visits') throw new Error('');
      if (method === 'PATCH' && path === '/resources/visits/v-1') throw new Error('');
      if (method === 'DELETE' && path === '/resources/visits/v-1') throw new Error('');
      return base?.(path, init);
    });
    render(<VisitsPage />, { wrapper });
    await screen.findByText('牙痛');

    fireEvent.click(screen.getByText('新建就诊'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('创建就诊失败')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByLabelText('主诉');
    fireEvent.change(screen.getByLabelText('主诉'), { target: { value: '补牙' } });
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('更新失败')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByText('确认删除'));
    expect(await screen.findByText('删除失败')).toBeDefined();
  });

  it('reports status transition failures', async () => {
    mockData();
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/visits/v-1/status' && String(init?.method ?? 'GET').toUpperCase() === 'PATCH') throw new Error('');
      return base?.(path, init);
    });
    render(<VisitsPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('变更就诊状态'), { target: { value: 'COMPLETED' } });
    expect(await screen.findByText('状态更新失败')).toBeDefined();
  });

  it('renders sparse rows and unknown statuses', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/visits?page=1&pageSize=50') {
        return {
          items: [
            { id: 'v-9', patientIdLabel: null, patientId: 'p-9', doctorIdLabel: null, doctorId: null, startTime: null, status: 'WEIRD', chiefComplaint: null },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      return {};
    });
    render(<VisitsPage />, { wrapper });
    expect(await screen.findByText('p-9')).toBeDefined();
    expect(screen.getByText('WEIRD')).toBeDefined();
  });

  it('edits a sparse visit with blank fallbacks', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/visits?page=1&pageSize=50') {
        return {
          items: [{ id: 'v-9', patientId: null, doctorId: null, startTime: null, endTime: null, status: null, chiefComplaint: null }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/patients?page=1&pageSize=100') return { items: [], total: 0, page: 1, pageSize: 200 };
      if (path === '/doctors') return [];
      return {};
    });
    render(<VisitsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect(await screen.findByLabelText('开始时间')).toBeDefined();
    expect((screen.getByLabelText('患者') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('医生') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('主诉') as HTMLTextAreaElement).value).toBe('');
  });

  it('submits an end time with the create payload', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    await screen.findByText('牙痛');
    fireEvent.click(screen.getByText('新建就诊'));
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-08-05T10:00' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'v-2' });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      const postCall = vi.mocked(apiRequest).mock.calls.find(
        (call) => call[0] === '/resources/visits' && (call[1] as RequestInit)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(String((postCall?.[1] as RequestInit)?.body));
      expect(body.endTime).toBe(new Date('2026-08-05T10:00').toISOString());
    });
  });

  it('resets the status select without transitioning', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    const select = await screen.findByLabelText('变更就诊状态');
    fireEvent.change(select, { target: { value: '' } });
    expect(apiRequest).not.toHaveBeenCalledWith('/visits/v-1/status', expect.anything());
  });

  it('falls back to ids for unnamed doctors', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/visits?page=1&pageSize=50') {
        return {
          items: [{ id: 'v-1', patientId: 'p-1', doctorId: 'd-9', startTime: '2026-08-04T09:00:00.000Z', status: 'IN_PROGRESS', chiefComplaint: '牙痛' }],
          total: 1,
          page: 1,
          pageSize: 50,
        };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-9' }];
      return {};
    });
    render(<VisitsPage />, { wrapper });
    await screen.findByText('牙痛');
    fireEvent.click(screen.getByText('新建就诊'));
    await waitFor(() => {
      expect((screen.getByRole('option', { name: 'd-9' }) as HTMLOptionElement).value).toBe('d-9');
    });
  });

  it('ignores a second status transition while the first is in flight', async () => {
    mockData();
    render(<VisitsPage />, { wrapper });
    await screen.findByText('牙痛');
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/visits/v-1/status') return new Promise(() => {});
      return {};
    });
    const select = screen.getByLabelText('变更就诊状态') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'COMPLETED' } });
    fireEvent.change(select, { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => {
      const calls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/visits/v-1/status');
      expect(calls).toHaveLength(1);
    });
  });
});
