// label 字典统一集中在 ../labels.ts（M-03），此处 re-export 保持旧导入路径不变。
export { CLINICAL_STATUS_LABELS as STATUS_LABELS } from '../lib/labels';

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
