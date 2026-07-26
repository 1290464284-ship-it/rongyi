import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { useCrudPaginated, useCrudItem, useCrudCreate } from '@/lib/hooks/use-crud';
import {
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_COLOR,
  PAY_METHOD_LABEL,
} from '@/lib/types/charge.types';
import type {
  Charge,
  ChargeStatus,
  PayMethod,
  CreateChargeDto,
} from '@/lib/types/charge.types';

export { CHARGE_STATUS_LABEL, CHARGE_STATUS_COLOR, PAY_METHOD_LABEL };
export type { Charge, ChargeStatus, PayMethod, CreateChargeDto };

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
