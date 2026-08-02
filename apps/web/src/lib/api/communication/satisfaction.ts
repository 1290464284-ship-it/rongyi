import { api } from '@/lib/api/api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export type NpsCategory = 'PROMOTER' | 'PASSIVE' | 'DETRACTOR';
export type SurveySource = 'QR_CODE' | 'SMS' | 'LINK' | 'MANUAL';
export type KeywordSentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
export type AcknowledgeStatus = 'PENDING' | 'ACKNOWLEDGED';

export interface DimensionRatings {
  medical: number;
  service: number;
  environment: number;
  price: number;
  wait: number;
}

export interface SatisfactionSurvey {
  id: string;
  visitId: string;
  patientId?: string;
  patientName?: string;
  patientCode?: string;
  doctorId?: string;
  doctorName?: string;
  source: SurveySource;
  nps: number;
  npsCategory: NpsCategory;
  ratingQuality: number;
  ratingService: number;
  ratingEnvironment: number;
  ratingPrice: number;
  ratingWait: number;
  avgRating: number;
  comment?: string;
  tags?: string[];
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgeNote?: string;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NpsPoint {
  date: string;
  nps: number;
  total: number;
  promoters?: number;
  passives?: number;
  detractors?: number;
}

export interface DoctorRankingItem {
  doctorId: string;
  name: string;
  nps: number;
  count: number;
  sample: number;
  avgRating?: number;
}

export interface KeywordItem {
  tag: string;
  count: number;
  sentiment: KeywordSentiment;
}

export interface SatisfactionDashboard {
  totalSurveys: number;
  promoters: number;
  passives: number;
  detractors: number;
  nps: number;
  avgRating: number;
  avgDimensionRatings: DimensionRatings;
  topDoctors: DoctorRankingItem[];
  bottomDoctors: DoctorRankingItem[];
  keywords: KeywordItem[];
  trend: NpsPoint[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SurveysQuery {
  from?: string;
  to?: string;
  userId?: string;
  npsCategory?: NpsCategory;
  rating?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface CreateSurveyDto {
  visitId: string;
  doctorId?: string;
  source: SurveySource;
  nps: number;
  ratingQuality: number;
  ratingService: number;
  ratingEnvironment: number;
  ratingPrice: number;
  ratingWait: number;
  comment?: string;
  tags?: string[];
}

export interface AcknowledgeSurveyDto {
  acknowledgedBy: string;
  note?: string;
}

export interface NpsTrendQuery {
  days?: number;
  interval?: 'day' | 'week';
}

export interface DashboardQuery {
  from?: string;
  to?: string;
}

export const NPS_CATEGORY_LABEL: Record<NpsCategory, string> = {
  PROMOTER: '推荐者',
  PASSIVE: '中立者',
  DETRACTOR: '贬损者',
};

export const NPS_CATEGORY_COLOR: Record<NpsCategory, string> = {
  PROMOTER: 'bg-success/10 text-success',
  PASSIVE: 'bg-warning/10 text-warning',
  DETRACTOR: 'bg-destructive/10 text-destructive',
};

export const SOURCE_LABEL: Record<SurveySource, string> = {
  QR_CODE: '扫码',
  SMS: '短信',
  LINK: '链接',
  MANUAL: '手动录入',
};

export const SENTIMENT_LABEL: Record<KeywordSentiment, string> = {
  POSITIVE: '正面',
  NEGATIVE: '负面',
  NEUTRAL: '中性',
};

export const SENTIMENT_COLOR: Record<KeywordSentiment, string> = {
  POSITIVE: '#10b981',
  NEGATIVE: '#ef4444',
  NEUTRAL: '#9ca3af',
};

export const DIMENSION_LABEL: Record<keyof DimensionRatings, string> = {
  medical: '医疗质量',
  service: '服务态度',
  environment: '环境设施',
  price: '价格合理',
  wait: '等候时间',
};

export const POSITIVE_KEYWORDS = [
  '医术精湛', '态度和蔼', '耐心细致', '环境整洁', '设备先进',
  '价格公道', '等候时间短', '服务周到', '解释清楚', '值得推荐',
];

export const NEGATIVE_KEYWORDS = [
  '态度差', '等候太久', '价格贵', '环境差', '设备陈旧',
  '解释不清', '流程复杂', '医术一般', '不专业', '体验差',
];

export function getNpsCategory(nps: number): NpsCategory {
  if (nps >= 9) return 'PROMOTER';
  if (nps >= 7) return 'PASSIVE';
  return 'DETRACTOR';
}

export function getNpsColor(nps: number): string {
  if (nps >= 60) return '#10b981';
  if (nps >= 30) return '#f59e0b';
  return '#ef4444';
}

export function useSatisfactionSurveys(params: SurveysQuery = {}) {
  return useQuery({
    queryKey: ['satisfaction-surveys', params],
    queryFn: async ({ signal }) => {
      const res = await api.get<Paginated<SatisfactionSurvey>>('/satisfaction/surveys', { params, signal });
      return res.data;
    },
  });
}

export function useSatisfactionDashboard(params: DashboardQuery = {}) {
  return useQuery({
    queryKey: ['satisfaction-dashboard', params],
    queryFn: async ({ signal }) => {
      const res = await api.get<SatisfactionDashboard>('/satisfaction/dashboard', { params, signal });
      return res.data;
    },
  });
}

export function useNpsTrend(params: NpsTrendQuery = {}) {
  return useQuery({
    queryKey: ['satisfaction-nps-trend', params],
    queryFn: async ({ signal }) => {
      const res = await api.get<NpsPoint[]>('/satisfaction/nps-trend', { params, signal });
      return res.data;
    },
  });
}

export function useCreateSatisfactionSurvey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateSurveyDto) =>
      (await api.post<SatisfactionSurvey>('/satisfaction/surveys', data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['satisfaction-surveys'] });
      qc.invalidateQueries({ queryKey: ['satisfaction-dashboard'] });
      qc.invalidateQueries({ queryKey: ['satisfaction-nps-trend'] });
    },
  });
}

export function useAcknowledgeSurvey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: AcknowledgeSurveyDto }) =>
      (await api.patch<SatisfactionSurvey>(`/satisfaction/surveys/${id}/acknowledge`, data)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['satisfaction-surveys'] });
      qc.invalidateQueries({ queryKey: ['satisfaction-dashboard'] });
    },
  });
}
