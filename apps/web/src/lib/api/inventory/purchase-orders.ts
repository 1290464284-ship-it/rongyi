import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { createPaginatedCrudHooks } from '@/lib/hooks/use-crud';

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

const crud = createPaginatedCrudHooks<PurchaseOrder, CreatePurchaseOrderDto, never, PurchaseOrderQuery>('purchase-orders', 'purchase-orders');

export const usePurchaseOrders = crud.useList;
export const usePurchaseOrder = crud.useItem;
export const useCreatePurchaseOrder = crud.useCreate;
export const useDeletePurchaseOrder = crud.useDelete;

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
