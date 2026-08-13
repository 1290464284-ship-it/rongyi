import type { UserRole } from '../../domain/contracts';
import type { PermissionKey } from '../application/service-modules/permissions';

const allStaff: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR'];
const operationalStaff: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR'];
const financeStaff: UserRole[] = ['BOSS', 'ADMIN'];
const clinicalStaff: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR'];
const adminStaff: UserRole[] = ['BOSS', 'ADMIN'];
// 命名说明（审计 P2-1）：当前产品口径下 BOSS 与 ADMIN 在管理面同级，
// 因此该组恒为 ['BOSS','ADMIN']。历史上叫 bossOnly 会让人误以为存在
// BOSS 独占路由；如需真正的 BOSS 独占（如备份恢复/审计清理），应新增
// 独立角色组并在服务层补断言，属产品决策，暂不在本轮执行。
const bossOrAdmin: UserRole[] = ['BOSS', 'ADMIN'];

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
  { pattern: /^\/api\/v2\/files/, roles: operationalStaff, permission: 'patients' },
  { pattern: /^\/api\/v2\/admin\/users/, roles: bossOrAdmin },
  { pattern: /^\/api\/v2\/resource-meta/, roles: allStaff },
  { pattern: /^\/api\/v2\/resources/, roles: allStaff },
  { pattern: /^\/api\/v2\/bulk-import\//, roles: bossOrAdmin, permission: 'system' },
  { pattern: /^\/api\/v2\/sync\//, roles: bossOrAdmin, permission: 'system' },
  { pattern: /^\/api\/v2\/backups/, roles: bossOrAdmin, permission: 'system' },
  { pattern: /^\/api\/v2\/system\/business-alerts/, roles: bossOrAdmin, permission: 'system' },
  { pattern: /^\/api\/v2\/system\/audit\/cleanup/, roles: bossOrAdmin, permission: 'system' },
  { pattern: /^\/api\/v2\/hr\/leaves/, roles: bossOrAdmin, permission: 'hr' },
  { pattern: /^\/api\/v2\/hr\/attendance/, roles: adminStaff, permission: 'hr' },
  { pattern: /^\/api\/v2\/charges(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/member-cards(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/debts(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/charge-combos/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/refunds(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/inventory/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/stocktakes/, roles: adminStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/dispenses/, roles: allStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/narcotic-registry/, roles: adminStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/purchase-orders/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/shift-templates/, roles: bossOrAdmin, permission: 'hr' },
  { pattern: /^\/api\/v2\/schedules\/week/, roles: bossOrAdmin, permission: 'hr' },
  { pattern: /^\/api\/v2\/user-roles/, roles: bossOrAdmin },
  { pattern: /^\/api\/v2\/processing-orders/, roles: financeStaff, permission: 'inventory' },
  // 治疗计划打折/划价是财务操作（H2：临床医生可自行打折绕过收费岗复核），限财务岗
  { pattern: /^\/api\/v2\/treatment-plans\/[^/]+(\/items\/[^/]+)?\/(bill|discount)(\/|$)/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/appointments/, roles: operationalStaff, permission: 'patients' },
  {
    pattern: /^\/api\/v2\/(registrations|visits|first-exams|treatments|medical-records|patients\/.*\/risk|prescriptions|cephalometric|treatment-plans)/,
    roles: clinicalStaff,
    permission: 'clinical',
  },
  { pattern: /^\/api\/v2\/workbench/, roles: clinicalStaff, permission: 'clinical' },
  { pattern: /^\/api\/v2\/wechat-reminders/, roles: operationalStaff, permission: 'communication' },
  { pattern: /^\/api\/v2\/wechat\/send-batch/, roles: bossOrAdmin },
  { pattern: /^\/api\/v2\/wechat/, roles: operationalStaff, permission: 'communication' },
  { pattern: /^\/api\/v2\/follow-ups/, roles: operationalStaff, permission: 'communication' },
  { pattern: /^\/api\/v2\/notifications/, roles: allStaff },
  { pattern: /^\/api\/v2\/stats\/dashboard/, roles: allStaff, permission: 'dashboard' },
  { pattern: /^\/api\/v2\/stats\/revenue/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/stats\/patient-growth/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/stats\/inventory/, roles: financeStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/stats\/member-cards/, roles: financeStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/stats\/cost-share/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/analytics\/clinic-overview/, roles: bossOrAdmin, permission: 'analytics' },
  { pattern: /^\/api\/v2\/analytics/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/satisfaction/, roles: adminStaff, permission: 'analytics' },
  { pattern: /^\/api\/v2\/charge-assistant/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/print/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/search/, roles: operationalStaff, permission: 'patients' },
  { pattern: /^\/api\/v2\/inventory-reports/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/inventory-docs/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/inventory-transfers/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/processing-flow-stats/, roles: financeStaff, permission: 'inventory' },
  { pattern: /^\/api\/v2\/follow-up-dicts/, roles: operationalStaff, permission: 'communication' },
  { pattern: /^\/api\/v2\/departments/, roles: operationalStaff, permission: 'clinical' },
  { pattern: /^\/api\/v2\/triage/, roles: clinicalStaff, permission: 'clinical' },
  { pattern: /^\/api\/v2\/pay-methods/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/charge-trees/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/commission/, roles: financeStaff, permission: 'finance' },
  { pattern: /^\/api\/v2\/user-permissions/, roles: bossOrAdmin },
  { pattern: /^\/api\/v2\/role-permissions/, roles: bossOrAdmin },
  { pattern: /^\/api\/v2\/custom-fields/, roles: allStaff },
];

const navigationRules: Array<{ key: string; roles: UserRole[] }> = [
  { key: 'dashboard', roles: allStaff },
  { key: 'frontDesk', roles: adminStaff },
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
