import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudPaginated, useCrudItem, useCrudCreate, useCrudDelete } from './use-crud';

export type PurchaseOrderStatus = 'PENDING' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItem {
  id?: string;
  itemId: string;
  name: string;
  spec: string;
  quantity: number;
  unitPrice: string;
  subtotal?: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  totalAmount: number;
  remark?: string;
  operatorName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreatePurchaseOrderDto {
  supplierId: string;
  items: Array<{
    itemId: string;
    name: string;
    spec?: string;
    quantity: number;
    unitPrice: string;
  }>;
  remark?: string;
}

type PurchaseOrderQuery = { status?: PurchaseOrderStatus };

export function usePurchaseOrders(params: { status?: PurchaseOrderStatus; page?: number; pageSize?: number }) {
  return useCrudPaginated<PurchaseOrder, PurchaseOrderQuery>('purchase-orders', 'purchase-orders', params);
}

export function usePurchaseOrder(id: string | undefined) {
  return useCrudItem<PurchaseOrder>('purchase-orders', 'purchase-orders', id);
}

export function useCreatePurchaseOrder() {
  return useCrudCreate<PurchaseOrder, CreatePurchaseOrderDto>('purchase-orders', 'purchase-orders');
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<PurchaseOrder>(`/purchase-orders/${id}/receive`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
    },
  });
}

export function useCancelPurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
}

export function useDeletePurchaseOrder() {
  return useCrudDelete('purchase-orders', 'purchase-orders');
}
