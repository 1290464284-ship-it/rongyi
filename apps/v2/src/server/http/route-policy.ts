import type { UserRole } from '../../domain/contracts';

const allStaff: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'TECHNICIAN'];
const operationalStaff: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE'];
const financeStaff: UserRole[] = ['BOSS', 'ADMIN', 'RECEPTIONIST'];
const clinicalStaff: UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR', 'NURSE'];
const adminStaff: UserRole[] = ['BOSS', 'ADMIN'];

export const routeRoleRules: Array<{ pattern: RegExp; roles: UserRole[] }> = [
  { pattern: /^\/api\/v2\/auth\/(me|password|navigation|clinics|switch-clinic)/, roles: allStaff },
  { pattern: /^\/api\/v2\/admin\/users/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/resource-meta/, roles: allStaff },
  { pattern: /^\/api\/v2\/resources/, roles: allStaff },
  { pattern: /^\/api\/v2\/bulk-import\//, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/sync\//, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/backups/, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/system\/business-alerts/, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/hr\/leaves/, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/hr\/attendance/, roles: adminStaff },
  { pattern: /^\/api\/v2\/charges(\/|$)/, roles: financeStaff },
  { pattern: /^\/api\/v2\/member-cards(\/|$)/, roles: financeStaff },
  { pattern: /^\/api\/v2\/debts(\/|$)/, roles: financeStaff },
  { pattern: /^\/api\/v2\/inventory/, roles: financeStaff },
  { pattern: /^\/api\/v2\/purchase-orders/, roles: financeStaff },
  { pattern: /^\/api\/v2\/processing-orders/, roles: financeStaff },
  { pattern: /^\/api\/v2\/appointments/, roles: operationalStaff },
  {
    pattern: /^\/api\/v2\/(registrations|visits|first-exams|treatments|medical-records|patients\/.*\/risk|prescriptions|cephalometric|treatment-plans)/,
    roles: clinicalStaff,
  },
  { pattern: /^\/api\/v2\/wechat/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/follow-ups/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/notifications/, roles: allStaff },
  { pattern: /^\/api\/v2\/stats\/dashboard/, roles: allStaff },
  { pattern: /^\/api\/v2\/stats\/revenue/, roles: adminStaff },
  { pattern: /^\/api\/v2\/stats\/patient-growth/, roles: adminStaff },
  { pattern: /^\/api\/v2\/stats\/inventory/, roles: financeStaff },
  { pattern: /^\/api\/v2\/stats\/member-cards/, roles: financeStaff },
  { pattern: /^\/api\/v2\/analytics\/clinic-overview/, roles: ['BOSS'] },
  { pattern: /^\/api\/v2\/analytics/, roles: adminStaff },
  { pattern: /^\/api\/v2\/satisfaction/, roles: adminStaff },
  { pattern: /^\/api\/v2\/charge-assistant/, roles: financeStaff },
  { pattern: /^\/api\/v2\/print/, roles: operationalStaff },
  { pattern: /^\/api\/v2\/search/, roles: operationalStaff },
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
