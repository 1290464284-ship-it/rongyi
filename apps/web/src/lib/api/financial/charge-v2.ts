import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { useCrudPaginated, useCrudList, useCrudCreate, useCrudUpdate, useCrudDelete } from '@/lib/hooks/use-crud';
import {
  DEBT_STATUS_LABEL,
  DEBT_STATUS_COLOR,
} from '@/lib/types/charge.types';
import type {
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

export { DEBT_STATUS_LABEL, DEBT_STATUS_COLOR };
export type {
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

type DebtsQuery = { patientId?: string; status?: string; page?: number; pageSize?: number };

export function useDebts(params: { patientId?: string; status?: string; page?: number; pageSize?: number }) {
  return useCrudPaginated<DebtRecord, DebtsQuery>('charge-v2/debts', 'debts', params);
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
