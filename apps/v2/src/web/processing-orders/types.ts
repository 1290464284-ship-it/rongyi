// label 字典统一集中在 ../labels.ts（M-03），此处 re-export 保持旧导入路径不变。
export {
  PROCESSING_ORDER_STATUS_LABELS as STATUS_LABELS,
  PROCESSING_FLOW_STATUS_LABELS as FLOW_STATUS_LABELS,
} from '../labels';

// FLOW_STATUSES 是枚举值列表（供类型推导与遍历使用），不属于 label 文案，保留在本文件。
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

type ProcessingStepStatus = (typeof FLOW_STATUSES)[number];

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
