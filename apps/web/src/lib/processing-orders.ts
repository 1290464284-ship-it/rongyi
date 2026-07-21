import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudPaginated, useCrudItem, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

export type ProcessingOrderStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';

export const PROCESSING_ORDER_STATUS_LABEL: Record<ProcessingOrderStatus, string> = {
  PENDING: '待处理',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const PROCESSING_ORDER_STATUS_COLOR: Record<ProcessingOrderStatus, string> = {
  PENDING: 'bg-warning/10 text-warning',
  PROCESSING: 'bg-primary/10 text-primary',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export interface ProcessingOrderItem {
  id?: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  teethNumbers?: number[];
}

export interface ProcessingOrder {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  factoryId: string;
  factoryName: string;
  status: ProcessingOrderStatus;
  totalAmount: number;
  items: ProcessingOrderItem[];
  remark?: string;
  createdAt: string;
  updatedAt?: string;
  patient?: { id: string; name: string; code: string };
}

export interface ProcessingFactory {
  id: string;
  name: string;
  code: string;
  contactName?: string;
  phone?: string;
  address?: string;
  remark?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ProcessingProduct {
  id: string;
  name: string;
  code: string;
  factoryId?: string;
  factoryName?: string;
  price: number;
  unit?: string;
  remark?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateProcessingOrderDto {
  patientId: string;
  factoryId: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: string;
    teethNumbers?: number[];
  }>;
  remark?: string;
}

export interface UpdateProcessingOrderDto {
  factoryId?: string;
  status?: ProcessingOrderStatus;
  remark?: string;
}

export interface CreateProcessingFactoryDto {
  name: string;
  code?: string;
  contactName?: string;
  phone?: string;
  address?: string;
  remark?: string;
}

export interface CreateProcessingProductDto {
  name: string;
  code?: string;
  factoryId?: string;
  price: number;
  unit?: string;
  remark?: string;
}

type ProcessingOrdersQuery = { status?: ProcessingOrderStatus; factoryId?: string; page?: number; pageSize?: number };

export function useProcessingOrders(params: { status?: ProcessingOrderStatus; factoryId?: string; page?: number; pageSize?: number }) {
  return useCrudPaginated<ProcessingOrder, ProcessingOrdersQuery>('processing-orders', 'processing-orders', params);
}

export function useProcessingOrder(id: string | undefined) {
  return useCrudItem<ProcessingOrder>('processing-orders', 'processing-orders', id);
}

export function useCreateProcessingOrder() {
  return useCrudCreate<ProcessingOrder, CreateProcessingOrderDto>('processing-orders', 'processing-orders');
}

export function useUpdateProcessingOrder() {
  return useCrudUpdate<ProcessingOrder, UpdateProcessingOrderDto>('processing-orders', 'processing-orders');
}

export function useDeleteProcessingOrder() {
  return useCrudDelete('processing-orders', 'processing-orders');
}

export function useUpdateProcessingOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ProcessingOrderStatus }) =>
      (await api.patch<ProcessingOrder>(`/processing-orders/${id}/status`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processing-orders'] }),
  });
}

export function useProcessingFactories(params?: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['processing-factories', params],
    queryFn: async () =>
      (await api.get<{ items: ProcessingFactory[]; total: number; page: number; pageSize: number }>('/processing-orders/factories', { params })).data,
  });
}

export function useCreateProcessingFactory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<CreateProcessingFactoryDto>) => (await api.post<ProcessingFactory>('/processing-orders/factories', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processing-factories'] }),
  });
}

export function useUpdateProcessingFactory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateProcessingFactoryDto> }) =>
      (await api.patch<ProcessingFactory>(`/processing-orders/factories/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processing-factories'] }),
  });
}

export function useDeleteProcessingFactory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/processing-orders/factories/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processing-factories'] }),
  });
}

export function useProcessingProducts(params?: { factoryId?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['processing-products', params],
    queryFn: async () =>
      (await api.get<{ items: ProcessingProduct[]; total: number; page: number; pageSize: number }>('/processing-orders/products', { params })).data,
  });
}

export function useCreateProcessingProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<CreateProcessingProductDto>) => (await api.post<ProcessingProduct>('/processing-orders/products', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processing-products'] }),
  });
}

export function useUpdateProcessingProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateProcessingProductDto> }) =>
      (await api.patch<ProcessingProduct>(`/processing-orders/products/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processing-products'] }),
  });
}

export function useDeleteProcessingProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/processing-orders/products/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['processing-products'] }),
  });
}

export function useProcessingStats() {
  return useQuery({
    queryKey: ['processing-stats'],
    queryFn: async () => (await api.get('/processing-orders/stats')).data,
  });
}