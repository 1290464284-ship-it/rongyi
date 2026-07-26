import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';
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

const crud = createPaginatedCrudHooks<Patient, CreatePatientDto, UpdatePatientDto, PatientsQuery>('patients', 'patients');

export function usePatients(keyword: string, page: number, pageSize = 20) {
  return crud.useList({ keyword, page, pageSize });
}

export const usePatient = crud.useItem;
export const useCreatePatient = crud.useCreate;
export const useUpdatePatient = crud.useUpdate;
export const useDeletePatient = crud.useDelete;

export interface PatientSearchItem {
  id: string;
  name: string;
  phone: string;
  code: string;
}

export function usePatientSearch(keyword: string, enabled = true) {
  return useQuery({
    queryKey: ['patient-search', keyword],
    queryFn: async () =>
      (await api.get<{ items: PatientSearchItem[] }>('/patients', {
        params: { keyword, page: 1, pageSize: 10 },
      })).data,
    enabled: enabled && keyword.length > 0,
  });
}
