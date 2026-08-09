import type { UserRole } from '../../domain/contracts';
import type { PermissionKey } from '../application/service-modules/permissions';

const allStaff: UserRole[] = ['BOSS', 'DOCTOR'];
const operationalStaff: UserRole[] = ['BOSS', 'DOCTOR'];
const financeStaff: UserRole[] = ['BOSS'];
const clinicalStaff: UserRole[] = ['BOSS', 'DOCTOR'];
const adminStaff: UserRole[] = ['BOSS'];

export interface RouteRoleRule {
  pattern: RegExp;
  roles: UserRole[];
  /** 命中该路由要求的模块权限；配置后以用户生效权限为准。 */
  permission?: PermissionKey;
}

export const routeRoleRules: RouteRoleRule[] = [
  { pattern: /^\/api\/v2\/auth\/(me|navigation|clinics|switch-clinic)/, roles: allStaff },
  // 改密操作对象恒为当前登录用户（auth-admin PATCH /auth/password → authService.changePassword(userId,...)），
  // 所有角色都应能改自己的密码，仅限 BOSS 会误禁 DOCTOR
  { pattern: /^\/api\/v2\/auth\/password/, roles: allStaff },
  { pattern: /^\/api\/v2\/doctors/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/files/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/admin\/users/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/resource-meta/, roles: allStaff },
  { pattern: /^\/api\/v2\/resources/, roles: allStaff },
  { pattern: /^\/api\/v2\/bulk-import\//, roles: ['BOSS'], permission: 'system' },
  { pattern: /^\/api\/v2\/sync\//, roles: ['BOSS'], permission: 'system' },
  { pattern: /^\/api\/v2\/backups/, roles: ['BOSS'], permission: 'system' },
  { pattern: /^\/api\/v2\/system\/business-alerts/, roles: ['BOSS'], permission: 'system' },
  { pattern: /^\/api\/v2\/system\/audit\/cleanup/, roles: ['BOSS'], permission: 'system' },
  { pattern: /^\/api\/v2\/hr\/leaves/, roles: ['BOSS'], permission: 'hr' },
  { pattern: /^\/api\/v2\/hr\/attendance/, roles: adminStaff, permission: 'hr' },
  { pattern: /^\/api\/v2\/charges(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/member-cards(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/debts(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/charge-combos/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/refunds(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/inventory/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/stocktakes/, roles: adminStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/dispenses/, roles: ['BOSS', 'DOCTOR'], permission: 'inventory' },
  { pattern: /^\/api\/v2\/narcotic-registry/, roles: adminStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/purchase-orders/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/shift-templates/, roles: ['BOSS'], permission: 'hr' },
  { pattern: /^\/api\/v2\/schedules\/week/, roles: ['BOSS'], permission: 'hr' },
  { pattern: /^\/api\/v2\/user-roles/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/processing-orders/, roles: financeStaff, permission: 'inventory' },
  // 治疗计划打折/划价是财务操作（H2：临床医生可自行打折绕过收费岗复核），限财务岗
  { pattern: /^\/api\/v2\/treatment-plans\/[^/]+(\/items\/[^/]+)?\/(bill|discount)(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/appointments/, roles: operationalStaff, permission: 'patients' },
  {
    pattern: /^\/api\/v2\/(registrations|visits|first-exams|treatments|medical-records|patients\/.*\/risk|prescriptions|cephalometric|treatment-plans)/,
    roles: clinicalStaff,
    permission: 'clinical',
  },
  { pattern: /^\/api\/v2\/workbench/, roles: clinicalStaff },
  { pattern: /^\/api\/v2\/wechat-reminders/, roles: operationalStaff, permission: 'communication' },
  { pattern: /^\/api\/v2\/wechat\/send-batch/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/wechat/, roles: operationalStaff, permission: 'communication' },
  { pattern: /^\/api\/v2\/follow-ups/, roles: operationalStaff, permission: 'communication' },
  { pattern: /^\/api\/v2\/notifications/, roles: allStaff },
  { pattern: /^\/api\/v2\/stats\/dashboard/, roles: allStaff },
  { pattern: /^\/api\/v2\/stats\/revenue/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/stats\/patient-growth/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/stats\/inventory/, roles: financeStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/stats\/member-cards/, roles: financeStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/stats\/cost-share/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/analytics\/clinic-overview/, roles: ['BOSS'], permission: 'analytics' },
  { pattern: /^\/api\/v2\/analytics/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/satisfaction/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/charge-assistant/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/print/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/search/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/inventory-reports/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/inventory-docs/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/inventory-transfers/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/processing-flow-stats/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/follow-up-dicts/, roles: operationalStaff, permission: 'communication' },
  { pattern: /^\/api\/v2\/departments/, roles: operationalStaff, permission: 'clinical' },
  { pattern: /^\/api\/v2\/triage/, roles: clinicalStaff, permission: 'clinical' },
  { pattern: /^\/api\/v2\/pay-methods/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/charge-trees/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/user-permissions/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/role-permissions/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/custom-fields/, roles: allStaff },
];

const navigationRules: Array<{ key: string; roles: UserRole[] }> = [
  { key: 'dashboard', roles: allStaff },
  { key: 'patients', roles: allStaff },
  { key: 'clinical', roles: clinicalStaff },
  { key: 'finance', roles: financeStaff },
  { key: 'inventory', roles: financeStaff },
  { key: 'analytics', roles: adminStaff },
  { key: 'communication', roles: operationalStaff },
  { key: 'hr', roles: adminStaff },
  { key: 'system', roles: adminStaff },
];

export function navigationForRole(role: UserRole): string[] {
  return navigationRules
    .filter((rule) => rule.roles.includes(role))
    .map((rule) => rule.key);
}
