import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DROPDOWN_MAX_PAGE_SIZE } from '@/config/constants';
import { api } from '@/lib/api/api';
import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';
import type { VisitStatus } from '@dental/shared';

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
  status: VisitStatus;
  doctor: { id: string; name: string };
  patient?: { id: string; name: string; code: string; phone: string; gender: string };
  appointment?: { id: string; startTime: string; endTime: string; type: string } | null;
  treatments: { id: string; name: string; status: string; teethNumbers: number[] }[];
}

export interface VisitListRes { items: Visit[]; total: number; page: number; pageSize: number; }

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  IN_PROGRESS: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const VISIT_STATUS_COLOR: Record<VisitStatus, string> = {
  IN_PROGRESS: 'bg-warning/10 text-warning border-warning/30',
  COMPLETED: 'bg-success/10 text-success border-success/30',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
};

type VisitQuery = {
  patientId?: string;
  doctorId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

const crud = createPaginatedCrudHooks<Visit, never, never, VisitQuery>('visits', 'visits');

export function useVisits(patientId: string, opts?: { enabled?: boolean }) {
  return crud.useList({ patientId, pageSize: DROPDOWN_MAX_PAGE_SIZE }, { enabled: opts?.enabled });
}

export function useVisitsList(params: {
  patientId?: string;
  doctorId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  return crud.useList({ pageSize: 50, ...params });
}

export const useVisit = crud.useItem;

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
