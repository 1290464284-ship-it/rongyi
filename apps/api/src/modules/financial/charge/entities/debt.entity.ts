export interface DebtRecord {
  id: string;
  chargeId?: string;
  patientId?: string;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: string;
  lastPaymentAt?: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
}
