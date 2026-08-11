// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentBoardPage } from './AppointmentBoardPage';
import { todayLocalDate } from '../../lib/format';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

describe('AppointmentBoardPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders appointments grouped by status and requests today by date', async () => {
    const today = todayLocalDate();
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
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(`/appointments/by-date?date=${today}`);
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
    expect(screen.getByText('P2')).toBeDefined();
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

  it('prefers relation labels over raw ids on board cards', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      items: [
        { id: 'a1', patientId: 'P1', patientIdLabel: '患者甲', doctorId: 'D1', doctorIdLabel: '张医生', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' },
        { id: 'a2', patientId: 'P2', patientIdLabel: null, doctorId: 'D2', doctorIdLabel: null, startTime: '2026-08-04T10:00:00.000Z', status: 'BOOKED' },
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('患者甲')).toBeDefined();
    expect(screen.getByText('张医生')).toBeDefined();
    expect(screen.getByText('P2')).toBeDefined();
    expect(screen.getByText('D2')).toBeDefined();
    expect(screen.queryByText('P1')).toBeNull();
  });

  it('reports board transition failures', async () => {
    const today = todayLocalDate();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === `/appointments/by-date?date=${today}`) {
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
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === `/appointments/by-date?date=${today}`) {
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

  it('moves a card to another status column via drag and drop', async () => {
    const today = todayLocalDate();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === `/appointments/by-date?date=${today}`) {
        return {
          items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      if (path === '/appointments/a1/status') {
        return { success: true, data: { id: 'a1', status: 'ARRIVED' } };
      }
      return {};
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('P1')).toBeDefined();

    const card = document.querySelector('[data-id="a1"]')!;
    expect(card.getAttribute('draggable')).toBe('true');
    const arrivedColumn = document.querySelector('[data-status="ARRIVED"]')!;

    fireEvent.dragStart(card);
    expect(card.className).toContain('dragging');
    fireEvent.dragOver(arrivedColumn);
    expect(arrivedColumn.className).toContain('drag-over');
    fireEvent.drop(arrivedColumn);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/appointments/a1/status',
        expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"status":"ARRIVED"') }),
      );
    });
    expect(await screen.findByText('预约状态已更新')).toBeDefined();

    fireEvent.dragEnd(card);
    expect(card.className).not.toContain('dragging');
    expect(arrivedColumn.className).not.toContain('drag-over');
  });

  it('ignores drops on the same status column and without a dragged card', async () => {
    const today = todayLocalDate();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === `/appointments/by-date?date=${today}`) {
        return {
          items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      return {};
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('P1')).toBeDefined();

    // 无拖拽卡片时直接 drop：不发起任何状态请求
    fireEvent.drop(document.querySelector('[data-status="CANCELLED"]')!);
    // 拖到自身所在列：不发起任何状态请求
    fireEvent.dragStart(document.querySelector('[data-id="a1"]')!);
    fireEvent.drop(document.querySelector('[data-status="BOOKED"]')!);
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith('/appointments/a1/status', expect.anything());
  });

  it('shows loading and error states with retry', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {}));
    render(<AppointmentBoardPage />, { wrapper });
    expect(screen.getByText('预约看板加载中...')).toBeDefined();
    cleanup();

    vi.mocked(apiRequest).mockRejectedValue(new Error('board failed'));
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined();
  });

  it('clears the drag-over highlight when leaving a column', async () => {
    const today = todayLocalDate();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === `/appointments/by-date?date=${today}`) {
        return {
          items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      return {};
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('P1')).toBeDefined();

    const arrivedColumn = document.querySelector('[data-status="ARRIVED"]')!;
    fireEvent.dragOver(arrivedColumn);
    expect(arrivedColumn.className).toContain('drag-over');
    fireEvent.dragLeave(arrivedColumn);
    expect(arrivedColumn.className).not.toContain('drag-over');
  });

  it('renders an empty board when the response has no items', async () => {
    const today = todayLocalDate();
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === `/appointments/by-date?date=${today}`) {
        return { total: 0, page: 1, pageSize: 200 };
      }
      return {};
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect((await screen.findAllByText('暂无预约')).length).toBeGreaterThan(0);
  });
});
