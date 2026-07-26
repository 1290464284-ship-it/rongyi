import { useCrudPaginated } from '@/lib/hooks/use-crud';

export interface OperationLog {
  id: string;
  operatorId: string;
  operatorName: string;
  userName?: string;
  action: string;
  module: string;
  targetId?: string;
  targetName?: string;
  target?: string;
  detail?: string;
  beforeData?: string;
  afterData?: string;
  ip?: string;
  createdAt: string;
}

type OperationLogQuery = { page?: number; pageSize?: number; module?: string; action?: string };

export function useOperationLogs(params: OperationLogQuery) {
  return useCrudPaginated<OperationLog, OperationLogQuery>('operation-logs', 'operation-logs', params);
}
