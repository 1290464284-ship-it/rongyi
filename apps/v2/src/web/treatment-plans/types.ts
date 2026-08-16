export interface PlanRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  name?: string | null;
  totalFee?: number | null;
  status?: string | null;
  printCount?: number | null;
  signedAt?: string | null;
  discountType?: string | null;
  discountRate?: number | null;
  followUpStatus?: string | null;
  nextFollowUpAt?: string | null;
  trackingNote?: string | null;
}

/** 治疗计划明细行（/resources/treatmentPlanItems 列表行）。 */
export interface PlanItemRow extends Record<string, unknown> {
  id: string;
  code?: string | null;
  name?: string | null;
  category?: string | null;
  price?: number | null;
  quantity?: number | null;
  teethNumbers?: unknown;
  status?: string | null;
  discountRate?: number | null;
  billed?: boolean | number | null;
  billedChargeId?: string | null;
}

export interface PlanItemForm {
  id: string;
  code: string;
  name: string;
  category: string;
  price: string;
  quantity: string;
  teethNumbers: string;
  status: string;
  /** 服务端 billed 状态；true 时行内输入与移除禁用（已划价保护）。 */
  billed: boolean;
}

export interface TreatmentPlanForm {
  patientId: string;
  doctorId: string;
  name: string;
  status: string;
  totalFee: string;
  remark: string;
  items: PlanItemForm[];
}

/** 打印接口返回的可打印载荷摘要（POST /treatment-plans/:id/print 的 data）。 */
export interface TreatmentPlanPrintResult {
  plan: Record<string, unknown> & {
    id?: string;
    name?: string | null;
    patientName?: string | null;
    doctorName?: string | null;
    printCount?: number | null;
  };
  items: Array<Record<string, unknown>>;
  template: Record<string, unknown> | null;
}

export interface ValidPlanItem {
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string[];
  status: string;
}

export const PLAN_DISCOUNT_LABELS: Record<string, string> = {
  NONE: '无折扣',
  WHOLE: '整单折',
  DOUBLE: '折上折',
};
