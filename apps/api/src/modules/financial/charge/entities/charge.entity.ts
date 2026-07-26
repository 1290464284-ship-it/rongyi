export interface ChargeRecord {
  id: string;
  patientId: string;
  doctorId?: string;
  visitId?: string | null;
  number: string;
  totalAmount: number;
  paidAmount: number;
  refundedAmount?: number;
  discount: number;
  status: string;
  payMethod?: string | null;
  paidAt?: string | null;
  remark?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ChargeItemRecord {
  id: string;
  chargeId: string;
  treatmentId?: string | null;
  inventoryItemId?: string | null;
  consumedQuantity?: number;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers?: string[] | string;
  subtotal: number;
}
