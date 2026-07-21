import {
  Users,
  Calendar,
  Stethoscope,
  Receipt,
  Pill,
  ClipboardList,
  Image,
  BarChart3,
  LayoutDashboard,
  UserCog,
  Tag,
  CreditCard,
  Settings,
  Package,
  Truck,
  Factory,
  PhoneCall,
  Search,
  MessageCircle,
  FileCheck,
  UserCheck,
  Monitor,
  type LucideIcon,
} from 'lucide-react';

export type Role = 'BOSS' | 'DOCTOR' | 'RECEPTIONIST';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

export interface NavGroup {
  label: string;
  icon: LucideIcon;
  roles: Role[];
  children: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'children' in entry;
}

export { isGroup };

export const navEntries: NavEntry[] = [
  { to: '/dashboard', label: '工作台', icon: LayoutDashboard, roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'] },
  { to: '/registration', label: '就诊任务', icon: UserCheck, roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'] },

  {
    label: '患者管理',
    icon: Users,
    roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
    children: [
      { to: '/patients', label: '患者档案', icon: Users, roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'] },
      { to: '/appointments', label: '预约挂号', icon: Calendar, roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'] },
    ],
  },

  {
    label: '诊疗管理',
    icon: Stethoscope,
    roles: ['BOSS', 'DOCTOR'],
    children: [
      { to: '/first-exams', label: '首诊检查', icon: Search, roles: ['BOSS', 'DOCTOR'] },
      { to: '/clinical', label: '就诊记录', icon: Stethoscope, roles: ['BOSS', 'DOCTOR'] },
      { to: '/medical-records', label: '电子病历', icon: FileCheck, roles: ['BOSS', 'DOCTOR'] },
      { to: '/treatment-plans', label: '治疗计划', icon: ClipboardList, roles: ['BOSS', 'DOCTOR'] },
      { to: '/prescriptions', label: '处方管理', icon: Pill, roles: ['BOSS', 'DOCTOR'] },
      { to: '/imaging', label: '影像管理', icon: Image, roles: ['BOSS', 'DOCTOR'] },
    ],
  },

  {
    label: '财务中心',
    icon: Receipt,
    roles: ['BOSS', 'RECEPTIONIST'],
    children: [
      { to: '/charge-v2', label: '收费管理', icon: Receipt, roles: ['BOSS', 'RECEPTIONIST'] },
      { to: '/price-list', label: '价目表', icon: Tag, roles: ['BOSS'] },
      { to: '/reports', label: '经营报表', icon: BarChart3, roles: ['BOSS'] },
    ],
  },

  {
    label: '会员服务',
    icon: CreditCard,
    roles: ['BOSS', 'RECEPTIONIST', 'DOCTOR'],
    children: [
      { to: '/member-cards', label: '会员卡', icon: CreditCard, roles: ['BOSS', 'RECEPTIONIST'] },
      { to: '/follow-ups', label: '回访管理', icon: PhoneCall, roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'] },
      { to: '/wechat', label: '微信提醒', icon: MessageCircle, roles: ['BOSS', 'RECEPTIONIST'] },
    ],
  },

  {
    label: '库存采购',
    icon: Package,
    roles: ['BOSS', 'RECEPTIONIST'],
    children: [
      { to: '/inventory', label: '库存管理', icon: Package, roles: ['BOSS', 'RECEPTIONIST'] },
      { to: '/suppliers', label: '供应商', icon: Truck, roles: ['BOSS'] },
      { to: '/purchase-orders', label: '采购管理', icon: ClipboardList, roles: ['BOSS'] },
      { to: '/processing-orders', label: '加工单', icon: Factory, roles: ['BOSS', 'RECEPTIONIST'] },
    ],
  },

  {
    label: '诊所管理',
    icon: UserCog,
    roles: ['BOSS'],
    children: [
      { to: '/staff', label: '员工管理', icon: UserCog, roles: ['BOSS'] },
      { to: '/equipment', label: '设备管理', icon: Monitor, roles: ['BOSS'] },
    ],
  },

  {
    label: '系统管理',
    icon: Settings,
    roles: ['BOSS'],
    children: [
      { to: '/backups', label: '数据备份', icon: FileCheck, roles: ['BOSS'] },
      { to: '/settings', label: '系统设置', icon: Settings, roles: ['BOSS'] },
    ],
  },
];
