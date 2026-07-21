import { createCrudHooks } from './use-crud';

export interface Chair {
  id: string;
  name: string;
  location?: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChairDto {
  name: string;
  location?: string;
}

export interface UpdateChairDto {
  name?: string;
  location?: string;
  active?: number;
}

const hooks = createCrudHooks<Chair, CreateChairDto, UpdateChairDto>('chairs', 'chairs');

export const useChairs = hooks.useList;
export const useChair = hooks.useItem;
export const useCreateChair = hooks.useCreate;
export const useUpdateChair = hooks.useUpdate;
export const useDeleteChair = hooks.useDelete;
