export const STATUS_LABELS: Record<string, string> = {
  REGISTERED: '已挂号',
  TRIAGED: '已分诊',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  PLANNED: '已计划',
  BOOKED: '已预约',
  ARRIVED: '已到诊',
  IN_CHAIR: '就诊中',
  NO_SHOW: '未到诊',
  PENDING: '待处理',
};

export interface TodayData {
  date?: string;
  registrations?: Array<Record<string, unknown>>;
  appointments?: Array<Record<string, unknown>>;
  totals?: { registrations?: number; appointments?: number; inProgressVisits?: number };
}

export type RegistrationRow = Record<string, unknown>;

export type WorkbenchDialog =
  | { kind: 'charge'; row: RegistrationRow }
  | { kind: 'record'; row: RegistrationRow }
  | { kind: 'followup'; row: RegistrationRow }
  | { kind: 'triage'; row: RegistrationRow };

export function rowPatientName(row: RegistrationRow): string {
  return String(row.patientName ?? row.patientIdLabel ?? row.patientId ?? '');
}
