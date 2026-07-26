import { createCrudHooks } from '@/lib/hooks/use-crud';

export type PeriodontalSiteKey = 'buccalMeso' | 'buccalMid' | 'buccalDist' | 'lingualMeso' | 'lingualMid' | 'lingualDist';

export interface PeriodontalTeethData {
  [tooth: number]: Partial<Record<PeriodontalSiteKey, number>>;
}

export interface PeriodontalRecordData {
  teeth: PeriodontalTeethData;
  general: {
    bleedingIndex?: string;
    plaqueIndex?: string;
    furcation?: string;
    mobility?: string;
  };
}

export interface PeriodontalRecord {
  id: string;
  patientId: string;
  visitId?: string | null;
  doctorId?: string;
  examDate: string;
  data: PeriodontalRecordData;
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
  data: PeriodontalRecordData;
  remark?: string;
}

export interface UpdatePeriodontalRecordDto {
  examDate?: string;
  data?: PeriodontalRecordData;
  remark?: string;
}

type PeriodontalRecordQuery = { patientId?: string; visitId?: string };

const crud = createCrudHooks<PeriodontalRecord, CreatePeriodontalRecordDto, UpdatePeriodontalRecordDto, PeriodontalRecordQuery>('periodontal-records', 'periodontal-records');

export function usePeriodontalRecords(patientId: string) {
  return crud.useList({ patientId });
}

export const usePeriodontalRecord = crud.useItem;
export const useCreatePeriodontalRecord = crud.useCreate;
export const useUpdatePeriodontalRecord = crud.useUpdate;
export const useDeletePeriodontalRecord = crud.useDelete;
