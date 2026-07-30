import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

export interface Settings {
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  clinicLogo?: string;
  currency: string;
  timezone: string;
  appointmentDuration: number;
  maxDailyAppointments: number;
  autoBackupEnabled: boolean;
  backupTime: string;
  createdAt: string;
  updatedAt?: string;
}

export interface UpdateSettingsDto {
  clinicName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicLogo?: string;
  currency?: string;
  timezone?: string;
  appointmentDuration?: number;
  maxDailyAppointments?: number;
  autoBackupEnabled?: boolean;
  backupTime?: string;
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async ({ signal }) => (await api.get<Settings>('/settings', { signal })).data,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: UpdateSettingsDto) => (await api.patch<Settings>('/settings', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}