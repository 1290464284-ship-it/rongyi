export interface RuleRow extends Record<string, unknown> {
  id: string;
  name: string;
  category: string | null;
  costType: string | null;
  rateType: 'PERCENT' | 'FIXED';
  rate: number;
  doctorId: string | null;
  enabled: number;
}

export interface RuleForm {
  name: string;
  category: string;
  costType: string;
  rateType: 'PERCENT' | 'FIXED';
  rate: string;
  doctorId: string;
  enabled: boolean;
}

export interface StatementRow extends Record<string, unknown> {
  id: string;
  period: string;
  doctorId: string;
  doctorName: string | null;
  totalCharged: number;
  totalCommission: number;
  breakdown: Array<{ category: string; costType: string; charged: number; commission: number }>;
  calculatedAt: string;
}

export const emptyForm: RuleForm = {
  name: '',
  category: '',
  costType: '',
  rateType: 'PERCENT',
  rate: '10',
  doctorId: '',
  enabled: true,
};
