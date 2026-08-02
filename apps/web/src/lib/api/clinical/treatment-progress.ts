import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { getCacheOptions, type CacheStrategy } from '@/lib/api/query-client';
import type { PaginatedResult } from '@/lib/hooks/use-crud';
import { toastService } from '@/lib/utils/toast-service';

export const LAG_RISK = {
  NONE: 'NONE',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type LagRisk = typeof LAG_RISK[keyof typeof LAG_RISK];

export const LAG_RISK_LABEL: Record<LagRisk, string> = {
  NONE: '无滞后',
  LOW: '低滞后',
  MEDIUM: '中滞后',
  HIGH: '高滞后',
  CRITICAL: '严重滞后',
};

export const LAG_RISK_BADGE_CLASS: Record<LagRisk, string> = {
  NONE: 'bg-muted text-muted-foreground',
  LOW: 'bg-info/10 text-info',
  MEDIUM: 'bg-warning/10 text-warning',
  HIGH: 'bg-orange-500/10 text-orange-600',
  CRITICAL: 'bg-destructive/10 text-destructive',
};

export const LAG_RISK_COLOR: Record<LagRisk, string> = {
  NONE: '#94A3B8',
  LOW: '#3498DB',
  MEDIUM: '#F39C12',
  HIGH: '#F97316',
  CRITICAL: '#E74C3C',
};

export const PLAN_STATUS = {
  ONGOING: 'ONGOING',
  COMPLETED: 'COMPLETED',
  PAUSED: 'PAUSED',
} as const;
export type PlanProgressStatus = typeof PLAN_STATUS[keyof typeof PLAN_STATUS];

export const PLAN_STATUS_LABEL: Record<PlanProgressStatus, string> = {
  ONGOING: '进行中',
  COMPLETED: '已完成',
  PAUSED: '已暂停',
};

export const PLAN_STATUS_COLOR: Record<PlanProgressStatus, string> = {
  ONGOING: '#F39C12',
  COMPLETED: '#27AE60',
  PAUSED: '#94A3B8',
};

export const ITEM_STATUS = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TreatmentItemStatus = typeof ITEM_STATUS[keyof typeof ITEM_STATUS];

export const ITEM_STATUS_LABEL: Record<TreatmentItemStatus, string> = {
  TODO: '待执行',
  IN_PROGRESS: '执行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const ITEM_STATUS_BADGE_CLASS: Record<TreatmentItemStatus, string> = {
  TODO: 'bg-muted text-muted-foreground',
  IN_PROGRESS: 'bg-primary/10 text-primary',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-muted/50 text-muted-foreground line-through',
};

export const TIMELINE_KIND = {
  PLAN_START: 'PLAN_START',
  TREATMENT_UPDATE: 'TREATMENT_UPDATE',
  COLLECTED: 'COLLECTED',
  RESCHEDULED: 'RESCHEDULED',
} as const;
export type TimelineKind = typeof TIMELINE_KIND[keyof typeof TIMELINE_KIND];

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  PLAN_START: '计划启动',
  TREATMENT_UPDATE: '治疗更新',
  COLLECTED: '已收费',
  RESCHEDULED: '重新安排',
};

export interface TreatmentProgressPlan {
  planId: string;
  planName: string;
  patientId: string;
  patientName: string;
  patientGender: 'MALE' | 'FEMALE' | 'UNKNOWN';
  age: number;
  doctorId: string;
  doctorName: string;
  createdAt: string;
  targetDate: string;
  totalItems: number;
  completedItems: number;
  totalPrice: number;
  collectedPrice: number;
  completionPct: number;
  delayDays: number;
  lagRisk: LagRisk;
  status: PlanProgressStatus;
}

export interface TreatmentProgressItem {
  id: string;
  linkTreatment?: string;
  treatmentName: string;
  treatmentCode: string;
  price: number;
  tooth?: string;
  status: TreatmentItemStatus;
  createdAt: string;
  completedAt?: string;
  expectedDay: number;
  actualDay?: number;
  daysLag: number;
}

export interface TreatmentProgressSnapshot {
  snapshotDate: string;
  completionPct: number;
  completedCount: number;
  totalCount: number;
  dailyCompleted: number;
  remainingDays: number;
}

export interface TreatmentTimelineEvent {
  createdAt: string;
  kind: TimelineKind;
  content: string;
}

export interface TreatmentProgressDetail {
  plan: TreatmentProgressPlan;
  items: TreatmentProgressItem[];
  snapshots: TreatmentProgressSnapshot[];
  timeline: TreatmentTimelineEvent[];
}

export interface LagTrendPoint {
  date: string;
  riskLevelsCount: [number, number, number, number, number];
}

export interface PlanStatusDistribution {
  ONGOING: number;
  COMPLETED: number;
  PAUSED: number;
}

export interface TreatmentProgressOverview {
  totalPlans: number;
  ongoing: number;
  completed: number;
  avgCompletionPct: number;
  avgDelayDays: number;
  riskCounts: Record<LagRisk, number>;
  todayDueCount: number;
  overdueCount: number;
  lagTrend: LagTrendPoint[];
  planStatusDistribution: PlanStatusDistribution;
}

export interface PlanListQuery {
  status?: PlanProgressStatus | 'ALL';
  from?: string;
  to?: string;
  doctorId?: string;
  risk?: LagRisk | LagRisk[];
  search?: string;
  page?: number;
  pageSize?: number;
}

const FAST_CACHE = getCacheOptions('fast');

export function useTreatmentProgressPlans(params?: PlanListQuery, options?: { cacheStrategy?: CacheStrategy }) {
  const { cacheStrategy } = options ?? {};
  const cacheOpts = cacheStrategy ? getCacheOptions(cacheStrategy) : FAST_CACHE;

  return useQuery({
    queryKey: ['treatment-progress', 'plans', params],
    queryFn: async ({ signal }) => {
      const res = await api.get<PaginatedResult<TreatmentProgressPlan>>('/treatment-progress/plans', {
        params,
        signal,
      });
      return res.data;
    },
    ...cacheOpts,
  });
}

export function useTreatmentProgressOverview(params?: { from?: string; to?: string }, options?: { cacheStrategy?: CacheStrategy }) {
  const { cacheStrategy } = options ?? {};
  const cacheOpts = cacheStrategy ? getCacheOptions(cacheStrategy) : FAST_CACHE;

  return useQuery({
    queryKey: ['treatment-progress', 'overview', params],
    queryFn: async ({ signal }) => {
      const res = await api.get<TreatmentProgressOverview>('/treatment-progress/overview', {
        params,
        signal,
      });
      return res.data;
    },
    ...cacheOpts,
  });
}

export function useTreatmentProgressDetail(planId: string | undefined, options?: { cacheStrategy?: CacheStrategy; enabled?: boolean }) {
  const { cacheStrategy, enabled } = options ?? {};
  const cacheOpts = cacheStrategy ? getCacheOptions(cacheStrategy) : FAST_CACHE;

  return useQuery({
    queryKey: ['treatment-progress', 'detail', planId],
    queryFn: async ({ signal }) => {
      const res = await api.get<TreatmentProgressDetail>(`/treatment-progress/plans/${planId}/progress`, {
        signal,
      });
      return res.data;
    },
    enabled: !!planId && (enabled ?? true),
    ...cacheOpts,
  });
}

export function useRefreshTreatmentProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) => {
      const res = await api.post<TreatmentProgressPlan>(`/treatment-progress/plans/${planId}/refresh`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treatment-progress'] });
      toastService.success('进度已重算');
    },
    onError: (err: Error) => {
      toastService.error('进度重算失败', err);
    },
  });
}
