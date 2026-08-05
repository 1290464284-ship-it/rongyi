// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentBoardPage } from './AppointmentBoardPage';
import { apiRequest } from './api';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

describe('AppointmentBoardPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders appointments grouped by status and requests the board list without a date', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [
        { id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' },
        { id: 'a2', patientId: 'P2', doctorId: 'D2', startTime: '2026-08-04T10:00:00.000Z', status: 'CANCELLED' },
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('P1')).toBeDefined();
    expect(screen.getByText('P2')).toBeDefined();
    expect(screen.getAllByText('已预约').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已取消').length).toBeGreaterThan(0);
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/resources/appointments?page=1&pageSize=200');
  });

  it('filters the board by selected date and requests the by-date endpoint', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/appointments/by-date?date=2026-08-04') {
        return {
          items: [
            { id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' },
          ],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      return {
        items: [
          { id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' },
          { id: 'a2', patientId: 'P2', doctorId: 'D2', startTime: '2026-08-05T10:00:00.000Z', status: 'BOOKED' },
        ],
        total: 2,
        page: 1,
        pageSize: 200,
      };
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('P1')).toBeDefined();
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-08-04' } });
    await waitFor(() => expect(screen.queryByText('P2')).toBeNull());
    expect(await screen.findByText('P1')).toBeDefined();
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith('/appointments/by-date?date=2026-08-04');
  });

  it('updates appointment status from the board', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('P1')).toBeDefined();
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 'a1' } })
      .mockResolvedValueOnce({
        items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'ARRIVED' }],
        total: 1,
        page: 1,
        pageSize: 200,
      });
    fireEvent.change(screen.getByLabelText('已预约状态'), { target: { value: 'ARRIVED' } });
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/appointments/a1/status',
      expect.objectContaining({ method: 'PATCH' }),
    ));
  });

  it('renders empty board and fallback labels', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      items: [
        { id: 'a-empty', patientId: null, doctorId: null, startTime: null, status: 'BOOKED' },
      ],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('未填写患者')).toBeDefined();
    expect(screen.getByText('未分配医生')).toBeDefined();
    expect(screen.getAllByText('暂无预约').length).toBe(5);
  });

  it('reports board transition failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=200') {
        return {
          items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      throw new Error('board failed');
    });

    render(<AppointmentBoardPage />, { wrapper });
    fireEvent.change(await screen.findByLabelText('已预约状态'), { target: { value: 'ARRIVED' } });
    expect(await screen.findByText('board failed')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=200') {
        return {
          items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      throw 'boom';
    });
    fireEvent.change(screen.getByLabelText('已预约状态'), { target: { value: 'ARRIVED' } });
    expect(await screen.findByText('状态更新失败')).toBeDefined();
  });
});
