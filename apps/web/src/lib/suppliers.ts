import { useCrudPaginated, useCrudItem, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

export interface Supplier {
  id: string;
  name: string;
  code: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  bankAccount?: string;
  remark?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateSupplierDto {
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  bankAccount?: string;
  remark?: string;
}

export interface UpdateSupplierDto {
  name?: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  bankAccount?: string;
  remark?: string;
}

export function useSuppliers(keyword?: string, page?: number, pageSize?: number) {
  return useCrudPaginated<Supplier, { keyword?: string }>('suppliers', 'suppliers', { keyword, page, pageSize });
}

export function useSupplier(id: string | undefined) {
  return useCrudItem<Supplier>('suppliers', 'suppliers', id);
}

export function useCreateSupplier() {
  return useCrudCreate<Supplier, CreateSupplierDto>('suppliers', 'suppliers');
}

export function useUpdateSupplier() {
  return useCrudUpdate<Supplier, UpdateSupplierDto>('suppliers', 'suppliers');
}

export function useDeleteSupplier() {
  return useCrudDelete('suppliers', 'suppliers');
}
