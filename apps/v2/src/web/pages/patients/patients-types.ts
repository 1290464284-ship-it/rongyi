export type PatientRow = Record<string, unknown> & {
  id: string;
  code?: string;
  name?: string;
  gender?: string;
  phone?: string;
  wechatId?: string;
  preferredContact?: string;
  contactNote?: string;
  birthDate?: string;
  source?: string;
  active?: boolean;
};

export interface PatientForm {
  code: string;
  name: string;
  gender: string;
  phone: string;
  wechatId: string;
  preferredContact: string;
  contactNote: string;
  birthDate: string;
  idCard: string;
  address: string;
  occupation: string;
  source: string;
  active: boolean;
  avatar: string;
  allergies: string;
  medicalHistory: string;
  medicationHistory: string;
  systemicDiseases: string;
  tags: string;
  remark: string;
}

export const emptyForm: PatientForm = {
  code: '',
  name: '',
  gender: 'UNKNOWN',
  phone: '',
  wechatId: '',
  preferredContact: 'PHONE',
  contactNote: '',
  birthDate: '',
  idCard: '',
  address: '',
  occupation: '',
  source: 'WALK_IN',
  active: true,
  avatar: '',
  allergies: '',
  medicalHistory: '',
  medicationHistory: '',
  systemicDiseases: '',
  tags: '',
  remark: '',
};
