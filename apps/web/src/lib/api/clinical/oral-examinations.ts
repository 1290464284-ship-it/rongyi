import { createCrudHooks } from '@/lib/hooks/use-crud';

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

const crud = createCrudHooks<OralExamination, CreateOralExaminationDto, UpdateOralExaminationDto, OralExaminationQuery>('oral-examinations', 'oral-examinations');

export function useOralExaminations(patientId: string) {
  return crud.useList({ patientId });
}

export const useOralExamination = crud.useItem;
export const useCreateOralExamination = crud.useCreate;
export const useUpdateOralExamination = crud.useUpdate;
export const useDeleteOralExamination = crud.useDelete;
