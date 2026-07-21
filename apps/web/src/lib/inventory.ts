import { api } from './api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCrudPaginated, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

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

export function useInventoryItems(params?: { keyword?: string; category?: string; page?: number; pageSize?: number }) {
  return useCrudPaginated<InventoryItem, InventoryItemQuery>('inventory/items', 'inventory-items', params);
}

export function useLowStockItems() {
  return useQuery({
    queryKey: ['low-stock-items'],
    queryFn: async () => (await api.get<InventoryItem[]>('/inventory/items/low-stock')).data,
  });
}

export function useCreateInventoryItem() {
  return useCrudCreate<InventoryItem, CreateInventoryItemDto>('inventory/items', 'inventory-items');
}

export function useUpdateInventoryItem() {
  return useCrudUpdate<InventoryItem, Partial<CreateInventoryItemDto>>('inventory/items', 'inventory-items');
}

export function useDeleteInventoryItem() {
  return useCrudDelete('inventory/items', 'inventory-items');
}

export function useInventoryTransactions(itemId?: string, page?: number, pageSize?: number) {
  return useQuery({
    queryKey: ['inventory-transactions', itemId, page, pageSize],
    queryFn: async () => (await api.get<Pagination<InventoryTransaction>>('/inventory/transactions', { params: { itemId, page, pageSize } })).data,
  });
}

export function useStockAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: StockActionDto) =>
      (await api.post('/inventory/transactions', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-items', 'inventory-transactions'] }),
  });
}
