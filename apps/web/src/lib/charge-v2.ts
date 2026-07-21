import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudPaginated, useCrudList, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

export interface ChargeComboItem {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
}

export interface ChargeCombo {
  id: string;
  name: string;
  category: string;
  description: string;
  items: ChargeComboItem[];
  totalPrice: number;
  discountPrice: number;
  isActive: boolean;
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  type: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  isEnabled: boolean;
  sortOrder: number;
  remark?: string;
  createdAt: string;
}

export interface DebtRecord {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  amount: number;
  paidAmount: number;
  totalAmount: number;
  remainAmount: number;
  dueDate?: string;
  remark?: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  createdAt: string;
  patient?: { name: string; phone?: string; code?: string };
  charge?: { number: string };
  payments?: Array<{
    id: string;
    amount: number;
    payMethod: string;
    remark?: string;
    createdAt: string;
    paidAt?: string;
    operator?: { name: string };
  }>;
}

export interface CreateChargeComboDto {
  name: string;
  category: string;
  description?: string;
  items: Array<{ name: string; category: string; price: number; quantity: number }>;
  discountPrice?: number;
}

export interface UpdateChargeComboDto {
  name?: string;
  category?: string;
  description?: string;
  items?: Array<{ name: string; category: string; price: number; quantity: number }>;
  discountPrice?: number;
  isActive?: boolean;
}

export interface CreatePaymentMethodDto {
  name: string;
  type: string;
  code: string;
  sortOrder?: number;
  remark?: string;
}

export interface UpdatePaymentMethodDto {
  name?: string;
  code?: string;
  remark?: string;
}

export interface PayDebtDto {
  amount: number;
  payMethod?: string;
  remark?: string;
}

export const DEBT_STATUS_LABEL: Record<string, string> = {
  UNPAID: '未支付',
  PARTIAL: '部分支付',
  PAID: '已支付',
};

export const DEBT_STATUS_COLOR: Record<string, string> = {
  UNPAID: 'bg-destructive/10 text-destructive',
  PARTIAL: 'bg-warning/10 text-warning',
  PAID: 'bg-success/10 text-success',
};

export interface ChargeComboListRes {
  items: ChargeCombo[];
  total: number;
  page: number;
  pageSize: number;
}

type ChargeCombosQuery = { page?: number; pageSize?: number; keyword?: string; category?: string };

export function useChargeCombos(params: { page?: number; pageSize?: number; keyword?: string; category?: string }) {
  return useCrudPaginated<ChargeCombo, ChargeCombosQuery>('charge-v2/combos', 'charge-combos', params);
}

export function useCreateChargeCombo() {
  return useCrudCreate<ChargeCombo, CreateChargeComboDto>('charge-v2/combos', 'charge-combos');
}

export function useUpdateChargeCombo() {
  return useCrudUpdate<ChargeCombo, UpdateChargeComboDto>('charge-v2/combos', 'charge-combos');
}

export function useDeleteChargeCombo() {
  return useCrudDelete('charge-v2/combos', 'charge-combos');
}

type PaymentMethodsQuery = { isEnabled?: boolean };

export function usePaymentMethods(params: { isEnabled?: boolean } = {}) {
  return useCrudList<PaymentMethod, PaymentMethodsQuery>('charge-v2/payment-methods', 'payment-methods', params);
}

export function useCreatePaymentMethod() {
  return useCrudCreate<PaymentMethod, CreatePaymentMethodDto>('charge-v2/payment-methods', 'payment-methods');
}

export function useUpdatePaymentMethod() {
  return useCrudUpdate<PaymentMethod, UpdatePaymentMethodDto>('charge-v2/payment-methods', 'payment-methods');
}

export function useDeletePaymentMethod() {
  return useCrudDelete('charge-v2/payment-methods', 'payment-methods');
}

export function useTogglePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch<PaymentMethod>(`/charge-v2/payment-methods/${id}/toggle`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payment-methods'] }),
  });
}

export interface DebtListRes {
  items: DebtRecord[];
  total: number;
  page: number;
  pageSize: number;
}

type DebtsQuery = { patientId?: string; status?: string; page?: number; pageSize?: number };

export function useDebts(params: { patientId?: string; status?: string; page?: number; pageSize?: number }) {
  return useCrudPaginated<DebtRecord, DebtsQuery>('charge-v2/debts', 'debts', params);
}

export interface DebtStatsRes {
  totalRemain: number;
  thisMonthNew: number;
  thisMonthPaid: number;
  debtCount: number;
  total?: number;
  unpaid?: number;
  partial?: number;
}

export function useDebtStats() {
  return useQuery({
    queryKey: ['debt-stats'],
    queryFn: async () => (await api.get<DebtStatsRes>('/charge-v2/debts/stats')).data,
  });
}

export function usePayDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PayDebtDto }) =>
      (await api.post<DebtRecord>(`/charge-v2/debts/${id}/pay`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['debts'] });
      qc.invalidateQueries({ queryKey: ['debt-stats'] });
    },
  });
}
