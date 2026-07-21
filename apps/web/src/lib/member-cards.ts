import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudPaginated } from './use-crud';

export interface MemberCard {
  id: string;
  patientId: string;
  cardNo: string;
  balance: number;
  totalRecharge: number;
  totalConsume: number;
  points: number;
  totalPoints: number;
  level: string;
  status: string;
  createdAt: string;
  patientName?: string;
  patientCode?: string;
  patientPhone?: string;
}

export interface MemberPointLog {
  id: string;
  cardId: string;
  type: 'EARN' | 'REDEEM';
  points: number;
  balanceAfter: number;
  chargeId?: string | null;
  remark?: string | null;
  createdAt: string;
}

export interface MemberCardListRes {
  items: MemberCard[];
  total: number;
  page: number;
  pageSize: number;
}

type MemberCardsQuery = { page?: number; pageSize?: number };

export function useMemberCards(page = 1, pageSize = 20) {
  return useCrudPaginated<MemberCard, MemberCardsQuery>('member-cards', 'member-cards', { page, pageSize });
}

export function usePatientMemberCard(patientId: string) {
  return useQuery({
    queryKey: ['member-cards', 'patient', patientId],
    queryFn: async () => {
      const res = await api.get(`/member-cards/patient/${patientId}`);
      return res.data as MemberCard | null;
    },
    enabled: !!patientId,
  });
}

export function useCreateMemberCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patientId: string) => {
      const res = await api.post(`/member-cards/patient/${patientId}`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['member-cards'] });
    },
  });
}

export function useRechargeMemberCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, amount, remark }: { id: string; amount: number; remark?: string }) => {
      const res = await api.post(`/member-cards/${id}/recharge`, { amount, remark });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['member-cards'] });
    },
  });
}

export function useMemberCardLogs(cardId: string) {
  return useQuery({
    queryKey: ['member-cards', 'logs', cardId],
    queryFn: async () => {
      const res = await api.get(`/member-cards/${cardId}/logs`);
      return res.data;
    },
    enabled: !!cardId,
  });
}

export function useMemberPointLogs(cardId: string) {
  return useQuery({
    queryKey: ['member-cards', 'point-logs', cardId],
    queryFn: async () => (await api.get<MemberPointLog[]>(`/member-cards/${cardId}/point-logs`)).data,
    enabled: !!cardId,
  });
}

export function useAddPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, points, chargeId, remark }: { id: string; points: number; chargeId?: string; remark?: string }) =>
      (await api.post<MemberCard>(`/member-cards/${id}/points`, { points, chargeId, remark })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['member-cards'] }),
  });
}

export function useDeductPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, points, remark }: { id: string; points: number; remark?: string }) =>
      (await api.post<MemberCard>(`/member-cards/${id}/points/deduct`, { points, remark })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['member-cards'] }),
  });
}
