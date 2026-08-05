// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentsPage } from './AppointmentsPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

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
    return {};
  });
}

describe('AppointmentsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders appointments and creates one with selectors', async () => {
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
    expect(await screen.findByText('appointments failed')).toBeDefined();
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
    expect(await screen.findByText('appointment failed')).toBeDefined();

    fireEvent.change((await screen.findAllByLabelText('变更预约状态'))[0], { target: { value: 'ARRIVED' } });
    expect(await screen.findByText('appointment failed')).toBeDefined();
  });
});
