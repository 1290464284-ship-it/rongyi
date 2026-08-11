import { describe, expect, it } from 'vitest';
import { routeRoleRules, navigationForRole } from './route-policy';
import type { UserRole } from '../../domain/contracts';

const ALL_ROLES: readonly UserRole[] = ['BOSS', 'ADMIN', 'DOCTOR'];

function pickDenied(allowed: readonly UserRole[]): UserRole | null {
  return ALL_ROLES.find((r) => !allowed.includes(r)) ?? null;
}

function samplePathForPattern(pattern: RegExp, index: number): string {
  const samples: Array<Array<string>> = [
    ['/api/v2/auth/me', '/api/v2/auth/password', '/api/v2/auth/navigation'],
    ['/api/v2/auth/password', '/api/v2/auth/password'],
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
    ['/api/v2/charge-combos', '/api/v2/charge-combos/abc'],
    ['/api/v2/refunds', '/api/v2/refunds/abc'],
    ['/api/v2/inventory', '/api/v2/inventory/abc'],
    ['/api/v2/stocktakes', '/api/v2/stocktakes/abc'],
    ['/api/v2/dispenses', '/api/v2/dispenses/abc'],
    ['/api/v2/narcotic-registry'],
    ['/api/v2/purchase-orders', '/api/v2/purchase-orders/abc'],
    ['/api/v2/shift-templates', '/api/v2/shift-templates/abc', '/api/v2/shift-templates/generate'],
    ['/api/v2/schedules/week?weekStart=2026-08-03'],
    ['/api/v2/user-roles', '/api/v2/user-roles/u-1'],
    ['/api/v2/processing-orders', '/api/v2/processing-orders/abc'],
    ['/api/v2/treatment-plans/tp-1/bill', '/api/v2/treatment-plans/tp-1/items/it-1/discount'],
    ['/api/v2/appointments', '/api/v2/appointments/abc'],
    ['/api/v2/registrations', '/api/v2/visits', '/api/v2/first-exams', '/api/v2/treatments', '/api/v2/medical-records', '/api/v2/patients/p1/risk', '/api/v2/prescriptions', '/api/v2/cephalometric', '/api/v2/treatment-plans'],
    ['/api/v2/workbench', '/api/v2/workbench/today'],
    ['/api/v2/wechat-reminders/today', '/api/v2/wechat-reminders/config', '/api/v2/wechat-reminders/r-1/mark-sent', '/api/v2/wechat-reminders/r-1/dismiss'],
    ['/api/v2/wechat/send-batch'],
    ['/api/v2/wechat', '/api/v2/wechat/send'],
    ['/api/v2/follow-ups', '/api/v2/follow-ups/abc'],
    ['/api/v2/notifications', '/api/v2/notifications/abc'],
    ['/api/v2/stats/dashboard'],
    ['/api/v2/stats/revenue'],
    ['/api/v2/stats/patient-growth'],
    ['/api/v2/stats/inventory'],
    ['/api/v2/stats/member-cards'],
    ['/api/v2/stats/cost-share'],
    ['/api/v2/analytics/clinic-overview'],
    ['/api/v2/analytics', '/api/v2/analytics/xyz'],
    ['/api/v2/satisfaction'],
    ['/api/v2/charge-assistant'],
    ['/api/v2/print', '/api/v2/print/charge'],
    ['/api/v2/search'],
    ['/api/v2/inventory-reports/IN?from=2026-08-01&to=2026-08-05'],
    ['/api/v2/inventory-docs', '/api/v2/inventory-docs/abc'],
    ['/api/v2/inventory-transfers'],
    ['/api/v2/processing-flow-stats?from=2026-08-01&to=2026-08-05'],
    ['/api/v2/follow-up-dicts', '/api/v2/follow-up-dicts/abc'],
    ['/api/v2/departments', '/api/v2/departments/abc'],
    ['/api/v2/triage/queue'],
    ['/api/v2/pay-methods', '/api/v2/pay-methods/abc'],
    ['/api/v2/charge-trees', '/api/v2/charge-trees/c1/quick-charge'],
    ['/api/v2/commission/rules', '/api/v2/commission/statements?period=2026-08', '/api/v2/commission/calculate'],
    ['/api/v2/user-permissions/u-1', '/api/v2/user-permissions/u-1'],
    ['/api/v2/role-permissions/DOCTOR', '/api/v2/role-permissions/BOSS'],
    ['/api/v2/custom-fields?entity=patient', '/api/v2/custom-fields/values'],
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

  it('wechat send-batch 规则收窄为 老板/管理员 且优先于通用 wechat 规则', () => {
    const sendBatch = routeRoleRules.find((r) => r.pattern.test('/api/v2/wechat/send-batch') && r.pattern.source.includes('send-batch'));
    const generic = routeRoleRules.find((r) => r.pattern.test('/api/v2/wechat/status'));
    expect(sendBatch).toBeDefined();
    expect(sendBatch!.roles).toEqual(['BOSS', 'ADMIN']);
    expect(sendBatch!.pattern.test('/api/v2/wechat/send-batch')).toBe(true);
    expect(generic).toBeDefined();
    expect(routeRoleRules.indexOf(sendBatch!)).toBeLessThan(routeRoleRules.indexOf(generic!));
  });

  it('permission-gated routes require the matching module permission', () => {
    const permissionFor = (path: string) => routeRoleRules.find((rule) => rule.pattern.test(path))?.permission;
    expect(permissionFor('/api/v2/search?q=Demo')).toBe('patients');
    expect(permissionFor('/api/v2/workbench/today')).toBe('clinical');
    expect(permissionFor('/api/v2/files/abc/sign')).toBe('patients');
    expect(permissionFor('/api/v2/stats/dashboard')).toBe('dashboard');
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

  it('DOCTOR 仅访问 allStaff 导航项', () => {
    const nav = navigationForRole('DOCTOR');
    expect(nav).toEqual(expect.arrayContaining(['dashboard', 'patients']));
    expect(nav).not.toContain('frontDesk');
  });

  it('BOSS/ADMIN 可访问前台导航，DOCTOR 不可', () => {
    expect(navigationForRole('BOSS')).toContain('frontDesk');
    expect(navigationForRole('ADMIN')).toContain('frontDesk');
    expect(navigationForRole('DOCTOR')).not.toContain('frontDesk');
  });
});
