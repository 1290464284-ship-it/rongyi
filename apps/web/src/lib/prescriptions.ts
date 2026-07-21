import { useCrudPaginated, useCrudItem, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

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

export function usePrescriptions(params: PrescriptionQuery) {
  return useCrudPaginated<Prescription, PrescriptionQuery>('prescriptions', 'prescriptions', params);
}

export function usePrescription(id: string | undefined) {
  return useCrudItem<Prescription>('prescriptions', 'prescriptions', id);
}

export interface CreatePrescriptionDto {
  patientId: string;
  visitId?: string;
  remark?: string;
  items: Omit<PrescriptionItem, 'id' | 'prescriptionId'>[];
}

export interface UpdatePrescriptionDto {
  remark?: string;
}

export function useCreatePrescription() {
  return useCrudCreate<Prescription, CreatePrescriptionDto>('prescriptions', 'prescriptions');
}

export function useUpdatePrescription() {
  return useCrudUpdate<Prescription, UpdatePrescriptionDto>('prescriptions', 'prescriptions');
}

export function useDeletePrescription() {
  return useCrudDelete('prescriptions', 'prescriptions');
}
