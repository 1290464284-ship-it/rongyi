import { createCrudHooks } from './use-crud';

export interface Equipment {
  id: string;
  name: string;
  model?: string | null;
  brand?: string | null;
  serialNumber?: string | null;
  category?: string | null;
  location?: string | null;
  purchasePrice?: number | null;
  purchaseDate?: string | null;
  supplier?: string | null;
  status: 'NORMAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
  remarks?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type QueryEquipmentDto = {
  name?: string;
  keyword?: string;
  category?: string;
  status?: string;
};

export interface CreateEquipmentDto {
  name: string;
  model?: string;
  brand?: string;
  serialNumber?: string;
  category?: string;
  location?: string;
  purchasePrice?: number;
  purchaseDate?: string;
  supplier?: string;
  status?: string;
  remarks?: string;
}

export interface UpdateEquipmentDto {
  name?: string;
  model?: string;
  brand?: string;
  serialNumber?: string;
  category?: string;
  location?: string;
  purchasePrice?: number;
  purchaseDate?: string;
  supplier?: string;
  status?: string;
  remarks?: string;
}

export const EQUIPMENT_STATUS_LABEL: Record<string, string> = {
  NORMAL: '正常',
  MAINTENANCE: '维修中',
  OUT_OF_SERVICE: '停用',
};

export const EQUIPMENT_STATUS_COLOR: Record<string, string> = {
  NORMAL: 'bg-success/10 text-success',
  MAINTENANCE: 'bg-warning/10 text-warning',
  OUT_OF_SERVICE: 'bg-destructive/10 text-destructive',
};

export const EQUIPMENT_CATEGORIES = [
  '牙科综合治疗台',
  'X光机/CT',
  '超声洁牙机',
  '激光治疗仪',
  '消毒设备',
  '器械工具',
  '其他',
];

export type EquipmentStatus = 'NORMAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE';

const hooks = createCrudHooks<Equipment, CreateEquipmentDto, UpdateEquipmentDto, QueryEquipmentDto>(
  'equipment',
  'equipment',
);

export const useEquipmentList = hooks.useList;
export const useEquipmentItem = hooks.useItem;
export const useCreateEquipment = hooks.useCreate;
export const useUpdateEquipment = hooks.useUpdate;
export const useDeleteEquipment = hooks.useDelete;
