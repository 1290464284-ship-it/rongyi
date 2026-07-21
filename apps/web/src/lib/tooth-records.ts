import { createPaginatedCrudHooks } from './use-crud';

export interface ToothRecord {
  id: string;
  patientId: string;
  toothNumber: number;
  currentStatus: string;
  conditions: string[];
  remark?: string;
  createdAt: string;
  updatedAt?: string;
  patient?: { id: string; name: string; code: string };
}

export interface CreateToothRecordDto {
  patientId: string;
  toothNumber: number;
  currentStatus?: string;
  conditions?: string[];
  remark?: string;
}

export interface UpdateToothRecordDto {
  currentStatus?: string;
  conditions?: string[];
  remark?: string;
}

type ToothRecordQuery = {
  patientId?: string;
};

const hooks = createPaginatedCrudHooks<ToothRecord, CreateToothRecordDto, UpdateToothRecordDto, ToothRecordQuery>(
  'tooth-records',
  'tooth-records',
);

export const useToothRecords = hooks.useList;
export const useToothRecord = hooks.useItem;
export const useCreateToothRecord = hooks.useCreate;
export const useUpdateToothRecord = hooks.useUpdate;
export const useDeleteToothRecord = hooks.useDelete;
