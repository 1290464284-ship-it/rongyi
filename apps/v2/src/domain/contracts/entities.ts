// 实体接口（M-04：由 contracts.ts 拆分）
import type { Entity, SoftDeletable, ID, UTCDateTime, ClinicDate } from './shared';
import type {
  UserRole,
  Gender,
  PatientSource,
  RiskLevel,
} from './enums';

// ---------------------------------------------------------------------------
// Identity and clinic
// ---------------------------------------------------------------------------

export interface Clinic extends Entity {
  code: string;
  name: string;
  address?: string;
  phone?: string;
  active: boolean;
}

export interface User extends Entity, SoftDeletable {
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  currentClinicId?: ID | null;
  phone?: string;
  active: boolean;
  loginAttempts: number;
  lockedUntil?: UTCDateTime | null;
  tokenVersion: number;
}

export interface SessionClaims {
  userId: ID;
  clinicId: ID | null;
  role: UserRole;
  tokenVersion: number;
}

// ---------------------------------------------------------------------------
// Patient domain
// ---------------------------------------------------------------------------

export interface FamilyMember {
  id: ID;
  patientId: ID;
  name: string;
  relationship: string;
  phone?: string;
}

export interface Patient extends Entity, SoftDeletable {
  code: string;
  name: string;
  gender: Gender;
  phone: string;
  birthDate?: ClinicDate | null;
  idCard?: string;
  address?: string;
  occupation?: string;
  remark?: string;
  avatar?: string;
  tags: string[];
  allergies: string[];
  medicalHistory: string[];
  medicationHistory: string[];
  systemicDiseases: string[];
  source: PatientSource;
  active: boolean;
}

export interface PatientRiskScore extends Entity, SoftDeletable {
  patientId: ID;
  cariesScore: number;
  periodontalScore: number;
  implantScore: number;
  cariesLevel: RiskLevel;
  periodontalLevel: RiskLevel;
  implantLevel: RiskLevel;
  factorSnapshotJson: string;
  assessedById?: ID | null;
}

// ---------------------------------------------------------------------------
