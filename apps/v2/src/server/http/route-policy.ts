import type { UserRole } from '../../domain/contracts';

export const routeRoleRules: Array<{ pattern: RegExp; roles: UserRole[] }> = [
  { pattern: /^\/api\/v2\/bulk-import\//, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/sync\//, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/backups/, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/system\/business-alerts/, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/hr\/leaves/, roles: ['BOSS', 'ADMIN'] },
  { pattern: /^\/api\/v2\/charges(\/|$)/, roles: ['BOSS', 'ADMIN', 'RECEPTIONIST'] },
  { pattern: /^\/api\/v2\/member-cards(\/|$)/, roles: ['BOSS', 'ADMIN', 'RECEPTIONIST'] },
  { pattern: /^\/api\/v2\/debts(\/|$)/, roles: ['BOSS', 'ADMIN', 'RECEPTIONIST'] },
  { pattern: /^\/api\/v2\/inventory/, roles: ['BOSS', 'ADMIN', 'RECEPTIONIST'] },
  { pattern: /^\/api\/v2\/purchase-orders/, roles: ['BOSS', 'ADMIN', 'RECEPTIONIST'] },
  { pattern: /^\/api\/v2\/processing-orders/, roles: ['BOSS', 'ADMIN', 'RECEPTIONIST'] },
  { pattern: /^\/api\/v2\/appointments/, roles: ['BOSS', 'ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE'] },
  {
    pattern: /^\/api\/v2\/(registrations|visits|first-exams|treatments|medical-records|patients\/.*\/risk|prescriptions|cephalometric|treatment-plans)/,
    roles: ['BOSS', 'ADMIN', 'DOCTOR', 'NURSE'],
  },
  { pattern: /^\/api\/v2\/wechat/, roles: ['BOSS', 'ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE'] },
];
