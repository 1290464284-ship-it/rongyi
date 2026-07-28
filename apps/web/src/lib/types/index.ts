// 枚举统一从 @dental/shared 复用（const 对象 + 派生类型），保证前后端同源
import {
  Role,
  Gender,
  AppointmentStatus,
  AppointmentType,
  VisitStatus,
  ChargeStatus,
  PayMethod,
  PlanStatus,
  PlanItemStatus,
  TreatmentStatus,
  ImagingType,
} from '@dental/shared';
export {
  Role,
  Gender,
  AppointmentStatus,
  AppointmentType,
  VisitStatus,
  ChargeStatus,
  PayMethod,
  PlanStatus,
  PlanItemStatus,
  TreatmentStatus,
  ImagingType,
};

// 收费相关类型
import type { Charge } from './charge.types';
export * from './charge.types';

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  phone?: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface Patient {
  id: string;
  code: string;
  name: string;
  gender: Gender;
  birthDate?: string | null;
  phone: string;
  idCard?: string | null;
  address?: string | null;
  occupation?: string | null;
  remark?: string | null;
  allergies: string[];
  medicalHistory: string[];
  familyId?: string | null;
  referrer?: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface Family {
  id: string;
  name: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patient?: Patient;
  doctorId: string;
  doctor?: User;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  type: AppointmentType;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Visit {
  id: string;
  patientId: string;
  patient?: Patient;
  appointmentId?: string | null;
  doctorId: string;
  doctor?: User;
  chiefComplaint?: string | null;
  diagnosis?: string | null;
  treatmentPlan?: string | null;
  startTime: string;
  endTime?: string | null;
  status: VisitStatus;
}

export interface PrescriptionItem {
  id: string;
  prescriptionId: string;
  drugCode?: string | null;
  drugName: string;
  spec: string;
  dosage: string;
  frequency: string;
  days: number;
  quantity: string | number;
  unit: string;
}

export interface Prescription {
  id: string;
  patientId: string;
  patient?: Patient;
  visitId?: string | null;
  doctorId: string;
  doctor?: User;
  remark?: string | null;
  createdAt: string;
  items?: PrescriptionItem[];
}

export interface TreatmentPlanItem {
  id: string;
  planId: string;
  code: string;
  name: string;
  category: string;
  price: string | number;
  quantity: number;
  teethNumbers: number[];
  status: PlanItemStatus;
  treatmentId?: string | null;
  completedAt?: string | null;
  remark?: string | null;
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  patient?: Patient;
  visitId?: string | null;
  doctorId: string;
  doctor?: User;
  name: string;
  status: PlanStatus;
  totalFee: string | number;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: TreatmentPlanItem[];
}

export interface Treatment {
  id: string;
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  code: string;
  name: string;
  category: string;
  price: string | number;
  quantity: number;
  teethNumbers: string[];
  status: TreatmentStatus;
  plannedDate?: string | null;
  completedDate?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Imaging {
  id: string;
  patientId: string;
  patient?: Patient;
  visitId?: string | null;
  doctorId?: string | null;
  doctor?: User;
  type: ImagingType;
  title: string;
  description?: string | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  takenAt: string;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentCatalog {
  id: string;
  code: string;
  name: string;
  category: string;
  price: string | number;
  remark?: string | null;
  createdAt: string;
}

export interface DrugCatalog {
  id: string;
  code: string;
  name: string;
  spec: string;
  category: string;
  price: string | number;
  unit: string;
  stock: string | number;
  remark?: string | null;
  createdAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardStats {
  todayVisits: number;
  todayRevenue: number;
  pendingAppointments: number;
  totalPatients: number;
  weekVisits: Array<{ date: string; count: number }>;
  recentCharges: Charge[];
}

export interface RevenueData {
  total: number;
  items: Array<{ date: string; revenue: number; count: number }>;
}

export interface DoctorWorkload {
  doctorId: string;
  doctorName: string;
  visitCount: number;
  revenue: number;
}
