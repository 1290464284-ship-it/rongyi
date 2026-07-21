import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudPaginated, useCrudItem } from './use-crud';

export interface Visit {
  id: string;
  patientId: string;
  appointmentId?: string | null;
  doctorId: string;
  chiefComplaint?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  startTime: string;
  endTime?: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED';
  doctor: { id: string; name: string };
  patient?: { id: string; name: string; code: string; phone: string; gender: string };
  appointment?: { id: string; startTime: string; endTime: string; type: string } | null;
  treatments: { id: string; name: string; status: string; teethNumbers: number[] }[];
}

export interface VisitListRes { items: Visit[]; total: number; page: number; pageSize: number; }

export const VISIT_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: '就诊中',
  COMPLETED: '已完成',
};

export const VISIT_STATUS_COLOR: Record<string, string> = {
  IN_PROGRESS: 'bg-warning/10 text-warning border-warning/30',
  COMPLETED: 'bg-success/10 text-success border-success/30',
};

type VisitQuery = {
  patientId?: string;
  doctorId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export function useVisits(patientId: string) {
  return useCrudPaginated<Visit, VisitQuery>('visits', 'visits', { patientId, pageSize: 200 });
}

export function useVisitsList(params: {
  patientId?: string;
  doctorId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  return useCrudPaginated<Visit, VisitQuery>('visits', 'visits', { pageSize: 50, ...params });
}

export function useVisit(id: string | undefined) {
  return useCrudItem<Visit>('visits', 'visits', id);
}

export interface CreateVisitDto {
  patientId: string;
  appointmentId?: string;
  chiefComplaint?: string;
  diagnosis?: string;
  treatmentPlan?: string;
}

export interface CompleteVisitDto {
  endTime?: string;
  diagnosis?: string;
  treatmentPlan?: string;
}

export function useCreateVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateVisitDto) => (await api.post<Visit>('/visits', data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCompleteVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: CompleteVisitDto }) =>
      (await api.patch<Visit>(`/visits/${id}/complete`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
