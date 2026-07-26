/**
 * 测试工厂函数 — 返回确定性 seed 数据对象，测试可覆盖或直接使用。
 */
import { RegistrationType } from '@dental/shared';

export const TEST_CLINIC_ID = 'test-clinic-001';
export const TEST_PATIENT_ID = 'test-patient-001';
export const TEST_DOCTOR_ID = 'test-doctor-001';
export const TEST_MEMBER_CARD_ID = 'test-card-001';

export interface ClinicSeed {
  [key: string]: any;
  id: string;
  name: string;
  code: string;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export function createClinicFactory(overrides?: Partial<ClinicSeed>): ClinicSeed {
  const now = new Date().toISOString();
  return {
    id: TEST_CLINIC_ID,
    name: 'Test Clinic',
    code: 'TEST001',
    isActive: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export interface UserSeed {
  [key: string]: any;
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
  clinicId: string;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export function createUserFactory(overrides?: Partial<UserSeed>): UserSeed {
  const now = new Date().toISOString();
  return {
    id: TEST_DOCTOR_ID,
    username: 'doctor1',
    passwordHash: 'hash',
    name: '张医生',
    role: 'DOCTOR',
    clinicId: TEST_CLINIC_ID,
    active: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export interface PatientSeed {
  [key: string]: any;
  id: string;
  code: string;
  name: string;
  gender: string;
  phone: string;
  clinicId: string;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export function createPatientFactory(overrides?: Partial<PatientSeed>): PatientSeed {
  const now = new Date().toISOString();
  return {
    id: TEST_PATIENT_ID,
    code: 'P001',
    name: '测试患者',
    gender: 'MALE',
    phone: '13800138000',
    clinicId: TEST_CLINIC_ID,
    active: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export interface MemberCardSeed {
  [key: string]: any;
  id: string;
  patientId: string;
  cardNo: string;
  balance: number;
  totalRecharge: number;
  totalConsume: number;
  points: number;
  status: string;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
}

export function createMemberCardFactory(overrides?: Partial<MemberCardSeed>): MemberCardSeed {
  const now = new Date().toISOString();
  return {
    id: TEST_MEMBER_CARD_ID,
    patientId: TEST_PATIENT_ID,
    cardNo: 'CARD001',
    balance: 100000,
    totalRecharge: 100000,
    totalConsume: 0,
    points: 0,
    status: 'ACTIVE',
    clinicId: TEST_CLINIC_ID,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export interface RegistrationSeed {
  [key: string]: any;
  patientId: string;
  doctorId?: string;
  type: RegistrationType;
  chiefComplaint?: string;
}

export function createRegistrationFactory(overrides?: Partial<RegistrationSeed>): RegistrationSeed {
  return {
    patientId: TEST_PATIENT_ID,
    doctorId: TEST_DOCTOR_ID,
    type: 'FIRST_VISIT',
    chiefComplaint: '牙痛',
    ...overrides,
  };
}

export interface AppointmentSeed {
  [key: string]: any;
  patientId: string;
  doctorId: string;
  startTime: string;
  endTime?: string;
  status: string;
  type?: string;
  remark?: string;
}

export function createAppointmentFactory(overrides?: Partial<AppointmentSeed>): AppointmentSeed {
  const startTime = new Date().toISOString();
  return {
    patientId: TEST_PATIENT_ID,
    doctorId: TEST_DOCTOR_ID,
    startTime,
    status: 'SCHEDULED',
    ...overrides,
  };
}
