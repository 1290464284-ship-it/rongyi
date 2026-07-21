import { api } from './api';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCrudPaginated, useCrudCreate, useCrudUpdate, useCrudDelete } from './use-crud';

export type FollowUpStatus = 'PENDING' | 'IN_PROGRESS' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
export type FollowUpPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type FollowUpMethod = 'CALL' | 'SMS' | 'WECHAT' | 'EMAIL';

export interface FollowUpV2 {
  id: string;
  patientId: string;
  patientName: string;
  patientCode: string;
  patientPhone: string;
  title?: string;
  description?: string;
  type: string;
  content: string;
  status: FollowUpStatus;
  priority: FollowUpPriority;
  method?: FollowUpMethod;
  followUpDate: string;
  dueDate?: string;
  templateId?: string;
  template?: { id: string; name: string; type?: string; items?: Array<{ id: string; name: string; type?: string }> };
  assigneeId?: string;
  assignee?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  patient?: { id: string; name: string; code: string; phone: string };
}

export interface FollowUpTemplate {
  id: string;
  name: string;
  type: string;
  category?: string;
  content: string;
  description?: string;
  items?: Array<{ id: string; name: string; type?: string }>;
  isActive: boolean;
  isEnabled?: boolean;
  createdAt: string;
}

export interface FollowUpItem {
  id: string;
  name: string;
  type: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  isRequired?: boolean;
  templateId?: string;
  options?: Array<{ id: string; label: string; value: string }>;
  createdAt: string;
}

export interface FollowUpAutoRule {
  id: string;
  name: string;
  triggerType: string;
  conditions: Record<string, any>;
  actions: Record<string, any>;
  delayDays?: number;
  templateId?: string;
  template?: { id: string; name: string };
  assigneeId?: string;
  priority?: FollowUpPriority;
  description?: string;
  isActive: boolean;
  isEnabled?: boolean;
  createdAt: string;
}

export interface FollowUpWorkloadStats {
  total: number;
  completed: number;
  pending: number;
  inProgress?: number;
  overdue?: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byAssignee?: Array<{ assigneeId: string; assigneeName: string; total: number; completed: number; pending: number }>;
}

export interface FollowUpNpsStats {
  score: number;
  npsScore?: number;
  count: number;
  promoters?: number;
  passives?: number;
  detractors?: number;
  totalResponses?: number;
  averageScore?: number;
  trend: Array<{ date: string; score: number }>;
}

export interface Pagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateFollowUpV2Dto {
  patientId: string;
  templateId?: string;
  assigneeId?: string;
  title?: string;
  description?: string;
  type?: string;
  content?: string;
  priority?: FollowUpPriority;
  method?: FollowUpMethod;
  followUpDate?: string;
  dueDate?: string;
}

export interface UpdateFollowUpV2Dto {
  type?: string;
  content?: string;
  title?: string;
  description?: string;
  priority?: FollowUpPriority;
  method?: FollowUpMethod;
  followUpDate?: string;
  dueDate?: string;
  status?: FollowUpStatus;
  templateId?: string;
  assigneeId?: string;
}

export interface CompleteFollowUpV2Dto {
  result?: string;
  results?: Array<{ itemId: string; value: string }>;
  notes?: string;
}

export interface CreateFollowUpTemplateDto {
  name: string;
  type?: string;
  category?: string;
  content?: string;
  description?: string;
  items?: Array<{ name: string; type: string; description?: string; isActive?: boolean; isRequired?: boolean; options?: Array<{ id?: string; label: string; value: string }>; sortOrder?: number; createdAt?: string }>;
}

export interface UpdateFollowUpTemplateDto {
  name?: string;
  type?: string;
  category?: string;
  content?: string;
  description?: string;
  items?: Array<{ id?: string; name: string; type: string; isRequired?: boolean; options?: Array<{ label: string; value: string }> }>;
}

export interface CreateFollowUpItemDto {
  name: string;
  type: string;
  description?: string;
  sortOrder?: number;
  isRequired?: boolean;
  templateId?: string;
  options?: Array<{ label: string; value: string } | string>;
}

export interface UpdateFollowUpItemDto {
  name?: string;
  type?: string;
  description?: string;
  sortOrder?: number;
  isRequired?: boolean;
  options?: Array<{ id?: string; label: string; value: string } | string>;
}

export interface CreateFollowUpAutoRuleDto {
  name: string;
  triggerType: string;
  conditions?: Record<string, any>;
  actions?: Record<string, any>;
  delayDays?: number;
  templateId?: string;
  assigneeId?: string;
  priority?: FollowUpPriority;
  description?: string;
  isEnabled?: boolean;
}

export interface UpdateFollowUpAutoRuleDto {
  name?: string;
  triggerType?: string;
  conditions?: Record<string, any>;
  actions?: Record<string, any>;
  delayDays?: number;
  templateId?: string;
  assigneeId?: string;
  priority?: FollowUpPriority;
  description?: string;
  isEnabled?: boolean;
}

export const FOLLOW_UP_STATUS_LABEL: Record<FollowUpStatus, string> = {
  PENDING: '待处理',
  IN_PROGRESS: '处理中',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const FOLLOW_UP_STATUS_COLOR: Record<FollowUpStatus, string> = {
  PENDING: 'bg-warning/10 text-warning',
  IN_PROGRESS: 'bg-info/10 text-info',
  PROCESSING: 'bg-info/10 text-info',
  COMPLETED: 'bg-success/10 text-success',
  CANCELLED: 'bg-muted/10 text-muted-foreground',
};

export const FOLLOW_UP_PRIORITY_LABEL: Record<FollowUpPriority, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '紧急',
};

