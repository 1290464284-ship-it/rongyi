import type { ComponentType } from 'react';
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  Package,
  Phone,
  Receipt,
  Settings,
  Stethoscope,
  UserCog,
  Users,
} from 'lucide-react';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: ComponentType<{ size?: number }>;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '工作台', to: '/', icon: LayoutDashboard },
  { key: 'frontDesk', label: '前台工作', to: '/front-desk', icon: CalendarDays },
  { key: 'patients', label: '患者档案', to: '/patients', icon: Users },
  { key: 'clinical', label: '临床记录', to: '/clinical', icon: Stethoscope },
  { key: 'finance', label: '财务中心', to: '/finance', icon: Receipt },
  { key: 'inventory', label: '库存与采购', to: '/inventory', icon: Package },
  { key: 'analytics', label: '经营分析', to: '/analytics', icon: BarChart3 },
  { key: 'communication', label: '随访与沟通', to: '/communication', icon: Phone },
  { key: 'hr', label: '人事与设备', to: '/hr', icon: UserCog },
  { key: 'system', label: '系统管理', to: '/system', icon: Settings },
];

export const NAV_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: '常用', keys: ['dashboard', 'frontDesk', 'patients', 'clinical'] },
  { label: '运营', keys: ['finance', 'inventory', 'analytics', 'communication'] },
  { label: '管理', keys: ['hr', 'system'] },
];

export function titleForPath(pathname: string): string {
  const item = NAV_ITEMS.find((entry) => (entry.to === '/' ? pathname === '/' : pathname.startsWith(entry.to)));
  return item?.label ?? '蓉易口腔诊所';
}
