import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { useCrudPaginated, useCrudItem, useCrudList, useCrudCreate, useCrudUpdate, useCrudDelete } from '@/lib/hooks/use-crud';
import { getCacheOptions } from '@/lib/api/query-client';
import {
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_COLOR,
  PAY_METHOD_LABEL,
  DEBT_STATUS_LABEL,
  DEBT_STATUS_COLOR,
} from '@/lib/types/charge.types';
import type {
  Charge,
  ChargeStatus,
  PayMethod,
  CreateChargeDto,
  ChargeCombo,
  PaymentMethod,
  DebtRecord,
  CreateChargeComboDto,
  UpdateChargeComboDto,
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PayDebtDto,
  DebtStatsRes,
} from '@/lib/types/charge.types';

// ── Re-exports ──────────────────────────────────────────────────────────────
export {
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_COLOR,
  PAY_METHOD_LABEL,
  DEBT_STATUS_LABEL,
  DEBT_STATUS_COLOR,
};
export type {
  Charge,
  ChargeStatus,
  PayMethod,
  CreateChargeDto,
  ChargeCombo,
  PaymentMethod,
  DebtRecord,
  CreateChargeComboDto,
  UpdateChargeComboDto,
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PayDebtDto,
  DebtStatsRes,
};

// ── 基础收费 ────────────────────────────────────────────────────────────────
type ChargesQuery = {
  patientId?: string;
  status?: ChargeStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
};

export function useCharges(params: {
  patientId?: string;
  status?: ChargeStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
}, opts?: { enabled?: boolean }) {
  return useCrudPaginated<Charge, ChargesQuery>('charge-v2', 'charges', params, { enabled: opts?.enabled });
}

export function useCharge(id: string | undefined) {
  return useCrudItem<Charge>('charge-v2', 'charges', id);
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
    mutationFn: async ({ id, patientId, amount, reason }: { id: string; patientId: string; amount: number; reason?: string }) =>
      (await api.post('/refunds', { chargeId: id, patientId, amount, reason })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['charges'] }),
  });
}

// ── 组合套餐 ────────────────────────────────────────────────────────────────
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

// ── 支付方式 ────────────────────────────────────────────────────────────────
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

// ── 欠费管理 ────────────────────────────────────────────────────────────────
type DebtsQuery = { patientId?: string; status?: string; keyword?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number };

export function useDebts(params: DebtsQuery) {
  return useCrudPaginated<DebtRecord, DebtsQuery>('charge-v2/debts', 'debts', params);
}

export function useDebtStats() {
  return useQuery({
    queryKey: ['debt-stats'],
    queryFn: async ({ signal }) => (await api.get<DebtStatsRes>('/charge-v2/debts/stats', { signal })).data,
    ...getCacheOptions('fast'),
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
