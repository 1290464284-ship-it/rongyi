export const ROLE_LABELS: Record<string, string> = {
  BOSS: '老板',
  ADMIN: '管理员',
  DOCTOR: '医生',
};

export const PERMISSION_KEYS = [
  'dashboard',
  'frontDesk',
  'patients',
  'clinical',
  'finance',
  'inventory',
  'analytics',
  'communication',
  'hr',
  'system',
];

export const PERMISSION_LABELS: Record<string, string> = {
  dashboard: '经营报表',
  frontDesk: '前台工作',
  patients: '患者档案',
  clinical: '临床诊疗',
  finance: '收费财务',
  inventory: '库存采购',
  analytics: '经营分析',
  communication: '随访微信',
  hr: '人事排班',
  system: '系统管理',
};
