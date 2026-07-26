import { DROPDOWN_MAX_PAGE_SIZE } from '@/config/constants';
import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';
import type { AppointmentStatus, AppointmentType } from '@dental/shared';

/** Appointment types and statuses aligned with backend enums.ts */
export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  chairId?: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  type: AppointmentType;
  remark?: string;
  patient: { id: string; name: string; code: string; phone: string };
  doctor: { id: string; name: string };
  chair?: { id: string; name: string; location?: string | null } | null;
  visit?: { id: string } | null;
}

export interface AppointmentListRes {
  items: Appointment[];
  total: number;
  page: number;
  pageSize: number;
}

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  BOOKED: '已预约',
  ARRIVED: '已到诊',
  IN_CHAIR: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  NO_SHOW: '爽约',
};

export const APPOINTMENT_STATUS_COLOR: Record<AppointmentStatus, string> = {
  BOOKED: 'bg-primary/10 text-primary border-primary/30',
  ARRIVED: 'bg-warning/10 text-warning border-warning/30',
  IN_CHAIR: 'bg-warning/20 text-warning border-warning/40',
  COMPLETED: 'bg-success/10 text-success border-success/30',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  NO_SHOW: 'bg-destructive/10 text-destructive border-destructive/30',
};

export const APPOINTMENT_TYPE_LABEL: Record<AppointmentType, string> = {
  FIRST_VISIT: '初诊',
  CONSULTATION: '咨询',
  RETURN: '复诊',
  EMERGENCY: '急诊',
  RECALL: '回访',
  OTHER: '其他',
};

export const APPOINTMENT_TYPE_COLOR: Record<AppointmentType, string> = {
  FIRST_VISIT: 'bg-primary',
  CONSULTATION: 'bg-secondary',
  RETURN: 'bg-info',
  EMERGENCY: 'bg-destructive',
  RECALL: 'bg-warning',
  OTHER: 'bg-muted-foreground',
};

type AppointmentQuery = {
  doctorId?: string;
  patientId?: string;
  chairId?: string;
  startDate?: string;
  endDate?: string;
};

export interface CreateAppointmentDto {
  patientId: string;
  doctorId: string;
  chairId?: string;
  startTime: string;
  endTime: string;
  type: Appointment['type'];
  remark?: string;
}

export interface UpdateAppointmentDto {
  status?: Appointment['status'];
  remark?: string;
}

const crud = createPaginatedCrudHooks<Appointment, CreateAppointmentDto, UpdateAppointmentDto, AppointmentQuery>('appointments', 'appointments', { cacheStrategy: 'fast' });

export function useAppointments(params: {
  doctorId?: string;
  patientId?: string;
  chairId?: string;
  startDate?: string;
  endDate?: string;
}, opts?: { enabled?: boolean }) {
  return crud.useList({ ...params, pageSize: DROPDOWN_MAX_PAGE_SIZE }, { enabled: opts?.enabled });
}

export const useCreateAppointment = crud.useCreate;
export const useUpdateAppointment = crud.useUpdate;
export const useDeleteAppointment = crud.useDelete;
