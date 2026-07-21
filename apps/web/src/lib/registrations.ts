import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudPaginated, useCrudItem, useCrudCreate } from './use-crud';

export type RegistrationStatus = 'PENDING' | 'REGISTERED' | 'TRIAGED' | 'IN_PROGRESS' | 'VISITING' | 'COMPLETED' | 'CANCELLED';
export type RegistrationType = 'WALK_IN' | 'APPOINTMENT' | 'FOLLOW_UP' | 'FIRST_VISIT';

export const REGISTRATION_STATUS_LABEL: Record<string, string> = {
  PENDING: '待分诊',
  REGISTERED: '已挂号',
  TRIAGED: '已分诊',
  IN_PROGRESS: '接诊中',
  VISITING: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const REGISTRATION_STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning',
  REGISTERED: 'bg-blue-100 text-blue-700',
  TRIAGED: 'bg-info/10 text-info',
  IN_PROGRESS: 'bg-primary/10 text-primary',
  VISITING: 'bg-primary/10 text-primary',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export const REGISTRATION_TYPE_LABEL: Record<string, string> = {
  WALK_IN: '门诊',
  APPOINTMENT: '预约',
  FOLLOW_UP: '复诊',
  FIRST_VISIT: '初诊',
};

export const REGISTRATION_TYPE_COLOR: Record<string, string> = {
  WALK_IN: 'bg-blue-100 text-blue-700',
  APPOINTMENT: 'bg-green-100 text-green-700',
  FOLLOW_UP: 'bg-purple-100 text-purple-700',
  FIRST_VISIT: 'bg-orange-100 text-orange-700',
};

export interface Registration {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  patientPhone?: string;
  type: RegistrationType;
  status: RegistrationStatus;
  doctorId?: string;
  doctorName?: string;
  doctor?: { id: string; name: string };
  department?: string;
  complaint?: string;
  chiefComplaint?: string;
  triageNote?: string;
  registeredAt?: string;
  createdAt: string;
  updatedAt?: string;
  patient?: { id: string; name: string; code: string; phone: string; gender?: string };
}

export interface CreateRegistrationDto {
  patientId: string;
  type?: RegistrationType;
  department?: string;
  complaint?: string;
  chiefComplaint?: string;
  doctorId?: string;
}

export interface TriageRegistrationDto {
  doctorId: string;
  triageNote?: string;
}

export interface StartVisitRegistrationDto {
  doctorId?: string;
}

export interface CompleteRegistrationDto {
  visitId?: string;
}

type RegistrationQuery = {
  status?: RegistrationStatus;
  type?: RegistrationType;
  page?: number;
  pageSize?: number;
};

export function useRegistrations(params?: { status?: RegistrationStatus; type?: RegistrationType; page?: number; pageSize?: number }) {
  return useCrudPaginated<Registration, RegistrationQuery>('registrations', 'registrations', params);
}

export function useRegistration(id: string | undefined) {
  return useCrudItem<Registration>('registrations', 'registrations', id);
}

export function useCreateRegistration() {
  return useCrudCreate<Registration, CreateRegistrationDto>('registrations', 'registrations');
}

export function useTriageRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: TriageRegistrationDto }) =>
      (await api.patch<Registration>(`/registrations/${id}/triage`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}

export function useStartVisitRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch<Registration>(`/registrations/${id}/start-visit`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}

export function useCompleteRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch<Registration>(`/registrations/${id}/complete`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}

export function useCancelRegistration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch<Registration>(`/registrations/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['registrations'] }),
  });
}
