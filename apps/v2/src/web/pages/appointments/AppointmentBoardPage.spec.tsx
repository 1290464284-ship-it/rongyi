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

/** 构造一个共享 dataTransfer 存根：setData/getData 共用同一存储，模拟 HTML5 DnD */
function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  };
}

const cardByName = (name: string) => screen.getByRole('listitem', { name: `卡片 ${name}` });
const columnByName = (name: string) => screen.getByRole('list', { name });

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

  it('renders sparse rows with null status without crashing', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [{ id: 'a1', patientId: 'P1', doctorId: null, startTime: '2026-08-04T09:00:00.000Z', status: null }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    render(<AppointmentBoardPage />, { wrapper });
    await waitFor(() => expect(screen.queryByText('预约看板加载中...')).toBeNull());
    // null 状态行不落入任何列：看板渲染 6 个空列、0 张卡片
    expect(screen.getAllByRole('list')).toHaveLength(6);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(vi.mocked(apiRequest)).toHaveBeenCalled();
  });

  it('ignores drag interactions while the board is stale', async () => {
    const today = todayLocalDate();
    let resolveNew: (value: unknown) => void = () => {};
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === `/appointments/by-date?date=${today}`) {
        return {
          items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }],
          total: 1,
          page: 1,
          pageSize: 200,
        };
      }
      return new Promise((resolve) => { resolveNew = resolve; });
    });
    render(<AppointmentBoardPage />, { wrapper });
    await screen.findByText('P1');
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-08-05' } });
    await waitFor(() => expect(document.querySelector('.page')?.getAttribute('aria-busy')).toBe('true'));
    const dataTransfer = makeDataTransfer();
    const card = cardByName('P1');
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(columnByName('已到诊'), { dataTransfer });
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith('/appointments/a1/status', expect.anything());
    resolveNew({ items: [], total: 0, page: 1, pageSize: 200 });
  });

  it('keeps the drag-over highlight when leaving a different column and skips same-status drops', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [{ id: 'a1', patientId: 'P1', doctorId: 'D1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    render(<AppointmentBoardPage />, { wrapper });
    await screen.findByText('P1');
    const booked = columnByName('已预约');
    const cancelled = columnByName('已取消');
    fireEvent.dragOver(booked, { dataTransfer: makeDataTransfer() });
    expect(booked.className).toContain('drag-over');
    fireEvent.dragLeave(cancelled);
    expect(booked.className).toContain('drag-over');
    fireEvent.dragLeave(booked);
    expect(booked.className).not.toContain('drag-over');

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(cardByName('P1'), { dataTransfer });
    fireEvent.drop(booked, { dataTransfer });
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith('/appointments/a1/status', expect.anything());
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
    await waitFor(() => {
      expect((screen.getByLabelText('已到诊状态') as HTMLSelectElement).value).toBe('');
    });
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
    expect(screen.getByText(/未分配医生/)).toBeDefined();
    // 其余 5 列无卡片：只渲染空列头
    expect(screen.getAllByRole('list')).toHaveLength(6);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
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
    expect(screen.getByText(/张医生/)).toBeDefined();
    expect(screen.getByText('P2')).toBeDefined();
    expect(screen.getByText(/D2/)).toBeDefined();
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

  it('ignores a concurrent transition for the same appointment while one is in flight', async () => {
    const today = todayLocalDate();
    const resolveStatus: Array<() => void> = [];
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
        return new Promise<void>((resolve) => {
          resolveStatus.push(() => resolve());
        });
      }
      return {};
    });

    render(<AppointmentBoardPage />, { wrapper });
    await screen.findByText('P1');
    fireEvent.change(screen.getByLabelText('已预约状态'), { target: { value: 'ARRIVED' } });
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(cardByName('P1'), { dataTransfer });
    fireEvent.drop(columnByName('已取消'), { dataTransfer });

    await waitFor(() => {
      const statusCalls = vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/appointments/a1/status');
      expect(statusCalls).toHaveLength(1);
      expect(apiRequest).toHaveBeenCalledWith(
        '/appointments/a1/status',
        expect.objectContaining({ body: expect.stringContaining('"status":"ARRIVED"') }),
      );
    });
    resolveStatus[0]?.();
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

    const card = cardByName('P1');
    expect(card.getAttribute('draggable')).toBe('true');
    const arrivedColumn = columnByName('已到诊');

    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(arrivedColumn, { dataTransfer });
    expect(arrivedColumn.className).toContain('drag-over');
    fireEvent.drop(arrivedColumn, { dataTransfer });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/appointments/a1/status',
        expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"status":"ARRIVED"') }),
      );
    });
    expect(await screen.findByText('预约状态已更新')).toBeDefined();
    expect(arrivedColumn.className).not.toContain('drag-over');
  });

  it('moves a card with the keyboard arrows', async () => {
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

    const card = cardByName('P1');
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/appointments/a1/status',
        expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"status":"ARRIVED"') }),
      );
    });
    const statusCalls = () => vi.mocked(apiRequest).mock.calls.filter(([path]) => path === '/appointments/a1/status');
    expect(statusCalls()).toHaveLength(1);
    // 已在最左列：ArrowLeft 不产生新的状态请求
    fireEvent.keyDown(card, { key: 'ArrowLeft' });
    expect(statusCalls()).toHaveLength(1);
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

    fireEvent.drop(columnByName('已取消'), { dataTransfer: makeDataTransfer() });
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(cardByName('P1'), { dataTransfer });
    fireEvent.drop(columnByName('已预约'), { dataTransfer });
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

    vi.mocked(apiRequest).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '预约看板' })).toBeDefined();
  });

  it('falls back to a generic message for non-Error board failures', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce('boom-string');
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

    const arrivedColumn = columnByName('已到诊');
    fireEvent.dragOver(arrivedColumn, { dataTransfer: makeDataTransfer() });
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
    expect((await screen.findAllByRole('list')).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('disables board interactions while showing placeholder data for a new date', async () => {
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
      return new Promise(() => {});
    });
    render(<AppointmentBoardPage />, { wrapper });
    expect(await screen.findByText('P1')).toBeDefined();

    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-08-05' } });
    expect(screen.getByText('P1')).toBeDefined();
    // stale 期间拖拽被 onChange 守卫忽略，状态下拉禁用
    const dataTransfer = makeDataTransfer();
    fireEvent.dragStart(cardByName('P1'), { dataTransfer });
    fireEvent.drop(columnByName('已到诊'), { dataTransfer });
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith('/appointments/a1/status', expect.anything());
    expect((screen.getByLabelText('已预约状态') as HTMLSelectElement).disabled).toBe(true);
  });
});
