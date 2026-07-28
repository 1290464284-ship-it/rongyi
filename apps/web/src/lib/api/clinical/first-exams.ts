import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';

export interface FirstExam {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  doctorId: string;
  doctorName: string;
  status: FirstExamStatus;
  dentitionType?: DentitionType;
  examDate?: string;
  height?: number;
  weight?: number;
  bloodPressure?: string;
  pulse?: number;
  chiefComplaint?: string;
  medicalHistory?: string;
  familyHistory?: string;
  extraoral?: string;
  intraoral?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  createdAt: string;
  updatedAt: string;
  patient?: {
    id: string;
    name: string;
    code: string;
    phone: string;
    gender: string;
    birthDate?: string;
  };
  doctor?: {
    id: string;
    name: string;
  };
}

export type FirstExamStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type DentitionType = 'PRIMARY' | 'DECIDUOUS' | 'PERMANENT' | 'MIXED';
export type ToothStatus = 'NORMAL' | 'CARIES' | 'MISSING' | 'IMPACTED' | 'RESTORED' | 'EXTRACTED' | 'SOUND' | 'UNERUPTED';

export interface FirstExamTooth {
  id?: string;
  toothNumber: number;
  condition?: string;
  treatment?: string;
  dentitionType?: DentitionType;
  status?: ToothStatus;
  notes?: string;
}

export interface FirstExamListRes {
  items: FirstExam[];
  total: number;
  page: number;
  pageSize: number;
}

type FirstExamQuery = {
  patientId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

export interface CreateFirstExamDto {
  patientId: string;
  doctorId: string;
  dentitionType?: DentitionType;
  examDate?: string;
  height?: number;
  weight?: number;
  bloodPressure?: string;
  pulse?: number;
  chiefComplaint?: string;
  medicalHistory?: string;
  familyHistory?: string;
  extraoral?: string;
  intraoral?: string;
  diagnosis?: string;
  treatmentPlan?: string;
}

export interface UpdateFirstExamDto {
  examDate?: string;
  height?: number;
  weight?: number;
  bloodPressure?: string;
  pulse?: number;
  chiefComplaint?: string;
  medicalHistory?: string;
  familyHistory?: string;
  extraoral?: string;
  intraoral?: string;
  diagnosis?: string;
  treatmentPlan?: string;
}

const crud = createPaginatedCrudHooks<FirstExam, CreateFirstExamDto, UpdateFirstExamDto, FirstExamQuery>('first-exams', 'first-exams');

export const useFirstExams = crud.useList;
export const useFirstExam = crud.useItem;
export const useCreateFirstExam = crud.useCreate;
export const useUpdateFirstExam = crud.useUpdate;
export const useDeleteFirstExam = crud.useDelete;

export function useCompleteFirstExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch<FirstExam>(`/first-exams/${id}/complete`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['first-exams'] }),
  });
}

export function useRestartFirstExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.patch<FirstExam>(`/first-exams/${id}/restart`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['first-exams'] }),
  });
}

export interface FirstExamTeethData {
  examId: string;
  teeth: Record<string, {
    id?: string;
    condition?: string;
    treatment?: string;
    dentitionType?: string;
    status?: string;
    notes?: string;
  }>;
}

export function useFirstExamTeeth(examId: string | undefined) {
  return useQuery({
    queryKey: ['first-exam-teeth', examId],
    queryFn: async () => {
      const data = (await api.get<FirstExamTeethData>(`/first-exams/${examId}/teeth`)).data;
      return Object.entries(data.teeth).map(([toothNumber, info]) => ({
        toothNumber: parseInt(toothNumber, 10),
        ...info,
      })) as FirstExamTooth[];
    },
    enabled: !!examId,
  });
}

export function useUpdateFirstExamTeeth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ examId, data }: { examId: string; data: FirstExamTeethData }) =>
      (await api.patch<FirstExamTeethData>(`/first-exams/${examId}/teeth`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['first-exam-teeth'] }),
  });
}

export interface ToothUpdateDto {
  condition?: string;
  treatment?: string;
  dentitionType?: string;
  status?: string;
  notes?: string;
}

export function useUpdateTooth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ examId, toothNumber, data }: { examId: string; toothNumber: string; data: ToothUpdateDto }) =>
      (await api.patch<FirstExamTeethData>(`/first-exams/${examId}/teeth/${toothNumber}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['first-exam-teeth'] }),
  });
}

export interface FirstExamTrack {
  id: string;
  examId: string;
  patientId?: string;
  type: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  operator?: { name: string };
}

export interface FirstExamTrackListRes {
  items: FirstExamTrack[];
  total: number;
  page: number;
  pageSize: number;
}

export function useFirstExamTracks(params: {
  examId?: string;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: ['first-exam-tracks', params],
    queryFn: async () =>
      (await api.get<FirstExamTrackListRes>('/first-exams/tracks/list', { params })).data,
    enabled: !params.examId || !!params.examId,
  });
}

export interface UpdateFirstExamTrackDto {
  type?: string;
  content?: string;
}

export function useUpdateFirstExamTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ examId: _examId, trackId, data }: { examId: string; trackId: string; data: UpdateFirstExamTrackDto }) =>
      (await api.patch<FirstExamTrack>(`/first-exams/tracks/${trackId}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['first-exam-tracks'] }),
  });
}

export interface CreateFollowUpDto {
  patientId: string;
  type: string;
  content: string;
  followUpDate: string;
}

export function useCreateFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateFollowUpDto) =>
      (await api.post('/follow-ups', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-ups'] }),
  });
}

export interface FirstExamStats {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  conversionRate?: number;
  thisMonth?: {
    total: number;
    completed: number;
  };
}

export function useFirstExamStats() {
  return useQuery({
    queryKey: ['first-exam-stats'],
    queryFn: async () =>
      (await api.get<FirstExamStats>('/first-exams/stats')).data,
  });
}

export const DENTITION_TYPE_LABEL: Record<string, string> = {
  PRIMARY: '乳牙',
  DECIDUOUS: '乳牙',
  PERMANENT: '恒牙',
  MIXED: '混合牙列',
};

export const TOOTH_STATUS_LABEL: Record<string, string> = {
  NORMAL: '正常',
  CARIES: '龋齿',
  MISSING: '缺失',
  IMPACTED: '阻生',
  RESTORED: '修复',
  EXTRACTED: '拔除',
  SOUND: '完好',
  UNERUPTED: '未萌出',
};

export const TOOTH_STATUS_COLOR: Record<string, string> = {
  NORMAL: 'bg-success/10 text-success',
  CARIES: 'bg-warning/10 text-warning',
  MISSING: 'bg-muted/10 text-muted-foreground',
  IMPACTED: 'bg-destructive/10 text-destructive',
  RESTORED: 'bg-info/10 text-info',
  EXTRACTED: 'bg-destructive/10 text-destructive',
};

export const FIRST_EXAM_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已批准',
  REJECTED: '已驳回',
};

export const FIRST_EXAM_STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  SUBMITTED: 'bg-info/10 text-info',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-destructive/10 text-destructive',
};
