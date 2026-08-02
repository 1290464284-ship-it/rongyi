import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

export type BulkImportType = 'patient' | 'drug' | 'inventory';

export interface TemplateColumn {
  key: string;
  label: string;
  required?: boolean;
  example?: string;
  description?: string;
  type?: 'string' | 'number' | 'date' | 'boolean';
}

export interface TemplateResponse {
  type: BulkImportType;
  columns: TemplateColumn[];
}

export interface RowError {
  rowNumber: number;
  field?: string;
  errorCode: string;
  message: string;
}

export interface ImportSummary {
  type: BulkImportType;
  dryRun: boolean;
  total: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errors: RowError[];
  durationMs?: number;
  importedIds?: (string | number)[];
}

export interface RunImportBody {
  type: BulkImportType;
  rows: Record<string, unknown>[];
  dryRun: boolean;
  strict?: boolean;
  autoCreateDrug?: boolean;
}

export function useBulkImportTemplate(type: BulkImportType) {
  return useQuery({
    queryKey: ['bulk-import-template', type],
    queryFn: async ({ signal }) =>
      (await api.get<TemplateResponse>('/system/bulk-import/template', { params: { type }, signal })).data,
    enabled: false,
  });
}

export function useRunBulkImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RunImportBody) =>
      (await api.post<ImportSummary>('/system/bulk-import/run', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk-import'] }),
  });
}

export async function getTemplate(type: BulkImportType): Promise<TemplateResponse> {
  return (await api.get<TemplateResponse>('/system/bulk-import/template', { params: { type } })).data;
}

export async function runImport(body: RunImportBody): Promise<ImportSummary> {
  return (await api.post<ImportSummary>('/system/bulk-import/run', body)).data;
}
