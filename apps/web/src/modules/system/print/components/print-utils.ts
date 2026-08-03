import { Pill, Receipt, ClipboardList, BarChart3, Ruler, FileText } from 'lucide-react';
import type { SampleContext } from '@/lib/api/system/print';

export type PrintType =
  | 'prescription'
  | 'receipt'
  | 'treatment'
  | 'clinicReport'
  | 'cephalometric'
  | 'template'
  | null;

export type PaperSize = 'A4' | 'A5' | 'RECEIPT';

export interface TabItem {
  key: PrintType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const TAB_ITEMS: TabItem[] = [
  { key: 'prescription', label: '处方笺', icon: Pill },
  { key: 'receipt', label: '收费凭证', icon: Receipt },
  { key: 'treatment', label: '治疗计划', icon: ClipboardList },
  { key: 'clinicReport', label: '诊所月报', icon: BarChart3 },
  { key: 'cephalometric', label: '头影报告', icon: Ruler },
  { key: 'template', label: '自定义模板', icon: FileText },
];

export const DEFAULT_SAMPLE_CONTEXTS: Record<string, SampleContext> = {
  prescriptionSample: {
    prescriptionSample: {
      patientName: '张三',
      patientAge: 35,
      patientGender: '男',
      diagnosis: '慢性牙周炎',
      medicines: [
        {
          name: '阿莫西林胶囊',
          specification: '0.5g*24粒',
          dosage: '0.5g',
          frequency: '每日3次',
          duration: '7天',
          quantity: 1,
        },
        {
          name: '甲硝唑片',
          specification: '0.2g*100片',
          dosage: '0.4g',
          frequency: '每日2次',
          duration: '7天',
          quantity: 1,
        },
      ],
      doctorName: '李医生',
      date: '2024-08-02',
      clinicName: '瑞益口腔诊所',
    },
  },
  receiptSample: {
    receiptSample: {
      receiptNo: 'SK202408020001',
      patientName: '张三',
      items: [
        { name: '洗牙', price: 200, quantity: 1, subtotal: 200 },
        { name: '补牙', price: 500, quantity: 2, subtotal: 1000 },
      ],
      total: 1200,
      paid: 1200,
      change: 0,
      paymentMethod: '微信支付',
      cashierName: '小王',
      date: '2024-08-02',
      clinicName: '瑞益口腔诊所',
    },
  },
  planSample: {
    planSample: {
      patientName: '张三',
      planName: '正畸治疗方案',
      stages: [
        {
          name: '第一阶段：检查与诊断',
          description: '口腔检查、X光片、取模分析',
          estimatedFee: 1500,
          duration: '1周',
        },
        {
          name: '第二阶段：矫正器安装',
          description: '安装托槽、弓丝',
          estimatedFee: 8000,
          duration: '2周',
        },
        {
          name: '第三阶段：定期复诊调整',
          description: '每月复诊调整',
          estimatedFee: 500,
          duration: '12-18个月',
        },
      ],
      totalFee: 16500,
      doctorName: '李医生',
      date: '2024-08-02',
      clinicName: '瑞益口腔诊所',
    },
  },
  reportSample: {
    reportSample: {
      month: '2024-08',
      revenue: 285600,
      patientCount: 328,
      visitCount: 512,
      topServices: [
        { name: '洗牙', count: 85, revenue: 17000 },
        { name: '补牙', count: 62, revenue: 31000 },
        { name: '正畸', count: 12, revenue: 144000 },
      ],
      doctorStats: [
        { name: '李医生', visitCount: 186, revenue: 125000 },
        { name: '王医生', visitCount: 165, revenue: 98600 },
        { name: '张医生', visitCount: 161, revenue: 62000 },
      ],
      clinicName: '瑞益口腔诊所',
      generatedAt: '2024-08-02 10:00:00',
    },
  },
};

export function formatJson(json: unknown): string {
  try {
    return JSON.stringify(json, null, 2);
  } catch {
    return String(json);
  }
}

export function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function getPaperSizeClass(paperSize: PaperSize): string {
  switch (paperSize) {
    case 'A4':
      return 'a4-preview';
    case 'A5':
      return 'a5-preview';
    case 'RECEIPT':
      return 'receipt-preview';
  }
}
