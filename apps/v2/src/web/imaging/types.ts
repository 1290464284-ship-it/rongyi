export interface ImagingRow extends Record<string, unknown> {
  id: string;
  patientId?: string | null;
  patientIdLabel?: string | null;
  doctorId?: string | null;
  doctorIdLabel?: string | null;
  type?: string | null;
  title?: string | null;
  imageUrl?: string | null;
  takenAt?: string | null;
  categoryId?: string | null;
  phase?: string | null;
}

export interface ImagingForm {
  patientId: string;
  doctorId: string;
  type: string;
  title: string;
  description: string;
  takenAt: string;
  remark: string;
  categoryId: string;
  phase: string;
  imageUrl: string;
}

export const emptyForm: ImagingForm = {
  patientId: '',
  doctorId: '',
  type: '',
  title: '',
  description: '',
  takenAt: '',
  remark: '',
  categoryId: '',
  phase: '',
  imageUrl: '',
};

export interface ImagingCategoryRow extends Record<string, unknown> {
  id: string;
  name?: string | null;
  type?: string | null;
  sortOrder?: number | null;
  active?: boolean | null;
}
