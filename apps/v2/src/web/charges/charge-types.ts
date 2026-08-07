// label 字典统一集中在 ../labels.ts（M-03），此处 re-export 保持旧导入路径不变。
export { CHARGE_STATUS_LABELS as STATUS_LABELS, PAY_METHOD_LABELS as METHOD_LABELS } from '../labels';

export interface ChargeRow extends Record<string, unknown> {
  id: string;
  number?: string | null;
  totalAmount?: number | null;
  paidAmount?: number | null;
  status?: string | null;
}

export interface ChargeItemForm {
  id: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  costType: 'SERVICE' | 'MATERIAL';
}

export interface ChargeForm {
  patientId: string;
  items: ChargeItemForm[];
  remark: string;
  discount: string;
}

interface ChargeComboItemRow {
  id: string;
  comboId: string;
  catalogId?: string | null;
  name: string;
  category: string;
  price: number;
  quantity: number;
  costType?: 'SERVICE' | 'MATERIAL' | null;
}

export interface ChargeComboRow {
  id: string;
  code: string;
  name: string;
  type: 'PUBLIC' | 'PRIVATE';
  items?: ChargeComboItemRow[];
}

export interface ChargeTreeNode {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  costType: 'SERVICE' | 'MATERIAL' | null;
  anesthesia: boolean;
  businessCategory: 'SERVICE' | 'DRUG' | 'MATERIAL' | 'OTHER' | null;
  parentId: string | null;
  children: ChargeTreeNode[];
}

export interface PayMethodNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  remark: string | null;
  children: PayMethodNode[];
}

export interface ValidChargeItem {
  name: string;
  category: string;
  price: number;
  quantity: number;
  costType: 'SERVICE' | 'MATERIAL';
}
