import type { UserRole } from '../../domain/contracts';

const allStaff: UserRole[] = ['BOSS', 'DOCTOR'];
const operationalStaff: UserRole[] = ['BOSS', 'DOCTOR'];
const financeStaff: UserRole[] = ['BOSS'];
const clinicalStaff: UserRole[] = ['BOSS', 'DOCTOR'];
const adminStaff: UserRole[] = ['BOSS'];

export const routeRoleRules: Array<{ pattern: RegExp; roles: UserRole[] }> = [
  { pattern: /^\/api\/v2\/auth\/(me|navigation|clinics|switch-clinic)/, roles: allStaff },
  // 改密操作对象恒为当前登录用户（auth-admin PATCH /auth/password → authService.changePassword(userId,...)），
  // 所有角色都应能改自己的密码，仅限 BOSS 会误禁 DOCTOR
  { pattern: /^\/api\/v2\/auth\/password/, roles: allStaff },
  { pattern: /^\/api\/v2\/doctors/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/files/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/admin\/users/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/resource-meta/, roles: allStaff },
  { pattern: /^\/api\/v2\/resources/, roles: allStaff },
  { pattern: /^\/api\/v2\/bulk-import\//, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/sync\//, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/backups/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/system\/business-alerts/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/system\/audit\/cleanup/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/hr\/leaves/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/hr\/attendance/, roles: adminStaff },
  { pattern: /^\/api\/v2\/charges(\/|$)/, roles: financeStaff },
  { pattern: /^\/api\/v2\/member-cards(\/|$)/, roles: financeStaff },
  { pattern: /^\/api\/v2\/debts(\/|$)/, roles: financeStaff },
  { pattern: /^\/api\/v2\/charge-combos/, roles: financeStaff },
  { pattern: /^\/api\/v2\/refunds(\/|$)/, roles: financeStaff },
  { pattern: /^\/api\/v2\/inventory/, roles: financeStaff },
  { pattern: /^\/api\/v2\/stocktakes/, roles: adminStaff },
  { pattern: /^\/api\/v2\/dispenses/, roles: ['BOSS', 'DOCTOR'] },
  { pattern: /^\/api\/v2\/narcotic-registry/, roles: adminStaff },
  { pattern: /^\/api\/v2\/purchase-orders/, roles: financeStaff },
  { pattern: /^\/api\/v2\/shift-templates/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/schedules\/week/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/user-roles/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/processing-orders/, roles: financeStaff },
  // 治疗计划打折/划价是财务操作（H2：临床医生可自行打折绕过收费岗复核），限财务岗
  { pattern: /^\/api\/v2\/treatment-plans\/[^/]+(\/items\/[^/]+)?\/(bill|discount)(\/|$)/, roles: financeStaff },
  { pattern: /^\/api\/v2\/appointments/, roles: operationalStaff },
  {
    pattern: /^\/api\/v2\/(registrations|visits|first-exams|treatments|medical-records|patients\/.*\/risk|prescriptions|cephalometric|treatment-plans)/,
    roles: clinicalStaff,
  },
  { pattern: /^\/api\/v2\/workbench/, roles: clinicalStaff },
  { pattern: /^\/api\/v2\/wechat-reminders/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/wechat\/send-batch/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/wechat/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/follow-ups/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/notifications/, roles: allStaff },
  { pattern: /^\/api\/v2\/stats\/dashboard/, roles: allStaff },
  { pattern: /^\/api\/v2\/stats\/revenue/, roles: adminStaff },
  { pattern: /^\/api\/v2\/stats\/patient-growth/, roles: adminStaff },
  { pattern: /^\/api\/v2\/stats\/inventory/, roles: financeStaff },
  { pattern: /^\/api\/v2\/stats\/member-cards/, roles: financeStaff },
  { pattern: /^\/api\/v2\/stats\/cost-share/, roles: adminStaff },
  { pattern: /^\/api\/v2\/analytics\/clinic-overview/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/analytics/, roles: adminStaff },
  { pattern: /^\/api\/v2\/satisfaction/, roles: adminStaff },
  { pattern: /^\/api\/v2\/charge-assistant/, roles: financeStaff },
  { pattern: /^\/api\/v2\/print/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/search/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/inventory-reports/, roles: financeStaff },
  { pattern: /^\/api\/v2\/inventory-docs/, roles: financeStaff },
  { pattern: /^\/api\/v2\/inventory-transfers/, roles: financeStaff },
  { pattern: /^\/api\/v2\/processing-flow-stats/, roles: financeStaff },
  { pattern: /^\/api\/v2\/follow-up-dicts/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/departments/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/triage/, roles: clinicalStaff },
  { pattern: /^\/api\/v2\/pay-methods/, roles: financeStaff },
  { pattern: /^\/api\/v2\/charge-trees/, roles: financeStaff },
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
