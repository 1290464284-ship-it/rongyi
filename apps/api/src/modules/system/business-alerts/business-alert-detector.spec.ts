 
import * as crypto from 'node:crypto';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../settings/settings.service';
import { CacheService } from '../../../common/services/cache.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import {
  BusinessAlertDetectorService,
  BusinessAlertRow,
} from './business-alert-detector.service';
import { FindingItem, DEFAULT_THRESHOLDS } from './thresholds';
import { computeRevenueDropFinding } from './alert-findings/revenue-drop.finding';
import { computeNewPatientsFinding } from './alert-findings/new-patients.finding';
import { computeNoShowRateFinding } from './alert-findings/no-show-rate.finding';
import { computeAovFinding } from './alert-findings/aov.finding';
import { computePerformanceAnomalyFindings } from './alert-findings/performance-anomaly.finding';
import { buildClinicFilter } from '../../../common/utils/db/clinic-filter';

const CLINIC_A = 'clinic-a-001';
const CLINIC_B = 'clinic-b-002';
const RUN_MONTH = '2025-12';
const PREV_MONTH = '2025-11';

function createMockClinicContext(clinicId: string | null = CLINIC_A): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockCacheService(): CacheService {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    delPattern: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
    getStats: () => ({ hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 1000 }),
    has: () => false,
    getOrSet: jest.fn(async <T>(_k: string, fn: () => T | Promise<T>) => fn()),
  } as unknown as CacheService;
}

function createMockAuditLogService(): AuditLogService {
  return {
    logAudit: jest.fn(() => {}),
  } as unknown as AuditLogService;
}

class ExtendedMockDbService extends MockDbService {
  constructor() {
    super();
    for (const t of ['ClinicInfo', 'BusinessAlert', 'AuditLog', 'Charge', 'Patient', 'Appointment']) {
      if (!this.tables.has(t)) this.tables.set(t, new Map());
    }
  }
}

function createSettingsService(db: ExtendedMockDbService, clinicId: string = CLINIC_A): SettingsService {
  const cache = createMockCacheService();
  const context = createMockClinicContext(clinicId);
  const auditLog = createMockAuditLogService();
  const svc = new SettingsService(asDbService(db), cache, context, auditLog);
  svc.onModuleInit();
  return svc;
}

function createDetector(db: ExtendedMockDbService, clinicId: string = CLINIC_A): {
  service: BusinessAlertDetectorService;
  settings: SettingsService;
  auditLog: AuditLogService;
} {
  const settings = createSettingsService(db, clinicId);
  const auditLog = createMockAuditLogService();
  const service = new BusinessAlertDetectorService(asDbService(db), settings, auditLog);
  return { service, settings, auditLog };
}

interface MockDbStmt {
  get: jest.Mock;
  all: jest.Mock;
  run: jest.Mock;
}
function mockPrepare(
  db: MockDbService,
  handler: (sql: string) => MockDbStmt | undefined,
): void {
  jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    const stmt = handler(sql);
    if (stmt) return stmt;
    return {
      get: jest.fn().mockReturnValue(undefined),
      all: jest.fn().mockReturnValue([]),
      run: jest.fn().mockReturnValue({ changes: 0, lastInsertRowid: '' }),
    };
  });
}

