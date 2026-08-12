// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentsPage } from './AppointmentsPage';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

const appointmentList = {
  items: [
    { id: 'a-1', patientId: 'p-1', doctorId: 'd-1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' },
    { id: 'a-2', patientId: 'p-2', doctorId: 'd-2', startTime: null, status: null },
    { id: 'a-3', patientId: 'p-3', doctorId: 'd-3', startTime: '2026-08-04T10:00:00.000Z', status: 'UNKNOWN' },
  ],
  total: 3,
  page: 1,
  pageSize: 20,
};

function mockLookups() {
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/resources/appointments?page=1&pageSize=20') return appointmentList;
    if (path === '/resources/patients?page=1&pageSize=100') {
      return { items: [{ id: 'p-1', name: '患者甲' }, { id: 'p-2' }], total: 2, page: 1, pageSize: 200 };
    }
    if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }, { id: 'd-2' }];
    if (path === '/resources/chairs?page=1&pageSize=100') {
      return { items: [{ id: 'c-1', name: '椅位 1' }, { id: 'c-2' }], total: 2, page: 1, pageSize: 200 };
    }
    if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
      return { items: [{ id: 'purpose-1', name: '复诊检查', active: 1 }, { id: 'purpose-2', name: '种植咨询', active: 1 }], total: 2, page: 1, pageSize: 100 };
    }
    return {};
  });
}

