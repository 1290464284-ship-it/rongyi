import { createCrudHooks } from './hooks/use-crud';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_STATUS_LABEL,
  EQUIPMENT_STATUS_COLOR,
} from '@dental/shared';

export { EQUIPMENT_CATEGORIES, EQUIPMENT_STATUS_LABEL, EQUIPMENT_STATUS_COLOR };

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
  status: 'NORMAL' | 'MAINTENANCE' | 'BROKEN' | 'SCRAPPED';
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

export type EquipmentStatus = 'NORMAL' | 'MAINTENANCE' | 'BROKEN' | 'SCRAPPED';

const hooks = createCrudHooks<Equipment, CreateEquipmentDto, UpdateEquipmentDto, QueryEquipmentDto>(
  'equipment',
  'equipment',
  { cacheStrategy: 'dict' },
);

export const useEquipmentList = hooks.useList;
export const useEquipmentItem = hooks.useItem;
export const useCreateEquipment = hooks.useCreate;
export const useUpdateEquipment = hooks.useUpdate;
export const useDeleteEquipment = hooks.useDelete;
