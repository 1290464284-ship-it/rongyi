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

});