export const FOLLOW_UP_PRIORITY_COLOR: Record<FollowUpPriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-yellow-100 text-yellow-600',
  URGENT: 'bg-red-100 text-red-600',
};

export const FOLLOW_UP_ITEM_TYPE_LABEL: Record<string, string> = {
  CALL: '电话回访',
  SMS: '短信回访',
  WECHAT: '微信回访',
  EMAIL: '邮件回访',
};

type FollowUpsV2Query = {
  patientId?: string;
  status?: FollowUpStatus;
  type?: string;
  priority?: FollowUpPriority;
  page?: number;
  pageSize?: number;
};

export function useFollowUpsV2(params: {
  patientId?: string;
  status?: FollowUpStatus;
  type?: string;
  priority?: FollowUpPriority;
  page?: number;
  pageSize?: number;
}) {
  return useCrudPaginated<FollowUpV2, FollowUpsV2Query>('follow-ups-v2', 'follow-ups-v2', params);
}

export function useCreateFollowUpV2() {
  return useCrudCreate<FollowUpV2, CreateFollowUpV2Dto>('follow-ups-v2', 'follow-ups-v2');
}

export function useUpdateFollowUpV2() {
  return useCrudUpdate<FollowUpV2, UpdateFollowUpV2Dto>('follow-ups-v2', 'follow-ups-v2');
}

export function useDeleteFollowUpV2() {
  return useCrudDelete('follow-ups-v2', 'follow-ups-v2');
}

export function useCompleteFollowUpV2() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: CompleteFollowUpV2Dto }) =>
      (await api.post<FollowUpV2>(`/follow-ups-v2/${id}/complete`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-ups-v2'] }),
  });
}

export function useFollowUpTemplates(params?: { page?: number; pageSize?: number; isEnabled?: boolean }) {
  return useQuery({
    queryKey: ['follow-up-templates', params],
    queryFn: async () => {
      const data = (await api.get<FollowUpTemplate[]>('/follow-ups-v2/templates/list', { params })).data;
      return {
        items: data,
        total: data.length,
        page: params?.page || 1,
        pageSize: params?.pageSize || 10,
      } as Pagination<FollowUpTemplate>;
    },
  });
}

export function useCreateFollowUpTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateFollowUpTemplateDto) =>
      (await api.post<FollowUpTemplate>('/follow-ups-v2/templates', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-templates'] }),
  });
}

export function useUpdateFollowUpTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateFollowUpTemplateDto }) =>
      (await api.patch<FollowUpTemplate>(`/follow-ups-v2/templates/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-templates'] }),
  });
}

export function useDeleteFollowUpTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/follow-ups-v2/templates/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-templates'] }),
  });
}

export function useToggleFollowUpTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<FollowUpTemplate>(`/follow-ups-v2/templates/${id}/toggle`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-templates'] }),
  });
}

export function useFollowUpItems(params?: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['follow-up-items', params],
    queryFn: async () => {
      const data = (await api.get<FollowUpItem[]>('/follow-ups-v2/items/list', { params })).data;
      return {
        items: data,
        total: data.length,
        page: params?.page || 1,
        pageSize: params?.pageSize || 10,
      } as Pagination<FollowUpItem>;
    },
  });
}

export function useCreateFollowUpItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateFollowUpItemDto) =>
      (await api.post<FollowUpItem>('/follow-ups-v2/items', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-items'] }),
  });
}

export function useUpdateFollowUpItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateFollowUpItemDto }) =>
      (await api.patch<FollowUpItem>(`/follow-ups-v2/items/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-items'] }),
  });
}

export function useDeleteFollowUpItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/follow-ups-v2/items/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-items'] }),
  });
}

export function useFollowUpAutoRules(params?: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['follow-up-auto-rules', params],
    queryFn: async () => {
      const data = (await api.get<FollowUpAutoRule[]>('/follow-ups-v2/auto-rules/list', { params })).data;
      return {
        items: data,
        total: data.length,
        page: params?.page || 1,
        pageSize: params?.pageSize || 10,
      } as Pagination<FollowUpAutoRule>;
    },
  });
}

export function useCreateFollowUpAutoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateFollowUpAutoRuleDto) =>
      (await api.post<FollowUpAutoRule>('/follow-ups-v2/auto-rules', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-auto-rules'] }),
  });
}

export function useUpdateFollowUpAutoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateFollowUpAutoRuleDto }) =>
      (await api.patch<FollowUpAutoRule>(`/follow-ups-v2/auto-rules/${id}`, data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-auto-rules'] }),
  });
}

export function useDeleteFollowUpAutoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.delete(`/follow-ups-v2/auto-rules/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-auto-rules'] }),
  });
}

export function useToggleFollowUpAutoRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (await api.post<FollowUpAutoRule>(`/follow-ups-v2/auto-rules/${id}/toggle`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-up-auto-rules'] }),
  });
}

export function useFollowUpWorkloadStats(params?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['follow-up-workload-stats', params],
    queryFn: async () => (await api.get<FollowUpWorkloadStats>('/follow-ups-v2/stats/workload', { params })).data,
  });
}

export function useFollowUpNpsStats(params?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['follow-up-nps-stats', params],
    queryFn: async () => (await api.get<FollowUpNpsStats>('/follow-ups-v2/stats/nps', { params })).data,
  });
}
