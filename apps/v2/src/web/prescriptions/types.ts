export interface PrescriptionRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  remark?: string | null;
  status?: string | null;
  processedAt?: string | null;
  chargeId?: string | null;
  chargeIdLabel?: string | null;
  dispenseId?: string | null;
}

/** POST /prescriptions/:id/process 返回的划价单 + 领药单信息。 */
export interface PrescriptionProcessResult {
  prescriptionId: string;
  status: string;
  chargeId: string;
  chargeNumber: string;
  chargeTotalAmount: number;
  dispenseId: string;
  dispenseNumber: string;
  itemCount: number;
}

/** GET /prescriptions/:id/status 返回的处理状态。 */
export interface PrescriptionStatusResult {
  id: string;
  status: string;
  processedAt: string | null;
  chargeId: string | null;
  dispenseId: string | null;
}

export interface PrescriptionItemForm {
  id: string;
  name: string;
  spec: string;
  dosage: string;
  frequency: string;
  days: string;
  quantity: string;
  price: string;
}

export interface PrescriptionForm {
  patientId: string;
  doctorId: string;
  remark: string;
  status: string;
  items: PrescriptionItemForm[];
}

/** 单条明细提交 payload（编辑 PATCH/POST 用；字段与后端 prescriptionItems 定义一致）。 */
export interface ItemPayload {
  name: string;
  specification?: string;
  dosage?: string;
  frequency?: string;
  days: number;
  quantity: number;
  price: number;
}
