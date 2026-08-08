// 排班/临床/治疗实体（M-04：由 entities.ts 拆分）
import type { Entity, SoftDeletable, ID, UTCDateTime, ClinicDate, Cents } from './shared';
import type { AppointmentStatus, AppointmentType, VisitStatus, RegistrationType, RegistrationStatus, TreatmentStatus } from './enums';

// Scheduling
// ---------------------------------------------------------------------------

export interface Chair extends Entity, SoftDeletable {
  name: string;
  location?: string;
  active: boolean;
}

export interface Appointment extends Entity, SoftDeletable {
  patientId: ID;
  doctorId: ID;
  chairId?: ID | null;
  startTime: UTCDateTime;
  endTime: UTCDateTime;
  status: AppointmentStatus;
  type: AppointmentType;
  remark?: string;
  visitId?: ID | null;
}

export interface Registration extends Entity, SoftDeletable {
  patientId: ID;
  doctorId?: ID | null;
  type: RegistrationType;
  status: RegistrationStatus;
  visitId?: ID | null;
  appointmentId?: ID | null;
  triageNote?: string;
  chiefComplaint?: string;
  registeredBy?: ID | null;
  registeredAt: UTCDateTime;
  triagedAt?: UTCDateTime | null;
  startedAt?: UTCDateTime | null;
  completedAt?: UTCDateTime | null;
}

export interface Visit extends Entity, SoftDeletable {
  patientId: ID;
  appointmentId?: ID | null;
  doctorId: ID;
  chiefComplaint?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  summary?: string | null;
  startTime: UTCDateTime;
  endTime?: UTCDateTime | null;
  status: VisitStatus;
  nextReminder?: ClinicDate | null;
}

// ---------------------------------------------------------------------------
// Clinical records
// ---------------------------------------------------------------------------

export interface FirstExam extends Entity, SoftDeletable {
  patientId: ID;
  doctorId?: ID | null;
  consultantId?: ID | null;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  oralExam?: string;
  auxiliaryExam?: string;
  diagnosis?: string;
  treatmentSuggestion?: string;
  status: string;
  remark?: string;
}

export interface FirstExamTooth {
  id: ID;
  examId: ID;
  toothNumber: number;
  toothStatus: string;
  diseases: string[];
  isChief: boolean;
  treatmentPlan?: string;
  remark?: string;
}

export interface OralExamination extends Entity, SoftDeletable {
  patientId: ID;
  examDate: ClinicDate;
  data: Record<string, unknown>;
  remark?: string;
}

export interface PeriodontalRecord extends Entity, SoftDeletable {
  patientId: ID;
  examDate: ClinicDate;
  data: Record<string, unknown>;
  plaqueIndex?: number | null;
  boneLoss?: string | null;
  remark?: string;
}

export interface MedicalRecord extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId?: ID | null;
  templateId?: ID | null;
  isTemplate: boolean;
  category?: string;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  allergyHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  teethInvolved: string[];
  images: string[];
  isLocked: boolean;
  lockedAt?: UTCDateTime | null;
  lockedBy?: ID | null;
  signature?: string;
  status: string;
}

export interface ToothRecord extends Entity, SoftDeletable {
  patientId: ID;
  toothNumber: number;
  currentStatus: string;
  conditions: string[];
  remark?: string;
}

export interface Imaging extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId?: ID | null;
  type: string;
  title: string;
  description?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  takenAt?: UTCDateTime | null;
  remark?: string;
}

// ---------------------------------------------------------------------------
// Treatment domain
// ---------------------------------------------------------------------------

export interface TreatmentCatalog extends Entity {
  code: string;
  name: string;
  category: string;
  price: Cents;
  remark?: string;
}

export interface Treatment extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId: ID;
  code: string;
  name: string;
  category: string;
  price: Cents;
  quantity: number;
  teethNumbers: string[];
  status: TreatmentStatus;
  plannedDate?: ClinicDate | null;
  completedDate?: ClinicDate | null;
  remark?: string;
}

export interface TreatmentPlan extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId: ID;
  name: string;
  status: string;
  totalFee: Cents;
  remark?: string;
}

export interface TreatmentPlanItem {
  id: ID;
  planId: ID;
  code: string;
  name: string;
  category: string;
  price: Cents;
  quantity: number;
  teethNumbers: string[];
  status: string;
  treatmentId?: ID | null;
  completedAt?: UTCDateTime | null;
  remark?: string;
}
