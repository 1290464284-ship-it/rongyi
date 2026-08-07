export type CompletionTarget = { kind: 'single'; id: string } | { kind: 'batch' } | null;

export interface FollowUpNps {
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number;
  average: number;
  breakdown: Array<{ rating: number; count: number }>;
}

export interface ExecutionFormState {
  executionStatus: string;
  patientRating: string;
  painLevel: string;
  feedback: string;
  contactedAt: string;
  nextPlanDate: string;
}

export const DEFAULT_EXECUTION_FORM: ExecutionFormState = {
  executionStatus: 'DONE',
  patientRating: '',
  painLevel: '',
  feedback: '',
  contactedAt: '',
  nextPlanDate: '',
};

export interface FollowUpDictForm {
  dictType: string;
  name: string;
  sortOrder: string;
  active: boolean;
  remark: string;
}

export function emptyDictForm(): FollowUpDictForm {
  return { dictType: 'TYPE', name: '', sortOrder: '0', active: true, remark: '' };
}
