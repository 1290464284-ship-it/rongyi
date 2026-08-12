export interface FirstExamTrackingOverview {
  NONE: number;
  PENDING: number;
  HORIZONTAL_SHOULD: number;
  HORIZONTAL_DONE: number;
  LOST: number;
  total: number;
  dueToday: number;
}

export type FirstExamRow = Record<string, unknown> & {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  status?: string | null;
  followUpStatus?: string | null;
  chiefComplaint?: string | null;
  dentition?: string | null;
  previousExamId?: string | null;
  restartedAt?: string | null;
};

export interface FirstExamToothRow extends Record<string, unknown> {
  id: string;
  examId?: string | null;
  toothNumber?: number | null;
  toothStatus?: string | null;
  isChief?: boolean | null;
  chiefMark?: string | null;
}

export interface FirstExamHistoryItem {
  id: string;
  patientId?: string | null;
  doctorId?: string | null;
  status?: string | null;
  followUpStatus?: string | null;
  dentition?: string | null;
  previousExamId?: string | null;
  restartedAt?: string | null;
  chiefComplaint?: string | null;
  createdAt?: string | null;
}

export interface FirstExamForm {
  patientId: string;
  doctorId: string;
  consultantId: string;
  chiefComplaint: string;
  presentIllness: string;
  pastHistory: string;
  oralExam: string;
  auxiliaryExam: string;
  diagnosis: string;
  treatmentSuggestion: string;
  remark: string;
}

export const emptyForm: FirstExamForm = {
  patientId: '',
  doctorId: '',
  consultantId: '',
  chiefComplaint: '',
  presentIllness: '',
  pastHistory: '',
  oralExam: '',
  auxiliaryExam: '',
  diagnosis: '',
  treatmentSuggestion: '',
  remark: '',
};
