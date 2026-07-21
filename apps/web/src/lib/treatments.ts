import { useCrudPaginated, useCrudUpdate } from './use-crud';

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
  status: 'PLANNED' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  plannedDate?: string | null;
  completedDate?: string | null;
  remark?: string;
  createdAt: string;
  doctor: { id: string; name: string };
  visit?: { id: string } | null;
}

export interface TreatmentListRes { items: Treatment[]; total: number; }

export const TREATMENT_STATUS_LABEL: Record<string, string> = {
  PLANNED: '计划',
  APPROVED: '已确认',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const TREATMENT_STATUS_COLOR: Record<string, string> = {
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

export function useTreatments(patientId: string, toothNumber?: number) {
  return useCrudPaginated<Treatment, TreatmentQuery>('treatments', 'treatments', { patientId, toothNumber, pageSize: 200 });
}

export interface UpdateTreatmentDto {
  status?: Treatment['status'];
  remark?: string;
}

export function useUpdateTreatment() {
  return useCrudUpdate<Treatment, UpdateTreatmentDto>('treatments', 'treatments');
}
