import { useCrudList, useCrudItem, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

export interface OralExamination {
  id: string;
  patientId: string;
  visitId?: string | null;
  doctorId?: string;
  examDate: string;
  plaqueIndex?: string;
  calculusIndex?: string;
  bleedingIndex?: string;
  caries?: string[];
  looseTeeth?: string[];
  percussionPain?: string[];
  pulpVitality?: string[];
  mucosa?: string;
  tmj?: string;
  remark?: string;
  createdAt: string;
  patient?: { id: string; name: string; code: string };
  doctor?: { id: string; name: string };
}

export interface OralExaminationListRes {
  items: OralExamination[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateOralExaminationDto {
  patientId: string;
  visitId?: string;
  doctorId?: string;
  examDate: string;
  plaqueIndex?: string;
  calculusIndex?: string;
  bleedingIndex?: string;
  caries?: string[];
  looseTeeth?: string[];
  percussionPain?: string[];
  pulpVitality?: string[];
  mucosa?: string;
  tmj?: string;
  remark?: string;
}

export interface UpdateOralExaminationDto {
  examDate?: string;
  plaqueIndex?: string;
  calculusIndex?: string;
  bleedingIndex?: string;
  caries?: string[];
  looseTeeth?: string[];
  percussionPain?: string[];
  pulpVitality?: string[];
  mucosa?: string;
  tmj?: string;
  remark?: string;
}

type OralExaminationQuery = { patientId?: string; visitId?: string };

export function useOralExaminations(patientId: string) {
  return useCrudList<OralExamination, OralExaminationQuery>('oral-examinations', 'oral-examinations', { patientId });
}

export function useOralExamination(id: string | undefined) {
  return useCrudItem<OralExamination>('oral-examinations', 'oral-examinations', id);
}

export function useCreateOralExamination() {
  return useCrudCreate<OralExamination, CreateOralExaminationDto>('oral-examinations', 'oral-examinations');
}

export function useUpdateOralExamination() {
  return useCrudUpdate<OralExamination, UpdateOralExaminationDto>('oral-examinations', 'oral-examinations');
}

export function useDeleteOralExamination() {
  return useCrudDelete('oral-examinations', 'oral-examinations');
}
