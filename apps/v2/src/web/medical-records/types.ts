export interface MedicalRecordRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  category?: string | null;
  diagnosis?: string | null;
  status?: string | null;
  editRequestStatus?: string | null;
  editRequestReason?: string | null;
  proposedContentJson?: string | null;
  proposedContent?: Record<string, unknown> | null;
}

export interface RecordForm {
  patientId: string;
  visitId: string;
  doctorId: string;
  category: string;
  status: string;
  isTemplate: boolean;
  chiefComplaint: string;
  presentIllness: string;
  pastHistory: string;
  allergyHistory: string;
  examination: string;
  diagnosis: string;
  treatmentPlan: string;
  teethInvolved: string;
  images: string;
  signature: string;
}

export const emptyForm: RecordForm = {
  patientId: '',
  visitId: '',
  doctorId: '',
  category: '',
  status: 'DRAFT',
  isTemplate: false,
  chiefComplaint: '',
  presentIllness: '',
  pastHistory: '',
  allergyHistory: '',
  examination: '',
  diagnosis: '',
  treatmentPlan: '',
  teethInvolved: '',
  images: '',
  signature: '',
};

export interface EditRequestForm {
  reason: string;
  category: string;
  status: string;
  chiefComplaint: string;
  presentIllness: string;
  pastHistory: string;
  allergyHistory: string;
  examination: string;
  diagnosis: string;
  treatmentPlan: string;
  teethInvolved: string;
  images: string;
  signature: string;
}

export const emptyEditForm: EditRequestForm = {
  reason: '',
  category: '',
  status: 'DRAFT',
  chiefComplaint: '',
  presentIllness: '',
  pastHistory: '',
  allergyHistory: '',
  examination: '',
  diagnosis: '',
  treatmentPlan: '',
  teethInvolved: '',
  images: '',
  signature: '',
};
