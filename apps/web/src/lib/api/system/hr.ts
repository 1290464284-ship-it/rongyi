import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { getCacheOptions } from '../query-client';
import { toastService } from '../../utils/toast-service';

export type ShiftType = 'MORNING' | 'AFTERNOON' | 'FULL' | 'CUSTOM' | 'LEAVE' | 'OFF';
export type LeaveType = 'ANNUAL' | 'SICK' | 'PERSONAL' | 'MARRIAGE' | 'MATERNITY' | 'PATERNITY' | 'BEREAVEMENT' | 'OTHER';
export type LeaveStatus = 'SAVED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'OFF';

export const SHIFT_TYPE: Record<ShiftType, string> = {
  MORNING: '早班',
  AFTERNOON: '晚班',
  FULL: '全天',
  CUSTOM: '自定义',
  LEAVE: '请假',
  OFF: '休息',
};

export const SHIFT_TYPE_SHORT: Record<ShiftType, string> = {
  MORNING: '早',
  AFTERNOON: '晚',
  FULL: '全',
  CUSTOM: '定',
  LEAVE: '假',
  OFF: '休',
};

export const LEAVE_TYPE: Record<LeaveType, string> = {
  ANNUAL: '年假',
  SICK: '病假',
  PERSONAL: '事假',
  MARRIAGE: '婚假',
  MATERNITY: '产假',
  PATERNITY: '陪产假',
  BEREAVEMENT: '丧假',
  OTHER: '其他',
};

export const LEAVE_STATUS: Record<LeaveStatus, string> = {
  SAVED: '草稿',
  PENDING: '审批中',
  APPROVED: '已通过',
  REJECTED: '已拒绝',
  CANCELLED: '已撤销',
};

export const LEAVE_STATUS_COLOR: Record<LeaveStatus, string> = {
  SAVED: 'bg-muted text-muted-foreground',
  PENDING: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-destructive/10 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export const LEAVE_TYPE_COLOR: Record<LeaveType, string> = {
  ANNUAL: 'bg-blue-500',
  SICK: 'bg-orange-500',
  PERSONAL: 'bg-purple-500',
  MARRIAGE: 'bg-pink-500',
  MATERNITY: 'bg-rose-500',
  PATERNITY: 'bg-indigo-500',
  BEREAVEMENT: 'bg-gray-500',
  OTHER: 'bg-slate-500',
};

export interface ScheduleItem {
  id: string;
  userId: string;
  userName: string;
  shiftType: ShiftType;
  startAt: string;
  endAt: string;
  color: string;
  note?: string;
  repeatRule?: string;
  leaveId?: string;
}

export interface CalendarDay {
  date: string;
  schedules: ScheduleItem[];
  attendanceStatus?: AttendanceStatus;
}

export interface CalendarRes {
  year: number;
  month: number;
  days: CalendarDay[];
}

export interface CreateScheduleDto {
  userId: string;
  shiftType: ShiftType;
  startAt: string;
  endAt: string;
  note?: string;
  repeatRule?: string;
  color?: string;
}

export interface UpdateScheduleDto extends Partial<CreateScheduleDto> {}

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  leaveType: LeaveType;
  startAt: string;
  endAt: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  submitAt?: string;
  approverId?: string;
  approverName?: string;
  approveAt?: string;
  rejectReason?: string;
  cancelReason?: string;
  createdAt: string;
}

export interface CreateLeaveDto {
  userId: string;
  leaveType: LeaveType;
  startAt: string;
  endAt: string;
  totalDays?: number;
  reason: string;
}

export interface AttendanceSummary {
  daysPresent: number;
  daysAbsent: number;
  daysLeave: number;
  daysOff: number;
}

export interface DailyAttendance {
  date: string;
  status: AttendanceStatus;
  reason?: string;
}

export interface AttendanceRes extends AttendanceSummary {
  listDaily: DailyAttendance[];
}

const CACHE_FAST = getCacheOptions('fast');

export function useScheduleCalendar(params: { year: number; month: number; userId?: string }) {
  return useQuery({
    queryKey: ['hr-calendar', params],
    queryFn: async ({ signal }) => (await api.get<CalendarRes>('/hr/schedules/calendar', { params, signal })).data,
    ...CACHE_FAST,
  });
}

export function useSchedules(params: { from?: string; to?: string; userId?: string }) {
  return useQuery({
    queryKey: ['hr-schedules', params],
    queryFn: async ({ signal }) => (await api.get<ScheduleItem[]>('/hr/schedules', { params, signal })).data,
    ...CACHE_FAST,
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateScheduleDto) => (await api.post<ScheduleItem>('/hr/schedules', data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-calendar'] });
      qc.invalidateQueries({ queryKey: ['hr-schedules'] });
    },
    onError: (error: Error) => toastService.createError('hr-schedule', error),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateScheduleDto }) =>
      (await api.patch<ScheduleItem>(`/hr/schedules/${id}`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-calendar'] });
      qc.invalidateQueries({ queryKey: ['hr-schedules'] });
    },
    onError: (error: Error) => toastService.updateError('hr-schedule', error),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/hr/schedules/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-calendar'] });
      qc.invalidateQueries({ queryKey: ['hr-schedules'] });
    },
    onError: (error: Error) => toastService.deleteError('hr-schedule', error),
  });
}

export function useLeaves(params?: { status?: LeaveStatus; userId?: string; from?: string; to?: string; search?: string }) {
  return useQuery({
    queryKey: ['hr-leaves', params],
    queryFn: async ({ signal }) => (await api.get<LeaveRequest[]>('/hr/leaves', { params, signal })).data,
    ...CACHE_FAST,
  });
}

export function useCreateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateLeaveDto) => (await api.post<LeaveRequest>('/hr/leaves', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
    onError: (error: Error) => toastService.createError('hr-leave', error),
  });
}

export function useSubmitLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<LeaveRequest>(`/hr/leaves/${id}/submit`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
    onError: (error: Error) => toastService.updateError('hr-leave-submit', error),
  });
}

export function useApproveLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<LeaveRequest>(`/hr/leaves/${id}/approve`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leaves'] });
      qc.invalidateQueries({ queryKey: ['hr-calendar'] });
    },
    onError: (error: Error) => toastService.updateError('hr-leave-approve', error),
  });
}

export function useRejectLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, rejectReason }: { id: string; rejectReason: string }) =>
      (await api.post<LeaveRequest>(`/hr/leaves/${id}/reject`, { rejectReason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
    onError: (error: Error) => toastService.updateError('hr-leave-reject', error),
  });
}

export function useCancelLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<LeaveRequest>(`/hr/leaves/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
    onError: (error: Error) => toastService.updateError('hr-leave-cancel', error),
  });
}

export function useAttendance(params: { from?: string; to?: string; userId?: string }) {
  return useQuery({
    queryKey: ['hr-attendance', params],
    queryFn: async ({ signal }) => (await api.get<AttendanceRes>('/hr/attendance', { params, signal })).data,
    ...CACHE_FAST,
  });
}

export function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

export function getInitials(name: string): string {
  if (!name) return '?';
  return name.slice(0, 1);
}
