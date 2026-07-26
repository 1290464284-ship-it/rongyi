import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';

export interface PrescriptionItem {
  id: string;
  prescriptionId: string;
  drugCode?: string | null;
  drugName: string;
  spec: string;
  dosage: string;
  frequency: string;
  days: number;
  quantity: string;
  unit: string;
}

export interface Prescription {
  id: string;
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  remark?: string | null;
  createdAt: string;
  items: PrescriptionItem[];
  patient?: { id: string; name: string; gender: string; phone: string; birthDate?: string | null };
  doctor?: { id: string; name: string };
}

export interface PrescriptionListRes {
  items: Prescription[];
  total: number;
  page: number;
  pageSize: number;
}

type PrescriptionQuery = { patientId?: string; doctorId?: string; page?: number; pageSize?: number };

export interface CreatePrescriptionDto {
  patientId: string;
  doctorId: string;
  visitId?: string;
  remark?: string;
  items: Omit<PrescriptionItem, 'id' | 'prescriptionId'>[];
}

export interface UpdatePrescriptionDto {
  remark?: string;
}

const crud = createPaginatedCrudHooks<Prescription, CreatePrescriptionDto, UpdatePrescriptionDto, PrescriptionQuery>('prescriptions', 'prescriptions');

export const usePrescriptions = crud.useList;
export const usePrescription = crud.useItem;
export const useCreatePrescription = crud.useCreate;
export const useUpdatePrescription = crud.useUpdate;
export const useDeletePrescription = crud.useDelete;