describe('AppointmentsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders appointments and creates one with selectors', { timeout: 10_000 }, async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    expect(await screen.findByText('预约管理')).toBeDefined();

await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
await waitFor(() => {
      expect((screen.getByLabelText('椅位') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('椅位'), { target: { value: 'c-1' } });
    fireEvent.change(screen.getByLabelText('预约类型'), { target: { value: 'EMERGENCY' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-08-05T10:00' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'a-new' });
    fireEvent.click(screen.getByRole('button', { name: '创建预约' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/appointments', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('预约已创建')).toBeDefined();
  });

  it('shows a loading state while appointments are loading', () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<AppointmentsPage />, { wrapper });
    expect(screen.getByText('加载中...')).toBeDefined();
  });

  it('applies initialSearch from a deep link', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20&search=%E5%BC%A0%E4%B8%89') {
        return { items: [{ id: 'a-9', patientId: 'p-9', doctorId: 'd-9', startTime: null, status: null }], total: 1, page: 1, pageSize: 20 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-9', name: '患者九' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-9', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<AppointmentsPage initialSearch="张三" />, { wrapper });
    expect(await screen.findByText('预约管理')).toBeDefined();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointments?page=1&pageSize=20&search=%E5%BC%A0%E4%B8%89');
    });
    expect((screen.getByLabelText('搜索预约') as HTMLInputElement).value).toBe('张三');
  });

  it('shows an error when appointments fail to load', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') throw new Error('appointments failed');
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<AppointmentsPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('renders an empty state when no appointments are returned', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') return null as unknown as typeof appointmentList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<AppointmentsPage />, { wrapper });
    expect(await screen.findByText('暂无预约')).toBeDefined();
  });

  it('validates required fields before creating an appointment', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click(screen.getByRole('button', { name: '创建预约' }));
    expect(await screen.findByText('请选择患者、医生并填写开始和结束时间')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/appointments', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects an appointment whose end time is not later than start time', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T10:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: '创建预约' }));

    expect(await screen.findByText('结束时间必须晚于开始时间')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/appointments', expect.objectContaining({ method: 'POST' }));
  });

  it('does not delete when the confirmation is cancelled', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '删除' }))[0]);
    fireEvent.click(screen.getByText('取消'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiRequest).not.toHaveBeenCalledWith(
      '/resources/appointments/a-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('transitions appointment status', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    const statusSelect = (await screen.findAllByLabelText('变更预约状态'))[0];
    fireEvent.change(statusSelect, { target: { value: 'ARRIVED' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/appointments/a-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('reports create and transition failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') return appointmentList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      throw new Error('appointment failed');
    });

    render(<AppointmentsPage />, { wrapper });
await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(await screen.findByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-08-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '创建预约' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.change((await screen.findAllByLabelText('变更预约状态'))[0], { target: { value: 'ARRIVED' } });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
  });
  it('renders relation labels instead of raw ids when present', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return {
          items: [
            { id: 'a-1', patientId: 'p-9', doctorId: 'd-9', patientIdLabel: '李患者', doctorIdLabel: '王医生', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' },
            { id: 'a-2', patientId: 'p-9', doctorId: 'd-9', startTime: '2026-08-04T10:00:00.000Z', status: 'BOOKED' },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<AppointmentsPage />, { wrapper });
    expect(await screen.findByText('李患者')).toBeDefined();
    expect(screen.getByText('王医生')).toBeDefined();
    expect(screen.getByText('p-9')).toBeDefined();
    expect(screen.getByText('d-9')).toBeDefined();
  });

  it('creates an appointment for a temp patient without patientId', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    await waitFor(() => {
      expect((screen.getByLabelText('医生') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('临时患者姓名'), { target: { value: '临时甲' } });
    fireEvent.change(screen.getByLabelText('临时患者电话'), { target: { value: '13900000000' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-08-05T10:00' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'a-temp' });
    fireEvent.click(screen.getByRole('button', { name: '创建预约' }));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/appointments');
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}')) as Record<string, unknown>;
      expect(body.tempPatientName).toBe('临时甲');
      expect(body.tempPatientPhone).toBe('13900000000');
      expect(body.patientId).toBeUndefined();
    });
  });

  it('renders appointment purposes and sends the selected purpose', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    await waitFor(() => {
      const select = screen.getByLabelText('预约事项') as HTMLSelectElement;
      expect(select.options.length).toBeGreaterThan(1);
      expect(Array.from(select.options).map((option) => option.textContent)).toEqual(expect.arrayContaining(['复诊检查', '种植咨询']));
    });
    fireEvent.change(screen.getByLabelText('预约事项'), { target: { value: 'purpose-1' } });
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-08-05T10:00' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'a-purpose' });
    fireEvent.click(screen.getByRole('button', { name: '创建预约' }));
    await waitFor(() => {
      const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/appointments');
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}')) as Record<string, unknown>;
      expect(body.purpose).toBe('purpose-1');
    });
  });

  it('shows purpose and temp patient name in the list', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return {
          items: [
            { id: 'a-1', patientId: 'p-1', patientIdLabel: '患者甲', doctorId: 'd-1', purpose: '洁牙护理', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' },
            { id: 'a-2', tempPatientName: '临时乙', doctorId: 'd-2', startTime: null, status: 'BOOKED' },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }, { id: 'd-2' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [{ id: 'purpose-1', name: '事项甲', active: 1 }], total: 1, page: 1, pageSize: 100 };
      }
      return {};
    });
    render(<AppointmentsPage />, { wrapper });
    expect(await screen.findByText('洁牙护理')).toBeDefined();
    expect(screen.getByText('临时乙')).toBeDefined();
  });

  it('adds an appointment purpose through the management panel', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.change(screen.getByLabelText('新事项名称'), { target: { value: '初诊检查' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'purpose-new' });
    fireEvent.click(screen.getByRole('button', { name: '添加事项' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointmentPurposes', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/appointmentPurposes');
    const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}')) as Record<string, unknown>;
    expect(body.name).toBe('初诊检查');
    expect(await screen.findByText('事项已添加')).toBeDefined();
  });

  it('toggles an appointment purpose active state', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    const toggleButtons = await screen.findAllByRole('button', { name: '停用' });
    fireEvent.click(toggleButtons[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointmentPurposes/purpose-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/appointmentPurposes/purpose-1');
    const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body ?? '{}')) as Record<string, unknown>;
    expect(body.active).toBe(false);
  });

  it('edits an existing appointment', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[2]);
    const startInputs = screen.getAllByLabelText('开始时间');
    const endInputs = screen.getAllByLabelText('结束时间');
    fireEvent.change(startInputs[startInputs.length - 1], { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(endInputs[endInputs.length - 1], { target: { value: '2026-08-05T10:00' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'a-1' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointments/a-1', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('does not save an edit while the appointment list is stale', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[2]);
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.change(screen.getByLabelText('搜索预约'), { target: { value: 'stale' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointments?page=1&pageSize=20&search=stale');
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(vi.mocked(apiRequest).mock.calls.some(([path, options]) =>
      path === '/resources/appointments/a-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
    )).toBe(false);
  });

  it('deletes an appointment after confirmation', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '删除' }))[2]);
    const confirmButtons = screen.getAllByRole('button', { name: '删除' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointments/a-1', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  it('reports create and transition failures with fallback messages', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/appointments?page=1&pageSize=20') return appointmentList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (method === 'POST' && path === '/appointments') throw new Error('');
      if (method === 'PATCH' && path === '/appointments/a-1/status') throw new Error('');
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    await waitFor(() => {
      expect((screen.getByLabelText('患者') as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p-1' } });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-08-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '创建预约' }));
    expect(await screen.findByText('创建预约失败')).toBeDefined();

    fireEvent.change((await screen.findAllByLabelText('变更预约状态'))[0], { target: { value: 'ARRIVED' } });
    expect(await screen.findByText('状态更新失败')).toBeDefined();
  });

  it('validates the edit form before saving', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    const editButtons = await screen.findAllByRole('button', { name: '编辑' });
    fireEvent.click(editButtons[editButtons.length - 1]);

    const doctorSelects = screen.getAllByLabelText('医生');
    fireEvent.change(doctorSelects[doctorSelects.length - 1], { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('请选择医生并填写开始和结束时间')).toBeDefined();

    fireEvent.change(doctorSelects[doctorSelects.length - 1], { target: { value: 'd-1' } });
    const startInputs = screen.getAllByLabelText('开始时间');
    const endInputs = screen.getAllByLabelText('结束时间');
    fireEvent.change(startInputs[startInputs.length - 1], { target: { value: '2026-08-05T10:00' } });
    fireEvent.change(endInputs[endInputs.length - 1], { target: { value: '2026-08-05T09:00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('结束时间必须晚于开始时间')).toBeDefined();
  });

  it('reports edit and delete failures with fallback messages', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/appointments?page=1&pageSize=20') return appointmentList;
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      if (method === 'PATCH' && path === '/resources/appointments/a-1') throw new Error('');
      if (method === 'DELETE' && path === '/resources/appointments/a-1') throw new Error('');
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[0]);
    const startInputs = screen.getAllByLabelText('开始时间');
    const endInputs = screen.getAllByLabelText('结束时间');
    fireEvent.change(startInputs[startInputs.length - 1], { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(endInputs[endInputs.length - 1], { target: { value: '2026-08-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('更新预约失败')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '编辑预约' })).toBeNull();
    });
    fireEvent.click((await screen.findAllByRole('button', { name: '删除' }))[0]);
    const confirmButtons = screen.getAllByRole('button', { name: '删除' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(await screen.findByText('删除预约失败')).toBeDefined();
  });

  it('fetches the raw temp phone when editing an appointment', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return {
          items: [{
            id: 'a-1',
            patientId: 'p-1',
            doctorId: 'd-1',
            tempPatientPhone: '138****0000',
            startTime: '2026-08-04T09:00:00.000Z',
            status: 'BOOKED',
          }],
          total: 1,
          page: 1,
          pageSize: 20,
        };
      }
      if (path === '/resources/appointments/a-1') return { id: 'a-1', tempPatientPhone: '13800000000' };
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    const editButtons = await screen.findAllByRole('button', { name: '编辑' });
    fireEvent.click(editButtons[editButtons.length - 1]);
    const phoneInputs = screen.getAllByLabelText('临时患者电话');
    await waitFor(() => {
      expect((phoneInputs[phoneInputs.length - 1] as HTMLInputElement).value).toBe('13800000000');
    });
  });

  it('paginates appointments', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return { items: appointmentList.items, total: 21, page: 1, pageSize: 20 };
      }
      if (path === '/resources/appointments?page=2&pageSize=20') {
        return { items: [], total: 21, page: 2, pageSize: 20 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    const next = screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointments?page=2&pageSize=20');
    });
    expect(await screen.findByText('第 2 页')).toBeDefined();
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('edits an appointment changing every editable field', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[2]);

    const patientSelects = screen.getAllByLabelText('患者');
    fireEvent.change(patientSelects[patientSelects.length - 1], { target: { value: 'p-1' } });
    const doctorSelects = screen.getAllByLabelText('医生');
    fireEvent.change(doctorSelects[doctorSelects.length - 1], { target: { value: 'd-1' } });
    await waitFor(() => {
      const chairSelects = screen.getAllByLabelText('椅位');
      expect((chairSelects[chairSelects.length - 1] as HTMLSelectElement).options.length).toBeGreaterThan(1);
    });
    const chairSelects = screen.getAllByLabelText('椅位');
    fireEvent.change(chairSelects[chairSelects.length - 1], { target: { value: 'c-1' } });
    const typeSelects = screen.getAllByLabelText('预约类型');
    fireEvent.change(typeSelects[typeSelects.length - 1], { target: { value: 'EMERGENCY' } });
    const purposeSelects = screen.getAllByLabelText('预约事项');
    fireEvent.change(purposeSelects[purposeSelects.length - 1], { target: { value: 'purpose-1' } });
    const nameInputs = screen.getAllByLabelText('临时患者姓名');
    fireEvent.change(nameInputs[nameInputs.length - 1], { target: { value: '临时甲' } });
    const phoneInputs = screen.getAllByLabelText('临时患者电话');
    fireEvent.change(phoneInputs[phoneInputs.length - 1], { target: { value: '13900000000' } });
    const startInputs = screen.getAllByLabelText('开始时间');
    const endInputs = screen.getAllByLabelText('结束时间');
    fireEvent.change(startInputs[startInputs.length - 1], { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(endInputs[endInputs.length - 1], { target: { value: '2026-08-05T10:00' } });
    vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'a-1' });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointments/a-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const patchCall = vi.mocked(apiRequest).mock.calls.find(
      ([path, options]) => path === '/resources/appointments/a-1' && options?.method === 'PATCH',
    );
    const body = JSON.parse(String((patchCall?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({
      patientId: 'p-1',
      doctorId: 'd-1',
      chairId: 'c-1',
      type: 'EMERGENCY',
      purpose: 'purpose-1',
      tempPatientName: '临时甲',
      tempPatientPhone: '13900000000',
    });
  });

  it('keeps the edit form usable when the phone detail request fails', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return { items: [{ id: 'a-1', patientId: 'p-1', doctorId: 'd-1', tempPatientPhone: '138****0000', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }], total: 1, page: 1, pageSize: 20 };
      }
      if (path === '/resources/appointments/a-1') throw new Error('detail failed');
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[0]);
    const phoneInputs = screen.getAllByLabelText('临时患者电话');
    expect((phoneInputs[phoneInputs.length - 1] as HTMLInputElement).value).toBe('138****0000');
  });

  it('ignores a stale phone backfill after closing the edit dialog', async () => {
    let resolveDetail: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return { items: [{ id: 'a-1', patientId: 'p-1', doctorId: 'd-1', tempPatientPhone: '138****0000', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }], total: 1, page: 1, pageSize: 20 };
      }
      if (path === '/resources/appointments/a-1') {
        return await new Promise((resolve) => { resolveDetail = resolve; });
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[0]);
    await screen.findByRole('dialog', { name: '编辑预约' });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '编辑预约' })).toBeNull();
    });
    resolveDetail?.({ id: 'a-1', tempPatientPhone: '13800000000' });
    expect(screen.queryByRole('dialog', { name: '编辑预约' })).toBeNull();
  });

  it('cancels deletion through the confirm dialog close path', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '删除' }))[2]);
    const dialog = await screen.findByRole('dialog', { name: '删除预约' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '删除预约' })).toBeNull();
    });
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/appointments/a-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('falls back one page after deleting the last appointment on a later page', async () => {
    let deleted = false;
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (path === '/resources/appointments?page=2&pageSize=20') {
        return deleted
          ? { items: [], total: 21, page: 2, pageSize: 20 }
          : { items: [{ id: 'a-9', patientId: 'p-9', doctorId: 'd-1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }], total: 21, page: 2, pageSize: 20 };
      }
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return { items: appointmentList.items, total: 21, page: 1, pageSize: 20 };
      }
      if (method === 'DELETE' && path === '/resources/appointments/a-9') {
        deleted = true;
        return { ok: true };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('p-9');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    const confirmButtons = screen.getAllByRole('button', { name: '删除' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointments/a-9', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('第 1 页')).toBeDefined();
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('goes back to the previous page', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return { items: appointmentList.items, total: 21, page: 1, pageSize: 20 };
      }
      if (path === '/resources/appointments?page=2&pageSize=20') {
        return { items: [{ id: 'a-9', patientId: 'p-1', doctorId: 'd-1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }], total: 21, page: 2, pageSize: 20 };
      }
      if (path === '/resources/patients?page=1&pageSize=100') {
        return { items: [{ id: 'p-1', name: '患者甲' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/doctors') return [{ id: 'd-1', name: '张医生' }];
      if (path === '/resources/chairs?page=1&pageSize=100') {
        return { items: [{ id: 'c-1', name: '椅位 1' }], total: 1, page: 1, pageSize: 200 };
      }
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('第 2 页');
    await waitFor(() => {
      expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(await screen.findByText('第 1 页')).toBeDefined();
  });

  it('ignores a duplicate edit submit while busy', async () => {
    mockLookups();
    let resolvePatch: ((value: unknown) => void) | undefined;
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'PATCH' && path === '/resources/appointments/a-1') {
        return await new Promise((resolve) => { resolvePatch = resolve; });
      }
      return base?.(path, init);
    });
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[2]);
    const dialog = await screen.findByRole('dialog', { name: '编辑预约' });
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    const startInputs = screen.getAllByLabelText('开始时间');
    const endInputs = screen.getAllByLabelText('结束时间');
    fireEvent.change(startInputs[startInputs.length - 1], { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(endInputs[endInputs.length - 1], { target: { value: '2026-08-05T10:00' } });
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    const patchCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/resources/appointments/a-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    resolvePatch?.({ id: 'a-1' });
    expect(await screen.findByText('预约已更新')).toBeDefined();
  });

  it('edits an appointment purpose with every field and cancels the dialog', async () => {
    mockLookups();
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');

    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[0]);
    fireEvent.change(screen.getByLabelText('事项名称'), { target: { value: '初诊检查' } });
    fireEvent.change(screen.getByLabelText('颜色'), { target: { value: '#16a34a' } });
    fireEvent.change(screen.getByLabelText('排序'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('启用'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointmentPurposes/purpose-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/appointmentPurposes/purpose-1');
    const body = JSON.parse(String((call?.[1] as RequestInit)?.body));
    expect(body).toMatchObject({ name: '初诊检查', color: '#16a34a', sortOrder: 3, active: false });
    expect(await screen.findByText('事项已更新')).toBeDefined();

    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[0]);
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[0]);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('ignores a duplicate purpose save while busy', async () => {
    mockLookups();
    let resolvePatch: ((value: unknown) => void) | undefined;
    const base = vi.mocked(apiRequest).getMockImplementation();
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(init?.method ?? 'GET').toUpperCase() === 'PATCH' && path === '/resources/appointmentPurposes/purpose-1') {
        return await new Promise((resolve) => { resolvePatch = resolve; });
      }
      return base?.(path, init);
    });
    render(<AppointmentsPage />, { wrapper });
    await screen.findByText('预约管理');
    fireEvent.click((await screen.findAllByRole('button', { name: '编辑' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: '编辑预约事项' });
    const form = dialog.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    const patchCalls = vi.mocked(apiRequest).mock.calls.filter(
      ([path, options]) => path === '/resources/appointmentPurposes/purpose-1' && String((options as RequestInit)?.method ?? 'GET').toUpperCase() === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    resolvePatch?.({ id: 'purpose-1' });
    expect(await screen.findByText('事项已更新')).toBeDefined();
  });
});
