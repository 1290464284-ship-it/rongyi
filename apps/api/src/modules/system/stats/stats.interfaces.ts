export interface CountRow { c: number; }
export interface SumRow { t: number; }
export interface DateCountRow { date: string; count: number; }
export interface DateAmountRow { date: string; count: number; amount: number; }
export interface MonthCountRow { month: string; count: number; }
export interface DoctorWorkloadRow { doctorId: string; doctorName: string; count: number; amount: number; }
export interface CategoryAmountRow { category: string; amount: number; count: number; percentage?: number; }
export interface DoctorRevenueRow { doctorId: string; doctorName: string; count: number; amount: number; percentage?: number; }
export interface StatusCountRow { status: string; count: number; percentage?: number; }
export interface PendingChargeRow { id: string; patientName: string; totalAmount: number; paidAmount: number; number: string; }
export interface RecentPatientRow { id: string; name: string; phone: string; createdAt: string; }
export interface RecentAppointmentRow { id: string; patientId: string; patientName: string; doctorId: string; startTime: string; endTime: string; status: string; type: string; }
export interface RecentChargeRow { id: string; patientName: string; totalAmount: number; paidAmount: number; number: string; paidAt: string; }
export interface TodoItemRow { id: string; type: string; title: string; status: string; priority: string; dueDate: string; }
export interface InventoryStatusRow { category: string; count: number; totalStock: number; }
export interface MemberLevelRow { level: string; count: number; percentage?: number; }

export type StatsCacheCategory =
  | 'dashboard'
  | 'revenue'
  | 'doctorWorkload'
  | 'patientGrowth'
  | 'revenueByCategory'
  | 'revenueByDoctor'
  | 'inventory'
  | 'appointment'
  | 'charge'
  | 'patient'
  | 'member';
