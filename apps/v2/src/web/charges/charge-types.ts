export const STATUS_LABELS: Record<string, string> = {
  UNPAID: '未付款',
  PARTIAL: '部分付款',
  PAID: '已付款',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
};

export const METHOD_LABELS: Record<string, string> = {
  CASH: '现金',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  CARD: '银行卡',
  DEBT: '欠费',
  MEMBER_CARD: '会员卡',
  UNIONPAY: '银联',
  INSURANCE: '医保',
  OTHER: '其他',
};

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
