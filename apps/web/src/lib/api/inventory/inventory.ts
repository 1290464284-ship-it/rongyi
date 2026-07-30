import { api } from '@/lib/api/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';

export interface InventoryItem {
  id: string;
  code: string;
  name: string;
  spec?: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  expireDate?: string;
  location?: string;
  remark?: string;
  supplierId?: string;
  supplierName?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInventoryItemDto {
  code: string;
  name: string;
  spec?: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  supplierId?: string;
}

export interface StockActionDto {
  itemId: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  unitPrice?: string;
  remark?: string;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  itemName: string;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  unitPrice?: string;
  totalAmount?: number;
  beforeStock: number;
  afterStock: number;
  remark?: string;
  operatorId?: string;
  operatorName?: string;
  createdAt: string;
}

export interface Pagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

type InventoryItemQuery = { keyword?: string; category?: string };

const crud = createPaginatedCrudHooks<InventoryItem, CreateInventoryItemDto, Partial<CreateInventoryItemDto>, InventoryItemQuery>('inventory/items', 'inventory-items');

export const useInventoryItems = crud.useList;

export function useLowStockItems() {
  return useQuery({
    queryKey: ['low-stock-items'],
    queryFn: async ({ signal }) => (await api.get<InventoryItem[]>('/inventory/items/low-stock', { signal })).data,
  });
}

export const useCreateInventoryItem = crud.useCreate;
export const useUpdateInventoryItem = crud.useUpdate;
export const useDeleteInventoryItem = crud.useDelete;

export function useInventoryTransactions(itemId?: string, page?: number, pageSize?: number) {
  return useQuery({
    queryKey: ['inventory-transactions', itemId, page, pageSize],
    queryFn: async ({ signal }) => (await api.get<Pagination<InventoryTransaction>>('/inventory/transactions', { params: { itemId, page, pageSize }, signal })).data,
  });
}

export function useStockAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: StockActionDto) =>
      (await api.post('/inventory/transactions', data)).data,
    // 8.3: 分两次调用 invalidateQueries，避免把两元素数组当成 exact key 导致缓存失效失效
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
      qc.invalidateQueries({ queryKey: ['inventory-transactions'] });
    },
  });
}
