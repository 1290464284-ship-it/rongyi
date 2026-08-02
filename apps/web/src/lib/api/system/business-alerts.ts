import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { getCacheOptions, type CacheStrategy } from '../query-client';
import type { PaginatedResult } from '@/lib/hooks/use-crud';

export const ALERT_SEVERITY = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
} as const;
export type AlertSeverity = typeof ALERT_SEVERITY[keyof typeof ALERT_SEVERITY];

export const ALERT_STATUS = {
  OPEN: 'OPEN',
  ACK: 'ACK',
  RESOLVED: 'RESOLVED',
} as const;
export type AlertStatus = typeof ALERT_STATUS[keyof typeof ALERT_STATUS];

export const ALERT_TYPES = {
  SCHEDULER_TASK_FAILED: 'SCHEDULER_TASK_FAILED',
  DRUG_INTERACTION: 'DRUG_INTERACTION',
  INVENTORY_LOW: 'INVENTORY_LOW',
  REVENUE_DROP: 'REVENUE_DROP',
  PATIENT_CHURN: 'PATIENT_CHURN',
  DOCTOR_PERF: 'DOCTOR_PERF',
  TREATMENT_LAGGED: 'TREATMENT_LAGGED',
  BULK_IMPORT_WARN: 'BULK_IMPORT_WARN',
  BACKUP_FAILED: 'BACKUP_FAILED',
  ENCRYPTION: 'ENCRYPTION',
  SATISFACTION_NEGATIVE: 'SATISFACTION_NEGATIVE',
  APPOINTMENT_CONFLICT: 'APPOINTMENT_CONFLICT',
  NEW_PATIENTS: 'NEW_PATIENTS',
  NO_SHOW_RATE: 'NO_SHOW_RATE',
  AOV: 'AOV',
  PERFORMANCE_ANOMALY: 'PERFORMANCE_ANOMALY',
} as const;
export type AlertType = typeof ALERT_TYPES[keyof typeof ALERT_TYPES];

export interface AlertNote {
  id: string;
  text: string;
  createdBy: string;
  createdAt: string;
}

export interface BusinessAlert {
  [key: string]: unknown;
  id: string;
  type: AlertType | string;
  severity: AlertSeverity;
  message: string;
  status: AlertStatus;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  notes: AlertNote[];
  createdAt: string;
  updatedAt: string;
}

export interface AlertCounts {
  open: number;
  ack: number;
  resolved: number;
  critical: number;
}

export interface ListAlertsParams {
  status?: AlertStatus;
  severity?: AlertSeverity;
  type?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  startDate?: string;
  endDate?: string;
}

export function useAlertCounts(
  options?: Omit<UseQueryOptions<AlertCounts>, 'queryKey' | 'queryFn'> & { cacheStrategy?: CacheStrategy }
) {
  const { cacheStrategy, ...queryOptions } = options ?? {};
  const cacheOpts = getCacheOptions(cacheStrategy);
  return useQuery({
    queryKey: ['business-alerts-counts'],
    queryFn: async ({ signal }) =>
      (await api.get<AlertCounts>('/system/business-alerts/counts', { signal })).data,
    ...cacheOpts,
    ...queryOptions,
  });
}

export function useAlerts(
  params?: ListAlertsParams,
  options?: Omit<UseQueryOptions<PaginatedResult<BusinessAlert>>, 'queryKey' | 'queryFn'> & { cacheStrategy?: CacheStrategy }
) {
  const { cacheStrategy, ...queryOptions } = options ?? {};
  const cacheOpts = getCacheOptions(cacheStrategy);
  return useQuery({
    queryKey: ['business-alerts', params],
    queryFn: async ({ signal }) => {
      const res = await api.get<PaginatedResult<BusinessAlert>>('/system/business-alerts', {
        params,
        signal,
      });
      return res.data;
    },
    ...cacheOpts,
    ...queryOptions,
  });
}

export function useAlertDetail(
  id: string | undefined,
  options?: Omit<UseQueryOptions<BusinessAlert>, 'queryKey' | 'queryFn' | 'enabled'> & { cacheStrategy?: CacheStrategy }
) {
  const { cacheStrategy, ...queryOptions } = options ?? {};
  const cacheOpts = getCacheOptions(cacheStrategy);
  return useQuery({
    queryKey: ['business-alert', id],
    queryFn: async ({ signal }) =>
      (await api.get<BusinessAlert>(`/system/business-alerts/${id}`, { signal })).data,
    enabled: !!id,
    ...cacheOpts,
    ...queryOptions,
  });
}

