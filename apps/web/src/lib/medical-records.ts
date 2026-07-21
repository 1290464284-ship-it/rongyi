import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudPaginated, useCrudItem, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

export interface MedicalRecord {
  id: string;
  patientId: string;
  visitId?: string | null;
  content: string;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  allergyHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  isLocked?: number;
  createdAt: string;
  updatedAt?: string;
  patient?: { id: string; name: string; code: string; phone: string };
  doctor?: { id: string; name: string };
}

export interface MedicalRecordTemplate {
  id: string;
  name: string;
  category?: string;
  content: string;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  allergyHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  isPublic?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface MedicalRecordPhrase {
  id: string;
  name?: string;
  category?: string;
  content: string;
  isPublic?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface RecordModifyRequest {
  id: string;
  recordId: string;
  patientId: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewRemark?: string;
  createdAt: string;
  updatedAt?: string;
  patient?: { id: string; name: string; code: string; phone: string };
  applicant?: { id: string; name: string };
}

export interface MedicalRecordListRes {
  items: MedicalRecord[];
  total: number;
  page: number;
  pageSize: number;
}

type MedicalRecordQuery = { patientId?: string; visitId?: string; page?: number; pageSize?: number };

export function useMedicalRecords(params: MedicalRecordQuery) {
  return useCrudPaginated<MedicalRecord, MedicalRecordQuery>('medical-records', 'medical-records', params);
}

export function useMedicalRecord(id: string | undefined) {
  return useCrudItem<MedicalRecord>('medical-records', 'medical-records', id);
}

export interface CreateMedicalRecordDto {
  patientId: string;
  visitId?: string;
  content?: string;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  allergyHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlan?: string;
}

export interface UpdateMedicalRecordDto {
  content?: string;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  allergyHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlan?: string;
}

export interface CreateRecordTemplateDto {
  name: string;
  category?: string;
  content?: string;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  allergyHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  isPublic?: boolean | number;
}

export interface CreateRecordPhraseDto {
  name?: string;
  category?: string;
  content: string;
  isPublic?: boolean | number;
}

export interface CreateModifyRequestDto {
  recordId: string;
  reason: string;
}

export interface ReviewModifyRequestDto {
  status: 'APPROVED' | 'REJECTED';
  remark?: string;
  reviewRemark?: string;
}

export function useCreateMedicalRecord() {
  return useCrudCreate<MedicalRecord, CreateMedicalRecordDto>('medical-records', 'medical-records');
}

export function useUpdateMedicalRecord() {
  return useCrudUpdate<MedicalRecord, UpdateMedicalRecordDto>('medical-records', 'medical-records');
}

export function useDeleteMedicalRecord() {
  return useCrudDelete('medical-records', 'medical-records');
}

export function useLockMedicalRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<MedicalRecord>(`/medical-records/${id}/lock`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['medical-records'] }),
  });
}

export function useRecordTemplates(params?: { category?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['record-templates', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.category) searchParams.set('category', params.category);
      if (params?.page) searchParams.set('page', params.page.toString());
      if (params?.pageSize) searchParams.set('pageSize', params.pageSize.toString());
      const res = await api.get(`/medical-records/templates?${searchParams.toString()}`);
      return res.data as { items: MedicalRecordTemplate[]; total: number };
    },
  });
}

export function useCreateRecordTemplate() {
  return useCrudCreate<MedicalRecordTemplate, CreateRecordTemplateDto>('medical-records/templates', 'record-templates');
}

export function useUpdateRecordTemplate() {
  return useCrudUpdate<MedicalRecordTemplate, Partial<CreateRecordTemplateDto>>('medical-records/templates', 'record-templates');
}

export function useDeleteRecordTemplate() {
  return useCrudDelete('medical-records/templates', 'record-templates');
}

export function useRecordPhrases(params?: { category?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['record-phrases', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.category) searchParams.set('category', params.category);
      if (params?.page) searchParams.set('page', params.page.toString());
      if (params?.pageSize) searchParams.set('pageSize', params.pageSize.toString());
      const res = await api.get(`/medical-records/phrases?${searchParams.toString()}`);
      return res.data as { items: MedicalRecordPhrase[]; total: number };
    },
  });
}

export function useCreateRecordPhrase() {
  return useCrudCreate<MedicalRecordPhrase, CreateRecordPhraseDto>('medical-records/phrases', 'record-phrases');
}

export function useUpdateRecordPhrase() {
  return useCrudUpdate<MedicalRecordPhrase, Partial<CreateRecordPhraseDto>>('medical-records/phrases', 'record-phrases');
}

export function useDeleteRecordPhrase() {
  return useCrudDelete('medical-records/phrases', 'record-phrases');
}

export function useRecordModifyRequests(params?: { status?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['record-modify-requests', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set('status', params.status);
      if (params?.page) searchParams.set('page', params.page.toString());
      if (params?.pageSize) searchParams.set('pageSize', params.pageSize.toString());
      const res = await api.get(`/medical-records/modify-requests?${searchParams.toString()}`);
      return res.data as { items: RecordModifyRequest[]; total: number };
    },
  });
}

export function useCreateModifyRequest() {
  return useCrudCreate<RecordModifyRequest, CreateModifyRequestDto>('medical-records/modify-requests', 'record-modify-requests');
}

export function useReviewModifyRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: ReviewModifyRequestDto }) =>
      (await api.patch<RecordModifyRequest>(`/medical-records/modify-requests/${id}/review`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['record-modify-requests'] }),
  });
}
