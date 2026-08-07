export type LookupRow = Record<string, unknown> & { id: string; name?: string };

export type AppointmentRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  chairId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  status?: string | null;
  type?: string | null;
  purpose?: string | null;
  remark?: string | null;
  tempPatientName?: string | null;
  tempPatientPhone?: string | null;
};

export type PurposeRow = Record<string, unknown> & { id: string; name?: string; color?: string; sortOrder?: unknown; active?: unknown };

export interface AppointmentForm {
  patientId: string;
  doctorId: string;
  chairId: string;
  type: string;
  purpose: string;
  tempPatientName: string;
  tempPatientPhone: string;
  startTime: string;
  endTime: string;
}

export interface PurposeForm {
  name: string;
  color: string;
  sortOrder: string;
  active: boolean;
}
