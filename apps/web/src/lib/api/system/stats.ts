import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

export interface DashboardStats {
  today: {
    appointments: number;
    visits: number;
    newPatients: number;
    charges: number;
  };
  finance: {
    unpaidAmount: string;
    monthRevenue: string;
    totalIncome: string;
    monthChargeCount: number;
    unpaidCount: number;
  };
  pendingCharges: Array<{
    id: string;
    patientName: string;
    totalAmount: string;
    paidAmount: string;
    number: string;
  }>;
  patients: {
    total: number;
    recent: Array<{
      id: string;
      name: string;
      phone: string;
      lastVisit: string;
      createdAt: string;
    }>;
  };
}

export interface ChargeStats {
  daily: Array<{ date: string; amount: number; count: number }>;
  monthly: Array<{ month: string; amount: number; count: number }>;
}

export interface PatientStats {
  daily: Array<{ date: string; count: number }>;
  monthly: Array<{ month: string; count: number }>;
}

export interface RevenueCategoryItem {
  category: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface RevenueDoctorItem {
  doctorId: string;
  doctorName: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface RevenueData {
  date: string;
  amount: number;
  count: number;
  category?: string;
  payMethod?: string;
  categories?: RevenueCategoryItem[];
  payMethods?: Array<{ method: string; amount: number }>;
  timeline?: Array<{ date: string; amount: number; count: number; revenue: number }>;
  summary?: {
    totalRevenue: string;
    totalCount: number;
    totalDiscount: string;
    avgPerOrder: string;
  };
}

export interface PatientGrowthData {
  date: string;
  count: number;
  total?: number;
  newCount?: number;
  followUpCount?: number;
  items?: Array<{ date: string; count: number; total: number }>;
}

export interface AppointmentStats {
  daily: Array<{ date: string; count: number }>;
  monthly: Array<{ month: string; count: number }>;
}

export interface AppointmentStatusItem {
  status: string;
  count: number;
  percentage: number;
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async ({ signal }) => (await api.get<DashboardStats>('/stats/dashboard', { signal })).data,
    staleTime: 30 * 1000,
  });
}

export function useChargeStats(params: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['charge-stats', params],
    queryFn: async ({ signal }) => (await api.get<ChargeStats>('/stats/charges', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}

export function usePatientStats(params: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['patient-stats', params],
    queryFn: async ({ signal }) => (await api.get<PatientStats>('/stats/patients', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}

export function useAppointmentStats(params: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['appointment-stats', params],
    queryFn: async ({ signal }) => (await api.get<AppointmentStats>('/stats/appointments', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}

export function useAppointmentStatusStats(params: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['appointment-status-stats', params],
    queryFn: async ({ signal }) => (await api.get<AppointmentStatusItem[]>('/stats/appointments/status', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}

export function useRevenue(params: { startDate?: string; endDate?: string; groupBy?: 'day' | 'month' | 'year' }) {
  return useQuery({
    queryKey: ['revenue', params],
    queryFn: async ({ signal }) => (await api.get<RevenueData>('/stats/revenue', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}

export function usePatientGrowth(params: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['patient-growth', params],
    queryFn: async ({ signal }) => (await api.get<PatientGrowthData>('/stats/patient-growth', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}

export function useRevenueByCategory(params: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['revenue-by-category', params],
    queryFn: async ({ signal }) => (await api.get<RevenueCategoryItem[]>('/stats/revenue/category', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}

export function useRevenueByDoctor(params: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['revenue-by-doctor', params],
    queryFn: async ({ signal }) => (await api.get<RevenueDoctorItem[]>('/stats/revenue/doctor', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}

export function useInventoryStatus() {
  return useQuery({
    queryKey: ['inventory-status'],
    queryFn: async ({ signal }) => (await api.get('/stats/inventory', { signal })).data,
    staleTime: 30 * 1000,
  });
}

export interface MemberStats {
  total: number;
  active: number;
  expired: number;
  totalMembers: number;
  totalBalance: string;
  totalPoints: number;
  monthly: Array<{ month: string; count: number; revenue: number }>;
  levelDistribution?: Array<{ level: string; count: number; percentage: number }>;
}

export function useMemberStats(params: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['member-stats', params],
    queryFn: async ({ signal }) => (await api.get<MemberStats>('/stats/members', { params, signal })).data,
    staleTime: 30 * 1000,
  });
}
