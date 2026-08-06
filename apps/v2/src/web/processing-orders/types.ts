export const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  SENT: '已发送',
  IN_PROGRESS: '加工中',
  COMPLETED: '已完成',
  RECEIVED: '已收货',
  CANCELLED: '已取消',
};

export const FLOW_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '进行中',
  DONE: '已完成',
};

export const FLOW_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE'] as const;

export interface ProcessingRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  patientId?: string | null;
  patientIdLabel?: string | null;
  status?: string | null;
  settleStatus?: string | null;
  settledAmount?: number | null;
  settledAt?: string | null;
  totalFee?: number | null;
}

export interface ProcessingItemForm {
  id: string;
  name: string;
  spec: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  status: string;
}

export interface ProcessingOrderItemRow extends Record<string, unknown> {
  id: string;
  name?: string | null;
  spec?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  subtotal?: number | null;
  status?: string | null;
}

export interface ProcessingOrderForm {
  patientId: string;
  doctorId: string;
  number: string;
  shade: string;
  teethNumbers: string;
  totalFee: string;
  items: ProcessingItemForm[];
}

export interface SettleStats {
  unsettled: { count: number; feeTotal: number };
  settled: { count: number; amountTotal: number };
}

export type ProcessingStepStatus = (typeof FLOW_STATUSES)[number];

export interface ProcessingOrderStepRow extends Record<string, unknown> {
  id: string;
  stepId?: string | null;
  stepName: string;
  status: ProcessingStepStatus;
  sortOrder: number;
  startedAt?: string | null;
  completedAt?: string | null;
  operatorId?: string | null;
  remark?: string | null;
}

export interface ProcessingFlowStatRow extends Record<string, unknown> {
  stepId?: string | null;
  stepName: string;
  doneCount: number;
  inProgressCount: number;
}

export interface ProcessingFlowStatsData {
  from?: string | null;
  to?: string | null;
  steps: ProcessingFlowStatRow[];
}
