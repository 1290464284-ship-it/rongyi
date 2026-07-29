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
import { lazy } from 'react';
import type { UserRole } from '@dental/shared';

export type Role = UserRole;

export interface AppRoute {
  path: string;
  label: string;
  icon?: LucideIcon;
  roles: Role[];
  component?: React.LazyExoticComponent<React.ComponentType<Record<string, never>>>;
  children?: AppRoute[];
  hideInNav?: boolean;
  isIndex?: boolean;
  redirect?: string;
}

const DashboardPage = lazy(() => import('@/modules/dashboard/DashboardPage'));
const PatientListPage = lazy(() => import('@/modules/patient/PatientListPage'));
const PatientDetailPage = lazy(() => import('@/modules/patient/PatientDetailPage'));
const AppointmentCalendarPage = lazy(() => import('@/modules/appointment/AppointmentCalendarPage'));
const UnifiedChargePage = lazy(() => import('@/modules/charge/UnifiedChargePage'));
const PrescriptionPage = lazy(() => import('@/modules/prescription/PrescriptionPage'));
const TreatmentPlanPage = lazy(() => import('@/modules/treatment-plan/TreatmentPlanPage'));
const ClinicalPage = lazy(() => import('@/modules/clinical/ClinicalPage'));
const ReportPage = lazy(() => import('@/modules/report/ReportPage'));
const StaffPage = lazy(() => import('@/modules/staff/StaffPage'));
const ImagingPage = lazy(() => import('@/modules/imaging/ImagingPage'));
const PriceListPage = lazy(() => import('@/modules/settings/PriceListPage'));
const MemberCardPage = lazy(() => import('@/modules/finance/MemberCardPage'));
const SettingsPage = lazy(() => import('@/modules/settings/SettingsPage'));
const InventoryPage = lazy(() => import('@/modules/inventory/InventoryPage'));
const SuppliersPage = lazy(() => import('@/modules/inventory/SuppliersPage'));
const PurchaseOrderPage = lazy(() => import('@/modules/inventory/PurchaseOrderPage'));
const BackupPage = lazy(() => import('@/modules/settings/BackupPage'));
const RegistrationPage = lazy(() => import('@/modules/registration/RegistrationPage'));
const MedicalRecordsPage = lazy(() => import('@/modules/medical-records/MedicalRecordsPage'));
const FollowUpsPage = lazy(() => import('@/modules/follow-ups/FollowUpsPage'));
const ProcessingOrdersPage = lazy(() => import('@/modules/processing-orders/ProcessingOrdersPage'));
const FirstExamsPage = lazy(() => import('@/modules/first-exams/FirstExamsPage'));
const WechatPage = lazy(() => import('@/modules/wechat/WechatPage'));
const EquipmentPage = lazy(() => import('@/modules/equipment/EquipmentPage'));
const OperationLogPage = lazy(() => import('@/modules/settings/OperationLogPage'));
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for 404 catch-all route
const NotFoundPage = lazy(() => import('@/components/NotFoundPage'));

