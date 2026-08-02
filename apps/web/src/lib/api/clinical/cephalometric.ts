import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { getCacheOptions } from '@/lib/api/query-client';

export const LANDMARK_CODES = [
  'S', 'N', 'A', 'B', 'Pog', 'Gn', 'Me', 'Go', 'Ar', 'Po',
  'O', 'ANS', 'PNS', 'UIE', 'UIA', 'LIE', 'LIA', 'U6M', 'L6M', 'Co',
  'Ptm', 'Xi', 'Ai', 'Bi', 'Sn', 'Is', 'U6DB', 'L6DB', 'A6', 'B6',
] as const;

export type LandmarkCode = typeof LANDMARK_CODES[number];

export const LANDMARK_LABELS: Record<LandmarkCode, string> = {
  S: '蝶鞍点', N: '鼻根点', A: '上齿槽座点', B: '下齿槽座点', Pog: '颏前点',
  Gn: '颏顶点', Me: '颏下点', Go: '下颌角点', Ar: '关节点', Po: '耳点',
  O: '眶点', ANS: '前鼻棘', PNS: '后鼻棘', UIE: '上中切牙切缘', UIA: '上中切牙根尖',
  LIE: '下中切牙切缘', LIA: '下中切牙根尖', U6M: '上6近中尖', L6M: '下6近中尖', Co: '髁突点',
  Ptm: '翼上颌裂点', Xi: '下颌支中心', Ai: '上尖牙尖', Bi: '下尖牙尖', Sn: '鼻下点',
  Is: '上唇缘', U6DB: '上6远中尖', L6DB: '下6远中尖', A6: '上6近中颊尖', B6: '下6近中颊尖',
};

export const REQUIRED_LANDMARKS: LandmarkCode[] = ['S', 'N', 'A', 'B', 'Pog', 'Me', 'Go', 'ANS', 'PNS', 'UIE', 'LIE'];

export const LANDMARK_COLORS: Record<LandmarkCode, string> = {
  S: '#ef4444', N: '#f97316', A: '#eab308', B: '#84cc16', Pog: '#22c55e',
  Gn: '#10b981', Me: '#14b8a6', Go: '#06b6d4', Ar: '#0ea5e9', Po: '#3b82f6',
  O: '#6366f1', ANS: '#8b5cf6', PNS: '#a855f7', UIE: '#d946ef', UIA: '#ec4899',
  LIE: '#f43f5e', LIA: '#dc2626', U6M: '#ea580c', L6M: '#ca8a04', Co: '#65a30d',
  Ptm: '#16a34a', Xi: '#0d9488', Ai: '#0891b2', Bi: '#0284c7', Sn: '#2563eb',
  Is: '#4f46e5', U6DB: '#7c3aed', L6DB: '#9333ea', A6: '#c026d3', B6: '#db2777',
};

export interface Landmark {
  code: LandmarkCode;
  x: number | null;
  y: number | null;
}

export const ANALYSIS_METHODS = ['Steiner', 'Downs', 'Tweed', 'McNamara'] as const;
export type AnalysisMethod = typeof ANALYSIS_METHODS[number];

export const METHOD_LABEL: Record<AnalysisMethod, string> = {
  Steiner: 'Steiner 分析法',
  Downs: 'Downs 分析法',
  Tweed: 'Tweed 分析法',
  McNamara: 'McNamara 分析法',
};