export function useLatestAlerts(
  severityIn: string = 'WARN,CRITICAL',
  options?: Omit<UseQueryOptions<BusinessAlert[]>, 'queryKey' | 'queryFn'> & { cacheStrategy?: CacheStrategy }
) {
  const { cacheStrategy, ...queryOptions } = options ?? {};
  const cacheOpts = getCacheOptions(cacheStrategy);
  return useQuery({
    queryKey: ['business-alerts-latest', severityIn],
    queryFn: async ({ signal }) => {
      const res = await api.get<{ data: BusinessAlert[]; total: number }>(
        '/system/business-alerts/latest',
        { params: { severityIn }, signal }
      );
      return res.data.data ?? [];
    },
    ...cacheOpts,
    ...queryOptions,
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, acknowledgedBy }: { id: string; acknowledgedBy: string }) =>
      (
        await api.patch(`/system/business-alerts/${id}/acknowledge`, {
          acknowledgedBy,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-alerts'] });
      qc.invalidateQueries({ queryKey: ['business-alerts-counts'] });
      qc.invalidateQueries({ queryKey: ['business-alerts-latest'] });
    },
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      resolvedBy,
      resolutionNote,
    }: {
      id: string;
      resolvedBy: string;
      resolutionNote?: string;
    }) =>
      (
        await api.patch(`/system/business-alerts/${id}/resolve`, {
          resolvedBy,
          resolutionNote,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-alerts'] });
      qc.invalidateQueries({ queryKey: ['business-alerts-counts'] });
      qc.invalidateQueries({ queryKey: ['business-alerts-latest'] });
    },
  });
}

export function useBatchResolveAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      resolutionNote,
      resolvedBy,
    }: {
      ids: string[];
      resolutionNote?: string;
      resolvedBy: string;
    }) =>
      (
        await api.post('/system/business-alerts/batch-resolve', {
          ids,
          resolutionNote,
          resolvedBy,
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-alerts'] });
      qc.invalidateQueries({ queryKey: ['business-alerts-counts'] });
      qc.invalidateQueries({ queryKey: ['business-alerts-latest'] });
    },
  });
}

export function useAddAlertNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) =>
      (await api.post(`/system/business-alerts/${id}/notes`, { text })).data,
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['business-alert', variables.id] });
    },
  });
}

export const ALERT_TYPE_LABELS: Record<string, string> = {
  SCHEDULER_TASK_FAILED: '定时任务失败',
  DRUG_INTERACTION: '药物相互作用',
  INVENTORY_LOW: '库存不足',
  REVENUE_DROP: '收入下降',
  PATIENT_CHURN: '患者流失',
  DOCTOR_PERF: '医生绩效异常',
  TREATMENT_LAGGED: '治疗滞后',
  BULK_IMPORT_WARN: '批量导入警告',
  BACKUP_FAILED: '备份失败',
  ENCRYPTION: '加密风险',
  SATISFACTION_NEGATIVE: '满意度差评',
  APPOINTMENT_CONFLICT: '预约冲突',
  NEW_PATIENTS: '新增患者下降',
  NO_SHOW_RATE: '爽约率过高',
  AOV: '客单价波动',
  PERFORMANCE_ANOMALY: '绩效异常',
};

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  INFO: '信息',
  WARN: '警告',
  ERROR: '错误',
  CRITICAL: '严重',
};

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  OPEN: '待处理',
  ACK: '已确认',
  RESOLVED: '已解决',
};

export const SEVERITY_BADGE_CLASS: Record<AlertSeverity, string> = {
  INFO: 'bg-blue-100 text-blue-800 border border-blue-200',
  WARN: 'bg-orange-100 text-orange-800 border border-orange-200',
  ERROR: 'bg-orange-600 text-white border border-orange-700',
  CRITICAL: 'bg-red-600 text-white border border-red-700',
};

export const SEVERITY_BANNER_CLASS: Record<AlertSeverity, string> = {
  INFO: 'bg-blue-600 text-white',
  WARN: 'bg-orange-500 text-white',
  ERROR: 'bg-orange-700 text-white',
  CRITICAL: 'bg-red-600 text-white',
};

export const STATUS_DOT_CLASS: Record<AlertStatus, string> = {
  OPEN: 'bg-yellow-500',
  ACK: 'bg-blue-500',
  RESOLVED: 'bg-green-500',
};
