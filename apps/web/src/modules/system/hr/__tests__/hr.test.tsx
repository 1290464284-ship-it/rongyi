import { render, screen, act, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type {
  ScheduleItem, LeaveRequest, ShiftType, LeaveStatus, CreateScheduleDto,
} from '@/lib/api/system/hr';

const mockUseScheduleCalendar = vi.fn();
const mockUseSchedules = vi.fn();
const mockUseCreateSchedule = vi.fn();
const mockUseUpdateSchedule = vi.fn();
const mockUseDeleteSchedule = vi.fn();
const mockUseLeaves = vi.fn();
const mockUseCreateLeave = vi.fn();
const mockUseSubmitLeave = vi.fn();
const mockUseApproveLeave = vi.fn();
const mockUseRejectLeave = vi.fn();
const mockUseCancelLeave = vi.fn();
const mockUseAttendance = vi.fn();
const mockUseStaff = vi.fn();
const mockUseAuthStore = vi.fn();

vi.mock('@/lib/api/system/hr', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/system/hr')>('@/lib/api/system/hr');
  return {
    ...actual,
    useScheduleCalendar: (...args: unknown[]) => mockUseScheduleCalendar(...args),
    useSchedules: (...args: unknown[]) => mockUseSchedules(...args),
    useCreateSchedule: (...args: unknown[]) => mockUseCreateSchedule(...args),
    useUpdateSchedule: (...args: unknown[]) => mockUseUpdateSchedule(...args),
    useDeleteSchedule: (...args: unknown[]) => mockUseDeleteSchedule(...args),
    useLeaves: (...args: unknown[]) => mockUseLeaves(...args),
    useCreateLeave: (...args: unknown[]) => mockUseCreateLeave(...args),
    useSubmitLeave: (...args: unknown[]) => mockUseSubmitLeave(...args),
    useApproveLeave: (...args: unknown[]) => mockUseApproveLeave(...args),
    useRejectLeave: (...args: unknown[]) => mockUseRejectLeave(...args),
    useCancelLeave: (...args: unknown[]) => mockUseCancelLeave(...args),
    useAttendance: (...args: unknown[]) => mockUseAttendance(...args),
  };
});

vi.mock('@/lib/staff', () => ({
  useStaff: (...args: unknown[]) => mockUseStaff(...args),
  useDoctors: vi.fn(),
  useCreateStaff: vi.fn(),
  useUpdateStaff: vi.fn(),
  useDeleteStaff: vi.fn(),
}));

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const s = mockUseAuthStore();
    return sel ? sel(s) : s;
  },
}));

import HrPage from '../HrPage';
import { ScheduleDialog } from '@/components/hr/ScheduleDialog';
import { LeaveDialog } from '@/components/hr/LeaveDialog';

function makeQc() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false },
      mutations: { retry: false },
    },
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={makeQc()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderWithProviders(ui?: ReactNode) {
  return render(<Wrapper>{ui ?? <HrPage />}</Wrapper>);
}

function mockStaffDefault() {
  mockUseStaff.mockReturnValue({
    data: [
      { id: 'u1', name: '张三医生', username: 'zhangsan', role: 'DOCTOR', active: true, createdAt: '2024-01-01' },
      { id: 'u2', name: '李前台', username: 'liqiantai', role: 'RECEPTIONIST', active: true, createdAt: '2024-01-02' },
      { id: 'u3', name: '王BOSS', username: 'boss', role: 'BOSS', active: true, createdAt: '2024-01-01' },
    ],
    isLoading: false,
  });
}

function mockMutationsDefault() {
  mockUseCreateSchedule.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseUpdateSchedule.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseDeleteSchedule.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseCreateLeave.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ id: 'lv1' }) });
  mockUseSubmitLeave.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseApproveLeave.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseRejectLeave.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseCancelLeave.mockReturnValue({ mutateAsync: vi.fn() });
}

function setBoss() {
  mockUseAuthStore.mockReturnValue({
    user: { id: 'u3', username: 'boss', name: '王BOSS', role: 'BOSS' },
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: () => true,
  });
}
function setDoctor() {
  mockUseAuthStore.mockReturnValue({
    user: { id: 'u1', username: 'zhangsan', name: '张三医生', role: 'DOCTOR' },
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: () => true,
  });
}

