import { DROPDOWN_MAX_PAGE_SIZE } from '@/config/constants';
import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';
import type { TreatmentStatus } from '@dental/shared';

export interface Treatment {
  id: string;
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  code: string;
  name: string;
  category: string;
  price: string;
  quantity: number;
  teethNumbers: number[];
  status: TreatmentStatus;
  plannedDate?: string | null;
  completedDate?: string | null;
  remark?: string;
  createdAt: string;
  doctor: { id: string; name: string };
  visit?: { id: string } | null;
}

export interface TreatmentListRes { items: Treatment[]; total: number; }

export const TREATMENT_STATUS_LABEL: Record<TreatmentStatus, string> = {
  PLANNED: '计划',
  APPROVED: '已确认',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const TREATMENT_STATUS_COLOR: Record<TreatmentStatus, string> = {
  PLANNED: 'bg-muted text-muted-foreground',
  APPROVED: 'bg-primary/10 text-primary',
  IN_PROGRESS: 'bg-warning/10 text-warning',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

type TreatmentQuery = {
  patientId?: string;
  toothNumber?: number;
};

export interface UpdateTreatmentDto {
  status?: Treatment['status'];
  remark?: string;
}

const crud = createPaginatedCrudHooks<Treatment, never, UpdateTreatmentDto, TreatmentQuery>('treatments', 'treatments');

export function useTreatments(patientId: string, toothNumber?: number, opts?: { enabled?: boolean }) {
  return crud.useList({ patientId, toothNumber, pageSize: DROPDOWN_MAX_PAGE_SIZE }, { enabled: opts?.enabled });
}

export const useUpdateTreatment = crud.useUpdate;
