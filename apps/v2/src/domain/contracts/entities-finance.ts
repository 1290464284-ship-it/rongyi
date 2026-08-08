// 财务/药房实体（M-04：由 entities.ts 拆分）
import type { Entity, SoftDeletable, ID, UTCDateTime, Cents } from './shared';
import type { ChargeStatus, PayMethod, DebtStatus } from './enums';

// Financial domain
// ---------------------------------------------------------------------------

export interface Charge extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId?: ID | null;
  number: string;
  totalAmount: Cents;
  paidAmount: Cents;
  refundedAmount: Cents;
  discount: Cents;
  status: ChargeStatus;
  payMethod?: PayMethod | null;
  paidAt?: UTCDateTime | null;
  remark?: string;
}

export interface ChargeItem {
  id: ID;
  chargeId: ID;
  treatmentId?: ID | null;
  name: string;
  category: string;
  price: Cents;
  quantity: number;
  teethNumbers: string[];
  subtotal: Cents;
}

export interface Debt extends Entity, SoftDeletable {
  chargeId: ID;
  patientId: ID;
  totalAmount: Cents;
  paidAmount: Cents;
  status: DebtStatus;
}

export interface MemberCard extends Entity {
  patientId: ID;
  cardNo: string;
  balance: Cents;
  totalRecharge: Cents;
  totalConsume: Cents;
  status: 'ACTIVE' | 'INACTIVE' | 'DISABLED' | 'FROZEN' | 'EXPIRED';
  points: number;
  totalPoints: number;
  level: 'NORMAL' | 'VIP' | 'SVIP';
}

export interface Refund extends Entity, SoftDeletable {
  chargeId: ID;
  patientId: ID;
  amount: Cents;
  reason?: string;
  operatorId?: ID | null;
  operatorName?: string;
}

// ---------------------------------------------------------------------------
// Pharmacy content
// ---------------------------------------------------------------------------

export interface DrugCatalogItem extends Entity {
  code: string;
  name: string;
  specification?: string;
  unit: string;
  price: Cents;
  category?: string;
  active: boolean;
}

export interface Prescription extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId: ID;
  remark?: string;
}

export interface PrescriptionItem {
  id: ID;
  prescriptionId: ID;
  drugId?: ID | null;
  name: string;
  specification?: string;
  dosage?: string;
  frequency?: string;
  days: number;
  quantity: number;
  price: Cents;
}

// ---------------------------------------------------------------------------