export const appRoutes: AppRoute[] = [
  {
    path: 'dashboard',
    label: '工作台',
    icon: LayoutDashboard,
    roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
    component: DashboardPage,
  },
  {
    path: 'registration',
    label: '就诊任务',
    icon: UserCheck,
    roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
    component: RegistrationPage,
  },
  {
    path: 'patients',
    label: '患者管理',
    icon: Users,
    roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
    children: [
      {
        path: '',
        label: '患者档案',
        icon: Users,
        roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
        component: PatientListPage,
      },
      {
        path: ':id',
        label: '患者详情',
        icon: Users,
        roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
        component: PatientDetailPage,
        hideInNav: true,
      },
      {
        path: 'appointments',
        label: '预约挂号',
        icon: Calendar,
        roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
        component: AppointmentCalendarPage,
      },
    ],
  },
  {
    path: 'appointments',
    label: '预约挂号',
    icon: Calendar,
    roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
    component: AppointmentCalendarPage,
    hideInNav: true,
  },
  {
    path: 'clinical',
    label: '诊疗管理',
    icon: Stethoscope,
    roles: ['BOSS', 'DOCTOR'],
    children: [
      {
        path: 'first-exams',
        label: '首诊检查',
        icon: Search,
        roles: ['BOSS', 'DOCTOR'],
        component: FirstExamsPage,
      },
      {
        path: 'clinical',
        label: '就诊记录',
        icon: Stethoscope,
        roles: ['BOSS', 'DOCTOR'],
        component: ClinicalPage,
      },
      {
        path: 'medical-records',
        label: '电子病历',
        icon: FileCheck,
        roles: ['BOSS', 'DOCTOR'],
        component: MedicalRecordsPage,
      },
      {
        path: 'treatment-plans',
        label: '治疗计划',
        icon: ClipboardList,
        roles: ['BOSS', 'DOCTOR'],
        component: TreatmentPlanPage,
      },
      {
        path: 'prescriptions',
        label: '处方管理',
        icon: Pill,
        roles: ['BOSS', 'DOCTOR'],
        component: PrescriptionPage,
      },
      {
        path: 'imaging',
        label: '影像管理',
        icon: Image,
        roles: ['BOSS', 'DOCTOR'],
        component: ImagingPage,
      },
    ],
  },
  {
    path: 'first-exams',
    label: '首诊检查',
    icon: Search,
    roles: ['BOSS', 'DOCTOR'],
    component: FirstExamsPage,
    hideInNav: true,
  },
  {
    path: 'medical-records',
    label: '电子病历',
    icon: FileCheck,
    roles: ['BOSS', 'DOCTOR'],
    component: MedicalRecordsPage,
    hideInNav: true,
  },
  {
    path: 'treatment-plans',
    label: '治疗计划',
    icon: ClipboardList,
    roles: ['BOSS', 'DOCTOR'],
    component: TreatmentPlanPage,
    hideInNav: true,
  },
  {
    path: 'prescriptions',
    label: '处方管理',
    icon: Pill,
    roles: ['BOSS', 'DOCTOR'],
    component: PrescriptionPage,
    hideInNav: true,
  },
  {
    path: 'imaging',
    label: '影像管理',
    icon: Image,
    roles: ['BOSS', 'DOCTOR'],
    component: ImagingPage,
    hideInNav: true,
  },
  {
    path: 'charge',
    label: '财务中心',
    icon: Receipt,
    roles: ['BOSS', 'RECEPTIONIST'],
    component: UnifiedChargePage,
  },
  {
    path: 'price-list',
    label: '价目表',
    icon: Tag,
    roles: ['BOSS'],
    component: PriceListPage,
  },
  {
    path: 'reports',
    label: '经营报表',
    icon: BarChart3,
    roles: ['BOSS'],
    component: ReportPage,
  },
  {
    path: 'member-cards',
    label: '会员服务',
    icon: CreditCard,
    roles: ['BOSS', 'RECEPTIONIST'],
    component: MemberCardPage,
  },
  {
    path: 'follow-ups',
    label: '回访管理',
    icon: PhoneCall,
    roles: ['BOSS', 'DOCTOR', 'RECEPTIONIST'],
    component: FollowUpsPage,
  },
  {
    path: 'wechat',
    label: '微信提醒',
    icon: MessageCircle,
    roles: ['BOSS', 'RECEPTIONIST'],
    component: WechatPage,
  },
  {
    path: 'inventory',
    label: '库存采购',
    icon: Package,
    roles: ['BOSS', 'RECEPTIONIST'],
    component: InventoryPage,
  },
  {
    path: 'suppliers',
    label: '供应商',
    icon: Truck,
    roles: ['BOSS'],
    component: SuppliersPage,
  },
  {
    path: 'purchase-orders',
    label: '采购管理',
    icon: ClipboardList,
    roles: ['BOSS'],
    component: PurchaseOrderPage,
  },
  {
    path: 'processing-orders',
    label: '加工单',
    icon: Factory,
    roles: ['BOSS', 'RECEPTIONIST'],
    component: ProcessingOrdersPage,
  },
  {
    path: 'staff',
    label: '诊所管理',
    icon: UserCog,
    roles: ['BOSS'],
    component: StaffPage,
  },
  {
    path: 'equipment',
    label: '设备管理',
    icon: Monitor,
    roles: ['BOSS'],
    component: EquipmentPage,
  },
  {
    path: 'backups',
    label: '系统管理',
    icon: FileCheck,
    roles: ['BOSS'],
    component: BackupPage,
  },
  {
    path: 'settings',
    label: '系统设置',
    icon: Settings,
    roles: ['BOSS'],
    component: SettingsPage,
  },
  {
    path: 'operation-logs',
    label: '操作日志',
    icon: FileCheck,
    roles: ['BOSS'],
    component: OperationLogPage,
    hideInNav: true,
  },
];

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

function buildNavEntries(routes: AppRoute[]): NavEntry[] {
  const navMap = new Map<string, NavEntry>();
  const groupOrder = [
    '工作台',
    '就诊任务',
    '患者管理',
    '诊疗管理',
    '财务中心',
    '会员服务',
    '库存采购',
    '诊所管理',
    '系统管理',
  ];

  const groupMap: Record<string, { label: string; icon: LucideIcon; roles: Role[]; children: NavItem[] }> = {};

  routes.forEach((route) => {
    if (route.hideInNav) return;
    if (!route.icon) return;

    if (route.children && route.children.length > 0) {
      const groupLabel = route.label;
      if (!groupMap[groupLabel]) {
        groupMap[groupLabel] = {
          label: groupLabel,
          icon: route.icon,
          roles: [...route.roles],
          children: [],
        };
      }
      route.children.forEach((child) => {
        if (child.hideInNav || !child.icon) return;
        const childPath = child.path ? `${route.path}/${child.path}` : route.path;
        const normalizedPath = childPath.replace(/\/$/, '');
        groupMap[groupLabel].children.push({
          to: `/${normalizedPath}`,
          label: child.label,
          icon: child.icon,
          roles: child.roles,
        });
        groupMap[groupLabel].roles = [
          ...new Set([...groupMap[groupLabel].roles, ...child.roles]),
        ] as Role[];
      });
    } else if (route.component) {
      navMap.set(route.path, {
        to: `/${route.path}`,
        label: route.label,
        icon: route.icon,
        roles: route.roles,
      });
    }
  });

  const result: NavEntry[] = [];

  groupOrder.forEach((groupName) => {
    if (groupMap[groupName]) {
      result.push(groupMap[groupName]);
    }
  });

  navMap.forEach((entry) => {
    const isInGroup = Object.values(groupMap).some((g) =>
      g.children.some((c) => c.to === (entry as NavItem).to)
    );
    if (!isInGroup) {
      result.push(entry);
    }
  });

  return result;
}

export const navEntries: NavEntry[] = buildNavEntries(appRoutes);