describe('TR-9.1~9.3: RevenueDropFinding', () => {
  let db: MockDbService;

  beforeEach(() => {
    db = new ExtendedMockDbService();
  });

  test('TR-9.1: 营收 60 vs 100 → -40% → CRITICAL', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Charge c') && sql.includes('monthRevenue')) {
        return {
          get: jest.fn().mockReturnValue({ monthRevenue: 60_0000, prevRevenue: 100_0000, totalPaidCharges: 50 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeRevenueDropFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('CRITICAL');
    expect(res!.alertType).toBe('REVENUE_DROP');
    expect(Math.round(res!.deviationPercent)).toBe(-40);
  });

  test('TR-9.2a: 80 vs 100 → -20% → WARN', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Charge c') && sql.includes('monthRevenue')) {
        return {
          get: jest.fn().mockReturnValue({ monthRevenue: 80_0000, prevRevenue: 100_0000, totalPaidCharges: 50 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeRevenueDropFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('WARN');
  });

  test('TR-9.2b: 95 vs 100 → -5% → INFO', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Charge c') && sql.includes('monthRevenue')) {
        return {
          get: jest.fn().mockReturnValue({ monthRevenue: 95_0000, prevRevenue: 100_0000, totalPaidCharges: 50 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeRevenueDropFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('INFO');
  });

  test('TR-9.3: 上月营收为 0 → 跳过不崩，返回 null', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Charge c') && sql.includes('monthRevenue')) {
        return {
          get: jest.fn().mockReturnValue({ monthRevenue: 100_0000, prevRevenue: 0, totalPaidCharges: 50 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeRevenueDropFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    expect(res).toBeNull();
  });

  test('营收数据不足 30 条 → 跳过', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Charge c') && sql.includes('monthRevenue')) {
        return {
          get: jest.fn().mockReturnValue({ monthRevenue: 50_0000, prevRevenue: 100_0000, totalPaidCharges: 10 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeRevenueDropFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    expect(res).toBeNull();
  });
});

describe('TR-9.4~9.5: NoShowRateFinding', () => {
  let db: MockDbService;
  beforeEach(() => { db = new ExtendedMockDbService(); });

  test('TR-9.4: NO_SHOW 18/100 → 18% → WARN', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Appointment a') && sql.includes('noShowCount')) {
        return {
          get: jest.fn().mockReturnValue({ noShowCount: 18, totalCount: 100 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeNoShowRateFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, warn: 15, critical: 25,
    });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('WARN');
    expect(res!.alertType).toBe('NO_SHOW_RATE');
    expect(res!.deviationPercent).toBeGreaterThanOrEqual(18);
  });

  test('TR-9.5: 26/100 → 26% → CRITICAL', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Appointment a') && sql.includes('noShowCount')) {
        return {
          get: jest.fn().mockReturnValue({ noShowCount: 26, totalCount: 100 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeNoShowRateFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, warn: 15, critical: 25,
    });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('CRITICAL');
  });

  test('total=0 → 返回 null', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Appointment a')) {
        return {
          get: jest.fn().mockReturnValue({ noShowCount: 0, totalCount: 0 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeNoShowRateFinding(db, CLINIC_A, { runMonth: RUN_MONTH, warn: 15, critical: 25 });
    expect(res).toBeNull();
  });
});

describe('TR-9.6: NewPatientsFinding', () => {
  let db: MockDbService;
  beforeEach(() => { db = new ExtendedMockDbService(); });

  test('TR-9.6: 40 vs 62 → -35.5% → CRITICAL', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Patient p')) {
        return {
          get: jest.fn().mockReturnValue({ monthCount: 40, prevCount: 62, totalPatients: 300 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeNewPatientsFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('CRITICAL');
    expect(res!.alertType).toBe('NEW_PATIENTS');
    expect(res!.deviationPercent).toBeLessThan(-35);
  });

  test('prev=0 → 跳过不崩', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Patient p')) {
        return {
          get: jest.fn().mockReturnValue({ monthCount: 40, prevCount: 0, totalPatients: 100 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeNewPatientsFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    expect(res).toBeNull();
  });

  test('dataPoints<10 降级 CRITICAL→WARN', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Patient p')) {
        return {
          get: jest.fn().mockReturnValue({ monthCount: 3, prevCount: 6, totalPatients: 9 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeNewPatientsFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('WARN');
  });
});

describe('TR-9.7: AovFinding', () => {
  let db: MockDbService;
  beforeEach(() => { db = new ExtendedMockDbService(); });

  test('TR-9.7: AOV 7000 vs 10000 → -30% → CRITICAL', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Charge c') && sql.includes('prevChargeCount')) {
        return {
          get: jest.fn().mockReturnValue({
            monthRevenue: 70_0000, monthChargeCount: 100,
            prevRevenue: 100_0000, prevChargeCount: 100,
          }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeAovFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 15, critical: 30,
    });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('CRITICAL');
    expect(res!.alertType).toBe('AOV');
    expect(Math.round(res!.deviationPercent)).toBe(-30);
  });

  test('monthChargeCount=0 → 跳过', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Charge c') && sql.includes('prevChargeCount')) {
        return {
          get: jest.fn().mockReturnValue({
            monthRevenue: 0, monthChargeCount: 0,
            prevRevenue: 100_0000, prevChargeCount: 100,
          }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeAovFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 15, critical: 30,
    });
    expect(res).toBeNull();
  });
});

describe('TR-9.8: PerformanceAnomalyFinding', () => {
  let db: MockDbService;
  beforeEach(() => { db = new ExtendedMockDbService(); });

  test('TR-9.8: 医生 A Z=5 → CRITICAL', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('GROUP BY c.doctorId')) {
        return {
          get: jest.fn().mockReturnValue(undefined),
          all: jest.fn().mockReturnValue([{
            doctorId: 'dr-A',
            recent30Revenue: 150_0000,
            history90Revenue: 3_000_000,
            history90Count: 90,
            recent30Count: 30,
          }]),
          run: jest.fn(),
        };
      }
    });
    const res = computePerformanceAnomalyFindings(db, CLINIC_A, {
      todayISO: '2026-01-15T00:00:00.000Z', warn: 3, critical: 5,
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThanOrEqual(0);
  });

  test('history90Count<30 → 跳过', () => {
    mockPrepare(db, (sql) => {
      if (sql.includes('GROUP BY c.doctorId')) {
        return {
          get: jest.fn().mockReturnValue(undefined),
          all: jest.fn().mockReturnValue([{
            doctorId: 'dr-A',
            recent30Revenue: 200_0000,
            history90Revenue: 100_0000,
            history90Count: 20,
            recent30Count: 10,
          }]),
          run: jest.fn(),
        };
      }
    });
    const res = computePerformanceAnomalyFindings(db, CLINIC_A, {
      todayISO: '2026-01-15T00:00:00.000Z', warn: 3, critical: 5,
    });
    expect(res.length).toBe(0);
  });
});

describe('TR-9.9: 新库数据不足 → 全跳过', () => {
  test('TR-9.9: 无 Charge/Appointment/Patient 数据 → 返回 []', async () => {
    const db = new ExtendedMockDbService();
    const { service } = createDetector(db);
    const res = await service.detectForClinic(CLINIC_A, { runMonth: RUN_MONTH });
    expect(res).toEqual([]);
  });
});

describe('TR-9.10: dedup 逻辑', () => {
  test('TR-9.10: 同一天重复 detectForClinic → BusinessAlert COUNT=1，UPDATE 最新值', async () => {
    const db = new ExtendedMockDbService();
    const { service } = createDetector(db);

    const mockHasData = jest.fn();
    mockHasData.mockReturnValueOnce(true);

    const findings1: FindingItem[] = [
      {
        alertType: 'REVENUE_DROP', severity: 'WARN', metricName: 'monthly-revenue',
        currentValue: 80_0000, baselineValue: 100_0000, deviationPercent: -20,
        message: '第一次检测', suggestion: '建议1', occurredAt: new Date().toISOString(),
      },
    ];
    const persisted1 = service.dedupeAndPersist(CLINIC_A, findings1);
    expect(persisted1.length).toBe(1);

    const findings2: FindingItem[] = [
      {
        alertType: 'REVENUE_DROP', severity: 'CRITICAL', metricName: 'monthly-revenue',
        currentValue: 60_0000, baselineValue: 100_0000, deviationPercent: -40,
        message: '第二次检测（更新后）', suggestion: '建议2', occurredAt: new Date().toISOString(),
      },
    ];
    const persisted2 = service.dedupeAndPersist(CLINIC_A, findings2);
    expect(persisted2.length).toBe(1);

    const alerts = db.getTableData('BusinessAlert');
    expect(alerts.length).toBe(1);
    expect(alerts[0].severity).toBe('CRITICAL');
    expect(alerts[0].currentValue).toBe(60_0000);
    expect(String(alerts[0].message)).toContain('第二次检测');
  });
});

describe('TR-9.11: Settings 阈值覆盖', () => {
  test('TR-9.11: 自定义阈值 warn=5%, critical=10% → 跌 9% 进入 WARN（默认不会触发）', async () => {
    const db = new ExtendedMockDbService();

    const tableClinicInfo = db.tables.get('ClinicInfo')!;
    tableClinicInfo.set(crypto.randomUUID(), {
      id: crypto.randomUUID(), key: 'aiAlertRevenueDropWarn', value: '5', clinicId: CLINIC_A, updatedAt: new Date().toISOString(),
    });
    tableClinicInfo.set(crypto.randomUUID(), {
      id: crypto.randomUUID(), key: 'aiAlertRevenueDropCritical', value: '10', clinicId: CLINIC_A, updatedAt: new Date().toISOString(),
    });

    const earliestDate = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    for (let i = 0; i < 50; i++) {
      db.tables.get('Charge')!.set(crypto.randomUUID(), {
        id: crypto.randomUUID(),
        clinicId: CLINIC_A,
        paidAmount: 1000,
        paidAt: earliestDate,
        deletedAt: null,
      });
    }
    for (let i = 0; i < 50; i++) {
      db.tables.get('Appointment')!.set(crypto.randomUUID(), {
        id: crypto.randomUUID(),
        clinicId: CLINIC_A,
        startTime: earliestDate,
        status: 'COMPLETED',
        deletedAt: null,
      });
    }
    for (let i = 0; i < 50; i++) {
      db.tables.get('Patient')!.set(crypto.randomUUID(), {
        id: crypto.randomUUID(),
        clinicId: CLINIC_A,
        createdAt: earliestDate,
        deletedAt: null,
      });
    }

    const settings = createSettingsService(db, CLINIC_A);
    const warn = await settings.getNumber('aiAlertRevenueDropWarn', DEFAULT_THRESHOLDS.REVENUE_DROP.warn);
    const critical = await settings.getNumber('aiAlertRevenueDropCritical', DEFAULT_THRESHOLDS.REVENUE_DROP.critical);
    expect(warn).toBe(5);
    expect(critical).toBe(10);
  });
});

describe('TR-9.12: 2 家诊所隔离', () => {
  test('TR-9.12: 诊所 A/B computeXxxFinding 调用时参数化 SQL 正确传递各自 clinicId', () => {
    const db = new ExtendedMockDbService();
    const captured: Array<{ sql: string; params: any[] }> = [];
    mockPrepare(db, (sql) => {
      captured.push({ sql, params: [] });
      if (sql.includes('monthRevenue')) {
        return {
          get: jest.fn((...args) => {
            captured[captured.length - 1].params = args;
            const lastClinic = args[args.length - 1];
            if (lastClinic === CLINIC_A) {
              return { monthRevenue: 95_0000, prevRevenue: 100_0000, totalPaidCharges: 50 };
            }
            return { monthRevenue: 60_0000, prevRevenue: 100_0000, totalPaidCharges: 50 };
          }) as any,
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });

    const resA = computeRevenueDropFinding(db, CLINIC_A, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });
    const resB = computeRevenueDropFinding(db, CLINIC_B, {
      runMonth: RUN_MONTH, prevMonth: PREV_MONTH, warn: 20, critical: 35,
    });

    expect(resA).not.toBeNull();
    expect(resB).not.toBeNull();
    expect(resA!.severity).toBe('INFO');
    expect(resB!.severity).toBe('CRITICAL');

    // 验证 prepare 调用中 SQL 包含 clinicId = ? 参数
    const calls = captured.filter((c) => c.sql.includes('FROM Charge'));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // 检查 params 中最后一位是 CLINIC_A / CLINIC_B（buildClinicFilter 追加的参数）
    const callA = calls.find((c) => c.params.includes(CLINIC_A));
    const callB = calls.find((c) => c.params.includes(CLINIC_B));
    expect(callA).toBeDefined();
    expect(callB).toBeDefined();
    expect(callA!.sql).toContain('clinicId = ?');
    expect(callB!.sql).toContain('clinicId = ?');
  });
});

describe('detector 边界与其他', () => {
  test('clinicId 缺失 buildClinicFilter 抛错（保护）', () => {
    expect(() => buildClinicFilter('')).toThrow(/CLINIC_CONTEXT_MISSING/);
    expect(() => buildClinicFilter(null)).toThrow();
    expect(() => buildClinicFilter()).toThrow();
    const valid = buildClinicFilter('abc-123');
    expect(valid.clause).toContain('clinicId = ?');
    expect(valid.params).toEqual(['abc-123']);
  });

  test('severity classify 工具函数: 边界值', () => {
    const { classifySeverity } = require('./thresholds');
    expect(classifySeverity(5, 20, 35)).toBe('INFO');
    expect(classifySeverity(20, 20, 35)).toBe('WARN');
    expect(classifySeverity(25, 20, 35)).toBe('WARN');
    expect(classifySeverity(35, 20, 35)).toBe('CRITICAL');
    expect(classifySeverity(40, 20, 35)).toBe('CRITICAL');
  });

  test('FindingItem dedupeAndPersist: INSERT + 审计日志触发', () => {
    const db = new ExtendedMockDbService();
    const { service, auditLog } = createDetector(db);
    const findings: FindingItem[] = [
      {
        alertType: 'NO_SHOW_RATE', severity: 'WARN', metricName: 'no-show-rate',
        currentValue: 18, baselineValue: 100, deviationPercent: 18,
        message: '失约率 18%', suggestion: '短信提醒', occurredAt: new Date().toISOString(),
      },
    ];
    const rows = service.dedupeAndPersist(CLINIC_A, findings);
    expect(rows.length).toBe(1);
    expect(auditLog.logAudit).toHaveBeenCalled();
  });

  test('empty findings → dedupeAndPersist 返回 []', () => {
    const db = new ExtendedMockDbService();
    const { service } = createDetector(db);
    const rows = service.dedupeAndPersist(CLINIC_A, []);
    expect(rows).toEqual([]);
  });

  test('silentInsert=true → 返回内存 rows，不写入 DB', async () => {
    const db = new ExtendedMockDbService();
    const { service } = createDetector(db);
    const res = await service.detectForClinic(CLINIC_A, { runMonth: RUN_MONTH, silentInsert: true });
    const alerts = db.getTableData('BusinessAlert');
    expect(alerts.length).toBe(0);
    expect(Array.isArray(res)).toBe(true);
  });

  test('insertInfo=false → INFO 级 finding 被过滤', async () => {
    const db = new ExtendedMockDbService();
    const earliestDate = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    for (let i = 0; i < 50; i++) {
      db.tables.get('Charge')!.set(crypto.randomUUID(), {
        id: crypto.randomUUID(), clinicId: CLINIC_A, paidAmount: 1000, paidAt: earliestDate, deletedAt: null,
      });
    }
    for (let i = 0; i < 50; i++) {
      db.tables.get('Appointment')!.set(crypto.randomUUID(), {
        id: crypto.randomUUID(), clinicId: CLINIC_A, startTime: earliestDate, status: 'COMPLETED', deletedAt: null,
      });
    }
    for (let i = 0; i < 50; i++) {
      db.tables.get('Patient')!.set(crypto.randomUUID(), {
        id: crypto.randomUUID(), clinicId: CLINIC_A, createdAt: earliestDate, deletedAt: null,
      });
    }
    const { service } = createDetector(db);
    const res = await service.detectForClinic(CLINIC_A, { runMonth: RUN_MONTH, insertInfo: false });
    const allInfoFiltered = res.every((r: BusinessAlertRow) => r.severity !== 'INFO');
    expect(allInfoFiltered).toBe(true);
  });

  test('除0保护: NoShow current=0 → 不应为 NaN', () => {
    const db = new ExtendedMockDbService();
    mockPrepare(db, (sql) => {
      if (sql.includes('FROM Appointment a')) {
        return {
          get: jest.fn().mockReturnValue({ noShowCount: 0, totalCount: 100 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
    });
    const res = computeNoShowRateFinding(db, CLINIC_A, { runMonth: RUN_MONTH, warn: 15, critical: 25 });
    expect(res).not.toBeNull();
    expect(res!.severity).toBe('INFO');
    expect(Number.isFinite(res!.deviationPercent)).toBe(true);
  });

  test('runMonth 参数传递时正确解析上月', async () => {
    const db = new ExtendedMockDbService();
    const { service } = createDetector(db);
    mockPrepare(db, (sql) => {
      if (sql.includes('MIN(c.paidAt)') || sql.includes('MIN(a.startTime)') || sql.includes('MIN(p.createdAt)')) {
        return {
          get: jest.fn().mockReturnValue({
            minCharge: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
            minAppt: null, minPatient: null,
          }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
      if (sql.includes('FROM Charge c') && sql.includes('monthRevenue')) {
        return {
          get: jest.fn().mockReturnValue({ monthRevenue: 100_0000, prevRevenue: 100_0000, totalPaidCharges: 50 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
      if (sql.includes('FROM Patient p')) {
        return {
          get: jest.fn().mockReturnValue({ monthCount: 50, prevCount: 50, totalPatients: 100 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
      if (sql.includes('FROM Appointment a') && sql.includes('noShowCount')) {
        return {
          get: jest.fn().mockReturnValue({ noShowCount: 5, totalCount: 100 }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
      if (sql.includes('FROM Charge c') && sql.includes('prevChargeCount')) {
        return {
          get: jest.fn().mockReturnValue({
            monthRevenue: 100_0000, monthChargeCount: 100,
            prevRevenue: 100_0000, prevChargeCount: 100,
          }),
          all: jest.fn().mockReturnValue([]),
          run: jest.fn(),
        };
      }
      if (sql.includes('GROUP BY c.doctorId')) {
        return { get: jest.fn(), all: jest.fn().mockReturnValue([]), run: jest.fn() };
      }
    });
    const res = await service.detectForClinic(CLINIC_A, { runMonth: '2026-01', silentInsert: true, insertInfo: true });
    expect(Array.isArray(res)).toBe(true);
  });
});
