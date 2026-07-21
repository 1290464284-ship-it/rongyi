import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudPaginated, useCrudItem, useCrudCreate } from './use-crud';

/**
 * NOTE: The backend charge API now lives at /charge-v2, not /charges.
 * This module is kept for backward compatibility with ChargePage.tsx.
 * New code should use @/lib/charge-v2.ts for combos/payment-methods/debts.
 */

export type ChargeStatus = 'UNPAID' | 'PAID' | 'REFUNDED' | 'PARTIAL';
export type PayMethod = 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER';

export interface ChargeItem {
  id: string;
  chargeId: string;
  treatmentId?: string | null;
  name: string;
  category: string;
  price: string;
  quantity: number;
  subtotal: string;
  teethNumbers: number[];
  remark?: string | null;
}

export interface Charge {
  id: string;
  patientId: string;
  visitId?: string | null;
  doctorId?: string | null;
  number: string;
  totalAmount: string;
  paidAmount: string;
  discount: string;
  status: ChargeStatus;
  payMethod?: PayMethod | null;
  paidAt?: string | null;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
  items: ChargeItem[];
  patient?: { id: string; name: string; code: string; phone: string };
  doctor?: { id: string; name: string };
}

export interface ChargeListRes {
  items: Charge[];
  total: number;
  page: number;
  pageSize: number;
}

export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  UNPAID: '待支付',
  PAID: '已支付',
  REFUNDED: '已退款',
  PARTIAL: '部分支付',
};

export const CHARGE_STATUS_COLOR: Record<ChargeStatus, string> = {
  UNPAID: 'bg-warning/10 text-warning border-warning/30',
  PAID: 'bg-success/10 text-success border-success/30',
  REFUNDED: 'bg-muted text-muted-foreground border-border',
  PARTIAL: 'bg-primary/10 text-primary border-primary/30',
};

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  CASH: '现金',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  CARD: '银行卡',
  OTHER: '其他',
};

type ChargesQuery = {
  patientId?: string;
  status?: ChargeStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
};

// All API calls now routed to /charge-v2 (backend old /charges removed)
export function useCharges(params: {
  patientId?: string;
  status?: ChargeStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  return useCrudPaginated<Charge, ChargesQuery>('charge-v2', 'charges', params);
}

export function useCharge(id: string | undefined) {
  return useCrudItem<Charge>('charge-v2', 'charges', id);
}

export interface CreateChargeDto {
  patientId: string;
  visitId?: string;
  items: Omit<ChargeItem, 'id' | 'chargeId' | 'subtotal'>[];
  discount?: number;
}

export function useCreateCharge() {
  return useCrudCreate<Charge, CreateChargeDto>('charge-v2', 'charges');
}

export function usePayCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, amount, payMethod }: { id: string; amount: number; payMethod: PayMethod }) =>
      (await api.patch<Charge>(`/charge-v2/${id}/pay`, { amount, payMethod })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['charges'] }),
  });
}

export function useRefundCharge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, remark }: { id: string; remark?: string }) =>
      (await api.patch<Charge>(`/charge-v2/${id}/refund`, { remark })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['charges'] }),
  });
}
