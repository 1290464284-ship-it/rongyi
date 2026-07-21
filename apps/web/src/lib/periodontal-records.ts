import { useCrudList, useCrudItem, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

export interface PeriodontalRecord {
  id: string;
  patientId: string;
  visitId?: string | null;
  doctorId?: string;
  examDate: string;
  data: {
    teeth: Record<string, any>;
    general: {
      bleedingIndex?: string;
      plaqueIndex?: string;
      furcation?: string;
      mobility?: string;
    };
  };
  remark?: string;
  createdAt: string;
  patient?: { id: string; name: string; code: string };
  doctor?: { id: string; name: string };
}

export interface PeriodontalRecordListRes {
  items: PeriodontalRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreatePeriodontalRecordDto {
  patientId: string;
  visitId?: string;
  doctorId?: string;
  examDate: string;
  data: {
    teeth: Record<string, any>;
    general: {
      bleedingIndex?: string;
      plaqueIndex?: string;
      furcation?: string;
      mobility?: string;
    };
  };
  remark?: string;
}

export interface UpdatePeriodontalRecordDto {
  examDate?: string;
  data?: {
    teeth: Record<string, any>;
    general: {
      bleedingIndex?: string;
      plaqueIndex?: string;
      furcation?: string;
      mobility?: string;
    };
  };
  remark?: string;
}

type PeriodontalRecordQuery = { patientId?: string; visitId?: string };

export function usePeriodontalRecords(patientId: string) {
  return useCrudList<PeriodontalRecord, PeriodontalRecordQuery>('periodontal-records', 'periodontal-records', { patientId });
}

export function usePeriodontalRecord(id: string | undefined) {
  return useCrudItem<PeriodontalRecord>('periodontal-records', 'periodontal-records', id);
}

export function useCreatePeriodontalRecord() {
  return useCrudCreate<PeriodontalRecord, CreatePeriodontalRecordDto>('periodontal-records', 'periodontal-records');
}

export function useUpdatePeriodontalRecord() {
  return useCrudUpdate<PeriodontalRecord, UpdatePeriodontalRecordDto>('periodontal-records', 'periodontal-records');
}

export function useDeletePeriodontalRecord() {
  return useCrudDelete('periodontal-records', 'periodontal-records');
}
