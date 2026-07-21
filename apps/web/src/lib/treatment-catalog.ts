import { createPaginatedCrudHooks } from './use-crud';

export interface TreatmentCatalogItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  remark?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateTreatmentCatalogDto {
  code: string;
  name: string;
  category: string;
  price: number;
  remark?: string;
}

export interface UpdateTreatmentCatalogDto {
  code?: string;
  name?: string;
  category?: string;
  price?: number;
  remark?: string;
}

const hooks = createPaginatedCrudHooks<TreatmentCatalogItem, CreateTreatmentCatalogDto, UpdateTreatmentCatalogDto>(
  'treatments/catalog',
  'treatment-catalog',
);

export const useTreatmentCatalog = hooks.useList;
export const useCreateTreatmentCatalogItem = hooks.useCreate;
export const useUpdateTreatmentCatalogItem = hooks.useUpdate;
export const useDeleteTreatmentCatalogItem = hooks.useDelete;
