import { useCrudPaginated, useCrudItem, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';
import {
  Patient,
  PatientSource,
  PatientGender,
  PATIENT_SOURCE_LABEL,
  PATIENT_SOURCE_COLOR,
} from '@dental/shared';

export type { Patient, PatientSource, PatientGender };
export { PATIENT_SOURCE_LABEL, PATIENT_SOURCE_COLOR };

export interface FamilyMember {
  id: string;
  name: string;
  code: string;
  phone: string;
  gender: string;
}

export interface CreatePatientDto {
  name: string;
  gender: PatientGender;
  phone: string;
  birthDate?: string;
  idCard?: string;
  address?: string;
  occupation?: string;
  remark?: string;
  avatar?: string;
  tags?: string[];
  allergies?: string[];
  medicalHistory?: string[];
  medicationHistory?: string[];
  systemicDiseases?: string[];
  source?: PatientSource;
  familyId?: string;
  referrer?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
}

export type UpdatePatientDto = Partial<CreatePatientDto>;

type PatientsQuery = { keyword?: string; page?: number; pageSize?: number };

export function usePatients(keyword: string, page: number, pageSize = 20) {
  return useCrudPaginated<Patient, PatientsQuery>('patients', 'patients', { keyword, page, pageSize });
}

export function usePatient(id: string) {
  return useCrudItem<Patient>('patients', 'patients', id);
}

export function useCreatePatient() {
  return useCrudCreate<Patient, CreatePatientDto>('patients', 'patients');
}

export function useUpdatePatient() {
  return useCrudUpdate<Patient, UpdatePatientDto>('patients', 'patients');
}

export function useDeletePatient() {
  return useCrudDelete('patients', 'patients');
}
