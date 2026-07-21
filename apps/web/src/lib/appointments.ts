import { useCrudPaginated, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

/** Appointment types and statuses aligned with backend enums.ts */
export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  chairId?: string;
  startTime: string;
  endTime: string;
  status: 'BOOKED' | 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  type: 'FIRST_VISIT' | 'RETURN' | 'CONSULTATION' | 'EMERGENCY' | 'RECALL' | 'OTHER';
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

export const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  BOOKED: '已预约',
  ARRIVED: '已到诊',
  IN_CHAIR: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  NO_SHOW: '爽约',
};

export const APPOINTMENT_STATUS_COLOR: Record<string, string> = {
  BOOKED: 'bg-primary/10 text-primary border-primary/30',
  ARRIVED: 'bg-warning/10 text-warning border-warning/30',
  IN_CHAIR: 'bg-warning/20 text-warning border-warning/40',
  COMPLETED: 'bg-success/10 text-success border-success/30',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  NO_SHOW: 'bg-destructive/10 text-destructive border-destructive/30',
};

export const APPOINTMENT_TYPE_LABEL: Record<string, string> = {
  FIRST_VISIT: '初诊',
  CONSULTATION: '咨询',
  RETURN: '复诊',
  EMERGENCY: '急诊',
  RECALL: '回访',
  OTHER: '其他',
};

export const APPOINTMENT_TYPE_COLOR: Record<string, string> = {
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

export function useAppointments(params: {
  doctorId?: string;
  patientId?: string;
  chairId?: string;
  startDate?: string;
  endDate?: string;
}) {
  return useCrudPaginated<Appointment, AppointmentQuery>('appointments', 'appointments', { ...params, pageSize: 200 });
}

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

export function useCreateAppointment() {
  return useCrudCreate<Appointment, CreateAppointmentDto>('appointments', 'appointments');
}

export function useUpdateAppointment() {
  return useCrudUpdate<Appointment, UpdateAppointmentDto>('appointments', 'appointments');
}

export function useDeleteAppointment() {
  return useCrudDelete('appointments', 'appointments');
}
