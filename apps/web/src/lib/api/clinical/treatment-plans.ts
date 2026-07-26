import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';
import { PlanStatus, PlanItemStatus } from '@dental/shared';

export type { PlanStatus, PlanItemStatus };
export type TreatmentPlanStatus = PlanStatus;

export const PLAN_STATUS_LABEL: Record<TreatmentPlanStatus, string> = {
  DRAFT: '草稿',
  PENDING: '待执行',
  APPROVED: '已批准',
  IN_PROGRESS: '执行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const PLAN_STATUS_COLOR: Record<TreatmentPlanStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING: 'bg-warning/10 text-warning',
  APPROVED: 'bg-info/10 text-info',
  IN_PROGRESS: 'bg-primary/10 text-primary',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export const ITEM_STATUS_LABEL: Record<PlanItemStatus, string> = {
  PENDING: '待执行',
  PLANNED: '已计划',
  IN_PROGRESS: '执行中',
  COMPLETED: '已完成',
  SKIPPED: '已跳过',
};

export const ITEM_STATUS_COLOR: Record<PlanItemStatus, string> = {
  PENDING: 'bg-warning/10 text-warning',
  PLANNED: 'bg-info/10 text-info',
  IN_PROGRESS: 'bg-primary/10 text-primary',
  COMPLETED: 'bg-success/10 text-success',
  SKIPPED: 'bg-muted text-muted-foreground',
};

export interface TreatmentPlanItem {
  id?: string;
  treatmentCatalogId: string;
  treatmentCatalogName: string;
  name?: string;
  code?: string;
  price: number;
  quantity: number;
  status?: PlanItemStatus;
  category?: string;
  teethNumbers?: number[];
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  doctorId?: string;
  doctorName?: string;
  title?: string;
  name?: string;
  description?: string;
  status: TreatmentPlanStatus;
  totalPrice: number;
  totalFee?: number;
  items: TreatmentPlanItem[];
  _count?: { items: number };
  createdAt: string;
  updatedAt?: string;
  patient?: { id: string; name: string; code: string; phone: string };
  doctor?: { id: string; name: string };
}

export interface CreateTreatmentPlanDto {
  patientId: string;
  title?: string;
  description?: string;
  items: Array<{
    treatmentCatalogId: string;
    treatmentCatalogName: string;
    price: number;
    quantity: number;
  }>;
}

export interface UpdateTreatmentPlanDto {
  title?: string;
  description?: string;
  status?: TreatmentPlanStatus;
}

type TreatmentPlanQuery = { patientId?: string; status?: TreatmentPlanStatus; page?: number; pageSize?: number };

const crud = createPaginatedCrudHooks<TreatmentPlan, CreateTreatmentPlanDto, UpdateTreatmentPlanDto, TreatmentPlanQuery>('treatment-plans', 'treatment-plans');

export const useTreatmentPlans = crud.useList;
export const useTreatmentPlan = crud.useItem;
export const useCreateTreatmentPlan = crud.useCreate;
export const useUpdateTreatmentPlan = crud.useUpdate;
export const useDeleteTreatmentPlan = crud.useDelete;

export function useUpdatePlanStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: TreatmentPlanStatus }) =>
      (await api.patch<TreatmentPlan>(`/treatment-plans/${id}/status`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['treatment-plans'] }),
  });
}

export function useUpdatePlanItemStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, itemId, status }: { id: string; itemId: string; status: PlanItemStatus }) =>
      (await api.patch<TreatmentPlan>(`/treatment-plans/${id}/items/${itemId}/status`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['treatment-plans'] }),
  });
}