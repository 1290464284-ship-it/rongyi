import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useCrudList } from './use-crud';

export type WechatType = 'APPOINTMENT_REMINDER' | 'BIRTHDAY_GREETING' | 'FOLLOW_UP' | 'CUSTOM';
export type WechatStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface WechatMessage {
  id: string;
  patientId?: string | null;
  patientName?: string | null;
  openId?: string | null;
  content: string;
  type: WechatType;
  status: WechatStatus;
  sentAt?: string | null;
  remark?: string | null;
  createdAt: string;
}

export interface SendWechatDto {
  patientId?: string;
  openId?: string;
  content: string;
  type?: WechatType;
  remark?: string;
}

export interface SendBatchWechatDto {
  patientIds: string[];
  content: string;
  type?: WechatType;
}

export interface WechatBirthdayPatient {
  id: string;
  name: string;
  code: string;
  phone: string;
  birthDate?: string | null;
  openId?: string | null;
}

export interface WechatAppointmentReminder {
  id: string;
  patientId: string;
  patientName: string;
  openId?: string | null;
  doctorName: string;
  startTime: string;
}

type WechatMessageQuery = { patientId?: string; type?: string; status?: string };

export function useWechatMessages(params: { patientId?: string; type?: string; status?: string; page?: number; pageSize?: number } = {}) {
  return useCrudList<WechatMessage, WechatMessageQuery>('wechat', 'wechat-messages', params);
}

export function useBirthdayPatients() {
  return useQuery({
    queryKey: ['wechat', 'birthday-patients'],
    queryFn: async () => (await api.get<WechatBirthdayPatient[]>('/wechat/birthday-patients')).data,
  });
}

export function useAppointmentReminders() {
  return useQuery({
    queryKey: ['wechat', 'appointment-reminders'],
    queryFn: async () => (await api.get<WechatAppointmentReminder[]>('/wechat/appointment-reminders')).data,
  });
}

export function useSendWechat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: SendWechatDto) => (await api.post<WechatMessage>('/wechat/send', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wechat-messages'] }),
  });
}

export function useSendBatchWechat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: SendBatchWechatDto) => (await api.post('/wechat/send-batch', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wechat-messages'] }),
  });
}
