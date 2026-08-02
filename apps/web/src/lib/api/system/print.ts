import { api } from '@/lib/api/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface PrintTemplate {
  id: string;
  code: string;
  name: string;
  type: 'prescription' | 'receipt' | 'treatment' | 'clinicReport' | 'cephalometric' | 'custom';
  paperSize: 'A4' | 'A5' | 'RECEIPT';
  isDefault: boolean;
  content: string;
  sampleContext?: SampleContext;
  createdAt: string;
  updatedAt?: string;
}

export interface SampleContext {
  prescriptionSample?: PrescriptionSample;
  receiptSample?: ReceiptSample;
  planSample?: PlanSample;
  reportSample?: ReportSample;
}

export interface PrescriptionSample {
  patientName: string;
  patientAge: number;
  patientGender: string;
  diagnosis: string;
  medicines: Array<{
    name: string;
    specification: string;
    dosage: string;
    frequency: string;
    duration: string;
    quantity: number;
  }>;
  doctorName: string;
  date: string;
  clinicName: string;
}

export interface ReceiptSample {
  receiptNo: string;
  patientName: string;
  items: Array<{
    name: string;
    price: number;
    quantity: number;
    subtotal: number;
  }>;
  total: number;
  paid: number;
  change: number;
  paymentMethod: string;
  cashierName: string;
  date: string;
  clinicName: string;
}

export interface PlanSample {
  patientName: string;
  planName: string;
  stages: Array<{
    name: string;
    description: string;
    estimatedFee: number;
    duration: string;
  }>;
  totalFee: number;
  doctorName: string;
  date: string;
  clinicName: string;
}

export interface ReportSample {
  month: string;
  revenue: number;
  patientCount: number;
  visitCount: number;
  topServices: Array<{
    name: string;
    count: number;
    revenue: number;
  }>;
  doctorStats: Array<{
    name: string;
    visitCount: number;
    revenue: number;
  }>;
  clinicName: string;
  generatedAt: string;
}

export interface UpdateTemplateDto {
  name?: string;
  content?: string;
  paperSize?: 'A4' | 'A5' | 'RECEIPT';
  sampleContext?: SampleContext;
}

export async function getTemplates(): Promise<PrintTemplate[]> {
  const res = await api.get<{ data: PrintTemplate[] }>('/print/templates');
  return res.data.data;
}

export async function getTemplate(code: string): Promise<PrintTemplate> {
  const res = await api.get<{ data: PrintTemplate }>(`/print/templates/${code}`);
  return res.data.data;
}

export async function updateTemplate(
  code: string,
  data: UpdateTemplateDto
): Promise<PrintTemplate> {
  const res = await api.put<{ data: PrintTemplate }>(`/print/templates/${code}`, data);
  return res.data.data;
}

export async function setDefault(code: string): Promise<PrintTemplate> {
  const res = await api.post<{ data: PrintTemplate }>(`/print/templates/${code}/default`);
  return res.data.data;
}

export async function previewTemplate(
  code: string,
  sampleContext?: SampleContext
): Promise<string> {
  const res = await api.post<{ data: string }>(
    `/print/templates/${code}/preview`,
    sampleContext ? { sampleContext } : {}
  );
  return res.data.data;
}

export async function renderPrescription(id: string): Promise<string> {
  const res = await api.post<{ data: string }>(`/print/prescription/${id}`);
  return res.data.data;
}

export async function renderReceipt(id: string): Promise<string> {
  const res = await api.post<{ data: string }>(`/print/receipt/${id}`);
  return res.data.data;
}

export async function renderTreatmentPlan(id: string): Promise<string> {
  const res = await api.post<{ data: string }>(`/print/treatment-plan/${id}`);
  return res.data.data;
}

export async function renderClinicReport(month: string): Promise<string> {
  const res = await api.post<{ data: string }>(`/print/clinic-report?month=${month}`);
  return res.data.data;
}

export async function renderCephalometricReport(id: string): Promise<string> {
  const res = await api.post<{ data: string }>(`/print/cephalometric-report/${id}`);
  return res.data.data;
}

export function useTemplates() {
  return useQuery({
    queryKey: ['print-templates'],
    queryFn: getTemplates,
  });
}

export function useTemplate(code: string | undefined) {
  return useQuery({
    queryKey: ['print-template', code],
    queryFn: () => getTemplate(code!),
    enabled: !!code,
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, data }: { code: string; data: UpdateTemplateDto }) =>
      updateTemplate(code, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['print-templates'] }),
  });
}

export function useSetDefaultTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setDefault,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['print-templates'] }),
  });
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: ({
      code,
      sampleContext,
    }: {
      code: string;
      sampleContext?: SampleContext;
    }) => previewTemplate(code, sampleContext),
  });
}

export function useRenderPrescription() {
  return useMutation({
    mutationFn: renderPrescription,
  });
}

export function useRenderReceipt() {
  return useMutation({
    mutationFn: renderReceipt,
  });
}

export function useRenderTreatmentPlan() {
  return useMutation({
    mutationFn: renderTreatmentPlan,
  });
}

export function useRenderClinicReport() {
  return useMutation({
    mutationFn: renderClinicReport,
  });
}

export function useRenderCephalometricReport() {
  return useMutation({
    mutationFn: renderCephalometricReport,
  });
}
