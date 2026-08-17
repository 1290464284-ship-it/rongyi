export interface BatchRow {
  id: string;
  batchNo: string | null;
  productionDate: string | null;
  expiryDate: string | null;
  initialQuantity: number;
  remainingQuantity: number;
  itemName?: string | null;
  itemCode?: string | null;
  supplierId?: string | null;
}

export interface BatchListData {
  batches: BatchRow[];
  expiring: BatchRow[];
  /** W-1：page/pageSize 分页模式下回传（否则缺省）。 */
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface InventoryReportRow extends Record<string, unknown> {
  id?: string;
  itemId?: string;
  itemName?: string | null;
  spec?: string | null;
  category?: string | null;
  unit?: string | null;
  type?: string | null;
  quantity?: number;
  beforeStock?: number;
  afterStock?: number;
  referenceType?: string | null;
  referenceId?: string | null;
  remark?: string | null;
  createdAt?: string | null;
  // SUMMARY 聚合行
  name?: string | null;
  currentStock?: number;
  inQuantity?: number;
  outQuantity?: number;
  adjustQuantity?: number;
}

export interface InventoryReportData {
  type: string;
  from: string | null;
  to: string | null;
  total: number;
  items: InventoryReportRow[];
  supplierId?: string | null;
  truncated?: boolean;
}
