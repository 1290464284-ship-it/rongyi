import {
  ChargeStatus,
  PayMethod,
  CHARGE_STATUS_LABEL as SHARED_CHARGE_STATUS_LABEL,
  CHARGE_STATUS_COLOR as SHARED_CHARGE_STATUS_COLOR,
  PAY_METHOD_LABEL as SHARED_PAY_METHOD_LABEL,
  DEBT_STATUS_LABEL as SHARED_DEBT_STATUS_LABEL,
  DEBT_STATUS_COLOR as SHARED_DEBT_STATUS_COLOR,
} from '@dental/shared';
export { ChargeStatus, PayMethod };
export const CHARGE_STATUS_LABEL = SHARED_CHARGE_STATUS_LABEL;
export const CHARGE_STATUS_COLOR = SHARED_CHARGE_STATUS_COLOR;
export const PAY_METHOD_LABEL = SHARED_PAY_METHOD_LABEL;
export const DEBT_STATUS_LABEL = SHARED_DEBT_STATUS_LABEL;
export const DEBT_STATUS_COLOR = SHARED_DEBT_STATUS_COLOR;

export interface ChargeItem {
  id: string;
  chargeId: string;
  treatmentId?: string | null;
  name: string;
  category: string;
  price: string | number;
  quantity: number;
  teethNumbers: string[];
  subtotal: string | number;
  remark?: string | null;
}

export interface Charge {
  id: string;
  patientId: string;
  patient?: { id: string; name: string; code: string; phone: string };
  visitId?: string | null;
  doctorId?: string | null;
  doctor?: { id: string; name: string };
  number: string;
  totalAmount: string | number;
  paidAmount: string | number;
  refundedAmount: string | number;
  discount: string | number;
  status: ChargeStatus;
  payMethod?: PayMethod | null;
  paidAt?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
  items: ChargeItem[];
}

export interface ChargeListRes {
  items: Charge[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateChargeDto {
  patientId: string;
  visitId?: string;
  items: Omit<ChargeItem, 'id' | 'chargeId' | 'subtotal'>[];
  discount?: number;
}

export interface ChargeComboItem {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
}

export interface ChargeCombo {
  id: string;
  name: string;
  category: string;
  description: string;
  items: ChargeComboItem[];
  totalPrice: number;
  discountPrice: number;
  isActive: boolean;
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  isEnabled: boolean;
  sortOrder: number;
  remark?: string;
  createdAt: string;
}

export interface DebtRecord {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  amount: number;
  paidAmount: number;
  totalAmount: number;
  remainAmount: number;
  dueDate?: string;
  remark?: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  createdAt: string;
  patient?: { name: string; phone?: string; code?: string };
  charge?: { number: string };
  payments?: Array<{
    id: string;
    amount: number;
    payMethod: string;
    remark?: string;
    createdAt: string;
    paidAt?: string;
    operator?: { name: string };
  }>;
}

export interface CreateChargeComboDto {
  name: string;
  category: string;
  description?: string;
  items: Array<{ name: string; category: string; price: number; quantity: number }>;
  discountPrice?: number;
}

export interface UpdateChargeComboDto {
  name?: string;
  category?: string;
  description?: string;
  items?: Array<{ name: string; category: string; price: number; quantity: number }>;
  discountPrice?: number;
  isActive?: boolean;
}

export interface CreatePaymentMethodDto {
  name: string;
  type: string;
  code: string;
  sortOrder?: number;
  remark?: string;
}

export interface UpdatePaymentMethodDto {
  name?: string;
  code?: string;
  remark?: string;
}

export interface PayDebtDto {
  amount: number;
  payMethod?: string;
  remark?: string;
}

export interface ChargeComboListRes {
  items: ChargeCombo[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DebtListRes {
  items: DebtRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DebtStatsRes {
  totalRemain: number;
  thisMonthNew: number;
  thisMonthPaid: number;
  debtCount: number;
  total?: number;
  unpaid?: number;
  partial?: number;
}
