import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { useCrudPaginated, useCrudDelete } from '@/lib/hooks/use-crud';

export interface BackupRecord {
  id: string;
  filename: string;
  size: number;
  fileSize?: string;
  createdAt: string;
  status: 'SUCCESS' | 'FAILED';
  type?: string;
  operatorName?: string;
  remark?: string;
}

export function useBackups() {
  return useCrudPaginated<BackupRecord>('backups', 'backups');
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data?: { type?: string; remark?: string }) => (await api.post<BackupRecord>('/backups', data || {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });
}

export function useRestoreBackup() {
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/backups/${id}/restore`)).data,
  });
}

export function useDeleteBackup() {
  return useCrudDelete('backups', 'backups');
}