type DayExtra = { schedules?: unknown[]; attendanceStatus?: unknown };
function buildMonthDays(year: number, month: number, extras: Record<string, DayExtra> = {}) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: Array<{ date: string; schedules: unknown[]; attendanceStatus: unknown }> = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ date: key, schedules: extras[key]?.schedules ?? [], attendanceStatus: extras[key]?.attendanceStatus ?? null });
  }
  return days;
}

function getCurrentYm() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  setBoss();
  mockStaffDefault();
  mockMutationsDefault();
});

afterEach(() => {
  cleanup();
});

describe('HrPage - F14 排班请假', () => {
  it('F14.1 日历Tab 调用 calendar 接口一次；31天格子渲染', async () => {
    const { year, month } = getCurrentYm();
    mockUseScheduleCalendar.mockReturnValue({
      data: { year, month, days: buildMonthDays(year, month) },
      isLoading: false,
    });
    mockUseLeaves.mockReturnValue({ data: [], isLoading: false });
    mockUseAttendance.mockReturnValue({ data: null, isLoading: false });

    renderWithProviders();

    expect(mockUseScheduleCalendar).toHaveBeenCalledTimes(1);
    const args = mockUseScheduleCalendar.mock.calls[0][0] as { year: number; month: number };
    expect(args.year).toBe(year);
    expect(args.month).toBe(month);

    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      expect(screen.getByTestId(`cal-cell-${key}`)).toBeInTheDocument();
    }
  });

  it('F14.2 月视图 8/10 有2人排班 → 格内显示2色卡；颜色一致', async () => {
    const { year, month } = getCurrentYm();
    const s1: ScheduleItem = {
      id: 's1', userId: 'u1', userName: '张三', shiftType: 'MORNING' as ShiftType,
      startAt: '2025-08-10T08:00:00', endAt: '2025-08-10T12:00:00', color: '#3B82F6',
    };
    const s2: ScheduleItem = {
      id: 's2', userId: 'u2', userName: '李四', shiftType: 'AFTERNOON' as ShiftType,
      startAt: '2025-08-10T13:00:00', endAt: '2025-08-10T17:00:00', color: '#10B981',
    };
    const testDate = `${year}-${String(month).padStart(2, '0')}-10`;
    const days = buildMonthDays(year, month, {
      [testDate]: { schedules: [s1, s2] },
    });
    mockUseScheduleCalendar.mockReturnValue({
      data: { year, month, days },
      isLoading: false,
    });
    mockUseLeaves.mockReturnValue({ data: [], isLoading: false });
    mockUseAttendance.mockReturnValue({ data: null, isLoading: false });

    renderWithProviders();

    const cell = screen.getByTestId(`cal-cell-${testDate}`);
    expect(cell).toBeInTheDocument();
    const card1 = screen.getByTestId('schedule-card-s1');
    const card2 = screen.getByTestId('schedule-card-s2');
    expect(card1).toBeInTheDocument();
    expect(card2).toBeInTheDocument();
    expect(card1).toHaveStyle({ background: '#3B82F6' });
    expect(card2).toHaveStyle({ background: '#10B981' });
  });

  it('F14.3 新建班次Dialog POST冲突返回 SCHEDULE_CONFLICT → Alert红色提示', async () => {
    const err: any = new Error('冲突');
    err.response = { data: { code: 'SCHEDULE_CONFLICT', message: '该时段已存在排班冲突，请调整时间或人员' } };
    const onSubmitMock = vi.fn().mockRejectedValue(err);

    function Test() {
      const [msg, setMsg] = useState('');
      return (
        <div>
          {msg && <div data-testid="conflict-alert" style={{ color: 'red' }}>{msg}</div>}
          <ScheduleDialog
            open
            onClose={() => {}}
            onSubmit={async (dto: CreateScheduleDto) => {
              try {
                return await onSubmitMock(dto);
              } catch (e: any) {
                if (e?.response?.data?.code === 'SCHEDULE_CONFLICT') {
                  setMsg('该时段已存在排班冲突，请调整时间或人员');
                }
                throw e;
              }
            }}
          />
        </div>
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Test />);

    expect(await screen.findByText('新建班次', {}, { timeout: 4000 })).toBeInTheDocument();
    const saveBtn = screen.getByTestId('sch-save');
    expect(saveBtn).toBeEnabled();
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('conflict-alert')).toBeInTheDocument();
    }, { timeout: 4000 });
    expect(screen.getByTestId('conflict-alert')).toHaveTextContent(/冲突/);
    expect(onSubmitMock).toHaveBeenCalledTimes(1);
  }, 15000);

  it('F14.4 考勤Tab KPI present=18 absent=2 leave=1 off=9 → 出勤率90%', async () => {
    const { year, month } = getCurrentYm();
    mockUseScheduleCalendar.mockReturnValue({
      data: { year, month, days: buildMonthDays(year, month) },
      isLoading: false,
    });
    mockUseLeaves.mockReturnValue({ data: [], isLoading: false });
    mockUseAttendance.mockReturnValue({
      data: {
        daysPresent: 18, daysAbsent: 2, daysLeave: 1, daysOff: 9, listDaily: [],
      },
      isLoading: false,
    });

    const user = userEvent.setup();
    renderWithProviders();
    await user.click(screen.getByTestId('tab-attendance'));

    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByTestId('attendance-rate').textContent).toBe('90%');
  }, 20000);

  it('F14.5 请假列表5条：PENDING橙/APPROVED绿/REJECTED红', async () => {
    const { year, month } = getCurrentYm();
    mockUseScheduleCalendar.mockReturnValue({
      data: { year, month, days: buildMonthDays(year, month) },
      isLoading: false,
    });
    const mkLeave = (id: string, status: LeaveStatus) => ({
      id, userId: 'u1', userName: '张三医生', leaveType: 'ANNUAL' as const,
      startAt: '2025-08-01T00:00:00', endAt: '2025-08-02T23:59:59', totalDays: 2,
      reason: '回家办事', status, createdAt: '2025-07-20T10:00:00',
    });
    mockUseLeaves.mockReturnValue({
      data: [
        mkLeave('l1', 'PENDING'),
        mkLeave('l2', 'PENDING'),
        mkLeave('l3', 'APPROVED'),
        mkLeave('l4', 'REJECTED'),
        mkLeave('l5', 'SAVED'),
      ],
      isLoading: false,
    });
    mockUseAttendance.mockReturnValue({ data: null, isLoading: false });

    const user = userEvent.setup();
    renderWithProviders();

    await user.click(screen.getByTestId('tab-leave'));

    // 过滤出真正的 Badge（select 下拉中的状态文本也会匹配 getAllByText）
    const pendingBadges = screen.getAllByText('审批中')
      .map(el => el.closest('span.inline-flex'))
      .filter((el): el is HTMLElement => el !== null);
    expect(pendingBadges.length).toBeGreaterThanOrEqual(2);
    pendingBadges.forEach(b => expect(b.className).toMatch(/warning/));

    const approvedBadges = screen.getAllByText('已通过')
      .map(el => el.closest('span.inline-flex'))
      .filter((el): el is HTMLElement => el !== null);
    expect(approvedBadges.length).toBeGreaterThanOrEqual(1);
    approvedBadges.forEach(b => expect(b.className).toMatch(/success/));

    const rejectedBadges = screen.getAllByText('已拒绝')
      .map(el => el.closest('span.inline-flex'))
      .filter((el): el is HTMLElement => el !== null);
    expect(rejectedBadges.length).toBeGreaterThanOrEqual(1);
    rejectedBadges.forEach(b => expect(b.className).toMatch(/destructive/));
  }, 20000);

  it('F14.6 LeaveDialog 提交审批 → create + submit 两次请求', async () => {
    const createFn = vi.fn().mockResolvedValue({ id: 'lv-new', status: 'SAVED' } as LeaveRequest);
    const submitFn = vi.fn().mockResolvedValue({ id: 'lv-new', status: 'PENDING' } as LeaveRequest);
    setBoss();

    function Test() {
      return (
        <LeaveDialog
          open
          onClose={() => {}}
          onCreate={createFn}
          onSubmit={submitFn}
        />
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Test />);

    await screen.findByTestId('lv-reason', {}, { timeout: 4000 });
    // 等待挂载 effect 初始化默认值完成（原生 select value="" 会隐式选中第一个
    // option，不能作为 effect 完成信号；用 effect 写入的默认日期判断）
    await waitFor(() => {
      expect((screen.getByTestId('range-start-date') as HTMLInputElement).value).toBeTruthy();
    });
    // 原因输入用 fireEvent.change（user.type 逐字符异步事件在 jsdom 下与
    // 受控组件渲染时序竞争，高负载下会偶发丢失输入）
    fireEvent.change(screen.getByTestId('lv-reason'), { target: { value: '家里有事需要处理' } });

    const submitBtn = screen.getByTestId('lv-submit');
    expect(submitBtn).toBeEnabled();
    await user.click(submitBtn);

    // 高负载下异步提交可能延迟，用 waitFor 轮询替代固定等待
    await waitFor(() => {
      expect(createFn).toHaveBeenCalledTimes(1);
    }, { timeout: 4000 });
    expect(submitFn).toHaveBeenCalledWith('lv-new');
  }, 20000);

  it('F14.7 BOSS 审批拒绝 PENDING 不填 rejectReason → Alert 拒绝原因必填', async () => {
    const pending: LeaveRequest = {
      id: 'lp1', userId: 'u1', userName: '张三医生', leaveType: 'ANNUAL',
      startAt: '2025-08-10T00:00:00', endAt: '2025-08-12T23:59:59',
      totalDays: 3, reason: '休假旅游', status: 'PENDING',
      submitAt: '2025-08-01T10:00:00', createdAt: '2025-08-01T09:00:00',
    };
    const rejectFn = vi.fn();
    setBoss();

    function Test() {
      return (
        <LeaveDialog
          open
          onClose={() => {}}
          leave={pending}
          onCreate={vi.fn()}
          onReject={rejectFn}
        />
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Test />);

    await screen.findByTestId('lv-reject', {}, { timeout: 4000 });
    const rejectBtn = screen.getByTestId('lv-reject');
    await user.click(rejectBtn);

    expect(screen.getByTestId('leave-validation-alert')).toHaveTextContent(/拒绝原因必填/);
    expect(rejectFn).not.toHaveBeenCalled();
  }, 20000);

  it('F14.8 BOSS 审批拒绝填了理由 → POST reject body rejectReason=出差冲突', async () => {
    const pending: LeaveRequest = {
      id: 'lp2', userId: 'u1', userName: '张三医生', leaveType: 'ANNUAL',
      startAt: '2025-08-10T00:00:00', endAt: '2025-08-12T23:59:59',
      totalDays: 3, reason: '休假', status: 'PENDING',
      submitAt: '2025-08-01T10:00:00', createdAt: '2025-08-01T09:00:00',
    };
    const rejectFn = vi.fn().mockResolvedValue({ id: 'lp2' } as LeaveRequest);
    setBoss();

    function Test() {
      return (
        <LeaveDialog
          open
          onClose={() => {}}
          leave={pending}
          onCreate={vi.fn()}
          onReject={rejectFn}
        />
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Test />);

    await screen.findByTestId('lv-reject-reason', {}, { timeout: 4000 });
    await user.type(screen.getByTestId('lv-reject-reason'), '出差冲突');
    await user.click(screen.getByTestId('lv-reject'));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(rejectFn).toHaveBeenCalledWith({ id: 'lp2', rejectReason: '出差冲突' });
  }, 20000);

  it('F14.9 BOSS 审批通过 → POST approve；调用', async () => {
    const pending: LeaveRequest = {
      id: 'lp3', userId: 'u1', userName: '张三医生', leaveType: 'ANNUAL',
      startAt: '2025-08-15T00:00:00', endAt: '2025-08-15T23:59:59',
      totalDays: 1, reason: '年假一天', status: 'PENDING',
      submitAt: '2025-08-01T10:00:00', createdAt: '2025-08-01T09:00:00',
    };
    const approveFn = vi.fn().mockResolvedValue({ id: 'lp3' } as LeaveRequest);
    setBoss();

    function Test() {
      return (
        <LeaveDialog
          open
          onClose={() => {}}
          leave={pending}
          onCreate={vi.fn()}
          onApprove={approveFn}
        />
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Test />);

    const approveBtn = await screen.findByTestId('lv-approve', {}, { timeout: 4000 });
    await user.click(approveBtn);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(approveFn).toHaveBeenCalledWith('lp3');
  }, 20000);

  it('F14.10 搜索"张三" → GET leaves 带参数', async () => {
    const { year, month } = getCurrentYm();
    mockUseScheduleCalendar.mockReturnValue({
      data: { year, month, days: buildMonthDays(year, month) },
      isLoading: false,
    });
    mockUseLeaves.mockReturnValue({ data: [], isLoading: false });
    mockUseAttendance.mockReturnValue({ data: null, isLoading: false });

    const user = userEvent.setup();
    renderWithProviders();

    await user.click(screen.getByTestId('tab-leave'));
    await user.clear(screen.getByTestId('leave-search'));
    await user.type(screen.getByTestId('leave-search'), '张三');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const calls = mockUseLeaves.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const last = calls[calls.length - 1][0] as Record<string, unknown>;
    const hasSearch = last?.search === '张三';
    const hasUserId = last?.userId === 'u1';
    expect(hasSearch || hasUserId).toBe(true);
  }, 20000);

  it('F14.11 DOCTOR 用户进入：看不到通过/拒绝按钮；只能看自己记录', async () => {
    setDoctor();
    const { year, month } = getCurrentYm();
    mockUseScheduleCalendar.mockReturnValue({
      data: { year, month, days: buildMonthDays(year, month) },
      isLoading: false,
    });
    mockUseLeaves.mockReturnValue({
      data: [
        {
          id: 'ld1', userId: 'u1', userName: '张三医生', leaveType: 'ANNUAL' as const,
          startAt: '2025-08-10T00:00:00', endAt: '2025-08-11T23:59:59',
          totalDays: 2, reason: '家里有事', status: 'PENDING' as const,
          submitAt: '2025-08-01T10:00:00', createdAt: '2025-08-01T09:00:00',
        },
      ],
      isLoading: false,
    });
    mockUseAttendance.mockReturnValue({ data: null, isLoading: false });

    const user = userEvent.setup();
    renderWithProviders();

    await user.click(screen.getByTestId('tab-leave'));

    expect(screen.queryByTestId('leave-approve-btn-ld1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leave-reject-btn-ld1')).not.toBeInTheDocument();

    const calls = mockUseLeaves.mock.calls;
    const last = calls[calls.length - 1][0] as Record<string, unknown>;
    expect(last?.userId).toBe('u1');
  }, 20000);

  it('F14.12 新建请假 startAt>endAt → 前端校验不发请求', async () => {
    const createFn = vi.fn();
    setBoss();

    function Test() {
      return (
        <LeaveDialog
          open
          onClose={() => {}}
          onCreate={createFn}
          onSubmit={vi.fn()}
        />
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Test />);

    await screen.findByTestId('range-start-date', {}, { timeout: 4000 });

    // 等待挂载 effect 初始化默认值完成（lv-user-select 是原生 select，value="" 时
    // 会隐式选中第一个 option，不能作为 effect 完成信号；用 effect 写入的默认日期判断）
    await waitFor(() => {
      expect((screen.getByTestId('range-start-date') as HTMLInputElement).value).toBeTruthy();
    });

    // jsdom 的 date input 不支持逐字符输入，用 fireEvent.change 直接设置完整值
    fireEvent.change(screen.getByTestId('range-start-date'), { target: { value: '2025-08-20' } });
    fireEvent.change(screen.getByTestId('range-end-date'), { target: { value: '2025-08-10' } });
    // 原因输入同样用 fireEvent.change（user.type 逐字符异步事件在 jsdom 下与
    // 受控组件渲染时序竞争，高负载下会偶发丢失输入）
    fireEvent.change(screen.getByTestId('lv-reason'), { target: { value: '测试日期错误' } });

    await user.click(screen.getByTestId('lv-submit'));

    expect(screen.getByTestId('leave-validation-alert')).toHaveTextContent(/结束日期必须晚于开始日期/);
    expect(createFn).not.toHaveBeenCalled();
  }, 20000);
});
