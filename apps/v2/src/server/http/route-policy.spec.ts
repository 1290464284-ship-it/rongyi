import { describe, expect, it } from 'vitest';
import { routeRoleRules, navigationForRole } from './route-policy';
import type { UserRole } from '../../domain/contracts';

const ALL_ROLES: readonly UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'TECHNICIAN'];

function pickDenied(allowed: readonly UserRole[]): UserRole | null {
  return ALL_ROLES.find((r) => !allowed.includes(r)) ?? null;
}

function samplePathForPattern(pattern: RegExp, index: number): string {
  const samples: Array<Array<string>> = [
    ['/api/v2/auth/me', '/api/v2/auth/password', '/api/v2/auth/navigation'],
    ['/api/v2/doctors', '/api/v2/doctors/abc'],
    ['/api/v2/files', '/api/v2/files/abc'],
    ['/api/v2/admin/users', '/api/v2/admin/users/abc'],
    ['/api/v2/resource-meta', '/api/v2/resource-meta/Patient'],
    ['/api/v2/resources', '/api/v2/resources/Patient'],
    ['/api/v2/bulk-import/Patient', '/api/v2/bulk-import/Charge'],
    ['/api/v2/sync/table', '/api/v2/sync/records'],
    ['/api/v2/backups', '/api/v2/backups/abc.sqlite'],
    ['/api/v2/system/business-alerts', '/api/v2/system/business-alerts/abc'],
    ['/api/v2/system/audit/cleanup'],
    ['/api/v2/hr/leaves', '/api/v2/hr/leaves/abc'],
    ['/api/v2/hr/attendance'],
    ['/api/v2/charges', '/api/v2/charges/abc'],
    ['/api/v2/member-cards', '/api/v2/member-cards/abc'],
    ['/api/v2/debts', '/api/v2/debts/abc'],
    ['/api/v2/inventory', '/api/v2/inventory/abc'],
    ['/api/v2/purchase-orders', '/api/v2/purchase-orders/abc'],
    ['/api/v2/processing-orders', '/api/v2/processing-orders/abc'],
    ['/api/v2/appointments', '/api/v2/appointments/abc'],
    ['/api/v2/registrations', '/api/v2/visits', '/api/v2/first-exams', '/api/v2/treatments', '/api/v2/medical-records', '/api/v2/patients/p1/risk', '/api/v2/prescriptions', '/api/v2/cephalometric', '/api/v2/treatment-plans'],
    ['/api/v2/wechat', '/api/v2/wechat/send'],
    ['/api/v2/follow-ups', '/api/v2/follow-ups/abc'],
    ['/api/v2/notifications', '/api/v2/notifications/abc'],
    ['/api/v2/stats/dashboard'],
    ['/api/v2/stats/revenue'],
    ['/api/v2/stats/patient-growth'],
    ['/api/v2/stats/inventory'],
    ['/api/v2/stats/member-cards'],
    ['/api/v2/analytics/clinic-overview'],
    ['/api/v2/analytics', '/api/v2/analytics/xyz'],
    ['/api/v2/satisfaction'],
    ['/api/v2/charge-assistant'],
    ['/api/v2/print', '/api/v2/print/charge'],
    ['/api/v2/search'],
  ];
  const arr = samples[index] ?? ['/api/v2/placeholder'];
  return arr[0];
}

describe('routeRoleRules', () => {
  it('每条规则都能匹配到示例路径', () => {
    routeRoleRules.forEach((rule, idx) => {
      const path = samplePathForPattern(rule.pattern, idx);
      expect(rule.pattern.test(path)).toBe(true);
    });
  });

  routeRoleRules.forEach((rule, idx) => {
    const path = samplePathForPattern(rule.pattern, idx);
    const allowRole = rule.roles[0];
    const denyRole = pickDenied(rule.roles);

    it(`规则 #${idx + 1} ${rule.pattern}: ${allowRole} allow → path=${path}`, () => {
      expect(rule.pattern.test(path)).toBe(true);
      expect(rule.roles.includes(allowRole)).toBe(true);
    });

    if (denyRole) {
      it(`规则 #${idx + 1} ${rule.pattern}: ${denyRole} deny → path=${path}`, () => {
        expect(rule.pattern.test(path)).toBe(true);
        expect(rule.roles.includes(denyRole)).toBe(false);
      });
    }
  });
});

describe('navigationForRole', () => {
  it('BOSS 有最多的导航项', () => {
    const boss = navigationForRole('BOSS');
    const others = ALL_ROLES.filter((r) => r !== 'BOSS').map((r) => navigationForRole(r));
    others.forEach((nav) => {
      for (const key of nav) expect(boss).toContain(key);
    });
  });

  it('TECHNICIAN 仅访问 allStaff 导航项', () => {
    const nav = navigationForRole('TECHNICIAN');
    expect(nav).toEqual(expect.arrayContaining(['dashboard', 'patients']));
  });
});