export interface LandmarkSet {
  id: string;
  patientId: string;
  patientName?: string;
  imagingId?: string;
  name: string;
  analysisMethod?: AnalysisMethod;
  landmarks: Landmark[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateLandmarkSetDto {
  patientId: string;
  imagingId?: string;
  name: string;
  analysisMethod?: AnalysisMethod;
  landmarks: Landmark[];
}

export interface UpdateLandmarkSetDto {
  name?: string;
  analysisMethod?: AnalysisMethod;
  landmarks?: Landmark[];
}

export type MetricDirection = 'UP' | 'NORMAL' | 'DOWN';

export interface Metric {
  code: string;
  label: string;
  value: number;
  unit: string;
  normalRange: [number, number];
  direction: MetricDirection;
  method: AnalysisMethod;
  description?: string;
}

export interface AnalyzeResult {
  id: string;
  landmarkSetId: string;
  method?: AnalysisMethod;
  metrics: Metric[];
  createdAt: string;
}

export interface CompareItem {
  code: string;
  label: string;
  value1: number;
  value2: number;
  delta: number;
  arrow: '↗' | '↘' | '→';
  unit: string;
}

export interface NormValue {
  id?: string;
  code: string;
  label: string;
  method: AnalysisMethod;
  adultChild: 'ADULT' | 'CHILD';
  gender: 'MALE' | 'FEMALE' | 'ALL';
  min: number;
  max: number;
  unit: string;
  source?: string;
}

export function useLandmarkSets(params: { patientId?: string }) {
  return useQuery({
    queryKey: ['cephalometric-landmark-sets', params],
    queryFn: async ({ signal }) => {
      const res = await api.get<LandmarkSet[]>('/cephalometric/landmark-sets', { params, signal });
      return res.data;
    },
    enabled: !!params.patientId,
  });
}

export function useLandmarkSet(id: string | undefined) {
  return useQuery({
    queryKey: ['cephalometric-landmark-set', id],
    queryFn: async ({ signal }) => {
      const res = await api.get<LandmarkSet>(`/cephalometric/landmark-sets/${id}`, { signal });
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateLandmarkSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateLandmarkSetDto) =>
      (await api.post<LandmarkSet>('/cephalometric/landmark-sets', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cephalometric-landmark-sets'] }),
  });
}

export function useUpdateLandmarkSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLandmarkSetDto }) =>
      (await api.patch<LandmarkSet>(`/cephalometric/landmark-sets/${id}`, data)).data,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['cephalometric-landmark-sets'] });
      qc.invalidateQueries({ queryKey: ['cephalometric-landmark-set', vars.id] });
    },
  });
}

export function useAnalyzeLandmarkSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, method }: { id: string; method?: AnalysisMethod }) =>
      (await api.post<AnalyzeResult>(`/cephalometric/landmark-sets/${id}/analyze`, { method })).data,
    onSuccess: (result) => {
      qc.setQueryData(['cephalometric-analysis', result.id], result);
      qc.invalidateQueries({ queryKey: ['cephalometric-analyses'] });
    },
  });
}

export function useAnalysis(id: string | undefined) {
  return useQuery({
    queryKey: ['cephalometric-analysis', id],
    queryFn: async ({ signal }) => {
      const res = await api.get<AnalyzeResult>(`/cephalometric/analyses/${id}`, { signal });
      return res.data;
    },
    enabled: !!id,
  });
}

export function useAnalyses(params: { patientId?: string }) {
  return useQuery({
    queryKey: ['cephalometric-analyses', params],
    queryFn: async ({ signal }) => {
      const res = await api.get<AnalyzeResult[]>('/cephalometric/analyses', { params, signal });
      return res.data;
    },
    enabled: !!params.patientId,
  });
}

export function useCompareAnalyses() {
  return useMutation({
    mutationFn: async ({ id1, id2 }: { id1: string; id2: string }) => {
      const res = await api.post<CompareItem[]>('/cephalometric/analyses/compare', { id1, id2 });
      return res.data;
    },
  });
}

export function useNormValues() {
  return useQuery({
    queryKey: ['cephalometric-norm-values'],
    queryFn: async ({ signal }) => {
      const res = await api.get<NormValue[]>('/cephalometric/norm-values', { signal });
      return res.data;
    },
    ...getCacheOptions('dict'),
  });
}

export function useCreateNormValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<NormValue, 'id'>) =>
      (await api.post<NormValue>('/cephalometric/norm-values', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cephalometric-norm-values'] }),
  });
}

export function usePrintCephalometricReport() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<{ url: string }>(`/print/cephalometric-report/${id}`);
      return res.data;
    },
  });
}
