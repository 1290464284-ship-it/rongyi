/** Shared types/constants for the pharmacy workbench (split from dispense.ts). */
export const DISPENSE_STATUSES = ['PENDING', 'PARTIAL', 'DISPENSED', 'RETURNED'] as const;

interface DispenseCreateItemInput {
  itemId: string;
  quantity: number;
  batchId?: string | null;
}

export interface DispenseCreateInput {
  number: string;
  patientId: string;
  chargeId?: string;
  prescriptionId?: string;
  doctorId?: string;
  items: DispenseCreateItemInput[];
  note?: string;
}

interface DispenseUpdateItemInput extends DispenseCreateItemInput {
  /** 已存在的明细行 id（编辑时回填）；无 id 视为新增行。 */
  id?: string;
}

export interface DispenseUpdateInput {
  number: string;
  patientId: string;
  note?: string;
  items: DispenseUpdateItemInput[];
}

/** 发药时可为各明细指定批次（覆盖 DispenseItem.batchId，仅对批次管理物品生效）。 */
export interface DispenseAssignInput {
  items?: Array<{ dispenseItemId?: string; batchId?: string | null }>;
}

export interface ReturnItemInput {
  items: Array<{ dispenseItemId: string; quantity: number }>;
}

export interface NarcoticCreateInput {
  recordDate: string;
  patientId?: string;
  doctorId?: string;
  itemId: string;
  batchNo?: string;
  quantity: number;
  unit?: string;
  usage?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  remark?: string;
}

/** 麻药登记可编辑字段（patientId/doctorId/pharmacistId/unit 编辑时保持不变）。 */
export interface NarcoticUpdateInput {
  recordDate: string;
  itemId: string;
  batchNo?: string;
  quantity: number;
  usage?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  remark?: string;
}

export interface DispenseRow {
  id: string;
  status: string;
}

export interface DispenseItemRow {
  id: string;
  itemId: string;
  batchId: string | null;
  name: string;
  spec: string | null;
  quantity: number;
  returnedQuantity: number;
}

export interface InventoryItemRow {
  id: string;
  name: string;
  spec: string | null;
  batchManaged: number;
  stock: number;
}
