import Database from 'better-sqlite3';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../../db/test-helpers';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { CacheService } from '../../../common/services/cache.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { PerformanceAnomalyService } from './performance-anomaly.service';
import {
  computeZScores,
  classifySeverity,
} from './performance-anomaly.service';
import {
  TEST_CLINIC_ID,
  TEST_DOCTOR_ID,
} from '../../../../test/factories';

type DbInstance = InstanceType<typeof Database>;

function makeDoctorId(i: number): string {
  return `doc-${String(i).padStart(4, '0')}`;
}

describe('PerformanceAnomalyService', () => {
  let db: DbInstance;
  let dbService: DbService;
  let clinicContext: ClinicContextService;
  let cacheService: CacheService;
  let auditLogService: AuditLogService;
  let settingsService: SettingsService;
  let service: PerformanceAnomalyService;

  function daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  function insertDoctor(id: string, name: string): void {
    db.prepare(
      `INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, clinicId, active, createdAt, updatedAt)
       VALUES (?, ?, 'hash', ?, 'DOCTOR', ?, 1, ?, ?)`
    ).run(id, `dr-${id.slice(-4)}`, name, TEST_CLINIC_ID, daysAgo(500), daysAgo(500));
  }

  function insertCharge(
    id: string,
    patientId: string,
    doctorId: string,
    days: number,
    amount: number,
    status: 'PAID' | 'PARTIAL' = 'PAID',
  ): void {
    const createdAt = daysAgo(days);
    db.prepare(
      `INSERT OR IGNORE INTO Charge (id, patientId, clinicId, doctorId, number, status, totalAmount, refundedAmount, createdAt, paidAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(id, patientId, TEST_CLINIC_ID, doctorId, `CH-${id}`, status, amount, createdAt, createdAt, createdAt);
  }

  function insertVisit(
    id: string,
    patientId: string,
    doctorId: string,
    days: number,
  ): void {
    const start = daysAgo(days);
    const end = new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO Visit (id, patientId, doctorId, clinicId, startTime, endTime, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)`
    ).run(id, patientId, doctorId, TEST_CLINIC_ID, start, end, start, start);
  }

  function insertAppointment(
    id: string,
    patientId: string,
    doctorId: string,
    days: number,
    status: 'NO_SHOW' | 'COMPLETED' | 'CANCELLED' | 'BOOKED',
  ): void {
    const start = daysAgo(days);
    const end = new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO Appointment (id, patientId, doctorId, clinicId, status, type, startTime, endTime, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'CONSULTATION', ?, ?, ?, ?)`
    ).run(id, patientId, doctorId, TEST_CLINIC_ID, status, start, end, start, start);
  }

  function writeSetting(key: string, value: string): void {
    const now = new Date().toISOString();
    const existing = db.prepare(
      "SELECT id FROM ClinicInfo WHERE key = ? AND clinicId IS NULL"
    ).get(key);
    if (existing) {
      db.prepare("UPDATE ClinicInfo SET value = ?, updatedAt = ? WHERE key = ? AND clinicId IS NULL")
        .run(value, now, key);
    } else {
      const id = `${key}-${Math.random().toString(36).slice(2, 10)}`;
      db.prepare(
        "INSERT INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, NULL, ?)"
      ).run(id, key, value, now);
    }
  }

  beforeEach(async () => {
    db = createTestDb();
    dbService = createTestDbService(db);
    clinicContext = new ClinicContextService();
    cacheService = new CacheService();
    cacheService.onModuleInit();
    auditLogService = new AuditLogService();
    settingsService = new SettingsService(dbService, cacheService, clinicContext, auditLogService);
    await runInClinicContext(
      clinicContext,
      { clinicId: '', userId: 'super', role: 'SUPER_ADMIN' },
      () => {
        settingsService.onModuleInit();
      },
    );
    writeSetting('aiDoctorPerfAnomalyEnabled', 'true');
    service = new PerformanceAnomalyService(dbService, clinicContext, settingsService);
    seedTestData(db);
  });

  afterEach(() => {
    cacheService.onModuleDestroy();
    cleanupTestDb(db);
  });

  describe('纯函数 - z-score 与严重度 classifySeverity', () => {
    it('TR-11.15 μ=100, σ=10；current=150 → z=5 → CRITICAL；z=25 → 同样 CRITICAL', () => {
      const { zScore } = computeZScores(150, 100, 10);
      expect(zScore).toBeCloseTo(5, 5);
      expect(classifySeverity(zScore)).toBe('CRITICAL');

      const { zScore: z25 } = computeZScores(350, 100, 10);
      expect(classifySeverity(z25)).toBe('CRITICAL');
    });

    it('TR-11.16 current=85 → z=-1.5 → NORMAL(null)；z=-2.2 → WARN；边界分档', () => {
      expect(classifySeverity(-1.5)).toBeNull();
      expect(classifySeverity(-2.2)).toBe('WARN');
      expect(classifySeverity(1.6)).toBe('INFO');
      expect(classifySeverity(2.1)).toBe('WARN');
      expect(classifySeverity(3.01)).toBe('CRITICAL');
    });
  });

  describe('集成测试 - 异常检测 DB 行为', () => {
    it('TR-11.17 baseline sampleSize=2 < 3 → skip 不误报', async () => {
      const doctorId = makeDoctorId(17);
      insertDoctor(doctorId, '医生17');
      const pid = 'p-17';
      db.prepare(
        `INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt)
         VALUES (?, ?, 'p17', 'MALE', '13800000000', ?, 1, ?, ?)`
      ).run(pid, 'P0017', TEST_CLINIC_ID, daysAgo(500), daysAgo(500));

      for (let i = 0; i < 2; i++) {
        const day = 400 - i * 30;
        insertCharge(`ch-17-${i}`, pid, doctorId, day, 10000);
      }

      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          const _res = await service.batchDetectAnomalies();
          const rows = db.prepare(
            `SELECT * FROM DoctorPerformanceAnomaly WHERE doctorId = ? AND clinicId = ?`
          ).all(doctorId, TEST_CLINIC_ID) as any[];
          expect(rows.length).toBe(0);
        },
      );
    });

    it('TR-11.18 NO_SHOW_RATE_30D：10 条中 3 条 NO_SHOW → 0.3；历史 μ=0.1, σ=0.05 → z=4 → CRITICAL', async () => {
      const doctorId = makeDoctorId(18);
      insertDoctor(doctorId, '医生18');

      const pids: string[] = [];
      for (let i = 0; i < 40; i++) {
        const pid = `p18-${i}`;
        db.prepare(
          `INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt)
           VALUES (?, ?, ?, 'MALE', '13800000000', ?, 1, ?, ?)`
        ).run(pid, `P18-${i}`, `p18-${i}`, TEST_CLINIC_ID, daysAgo(500), daysAgo(500));
        pids.push(pid);
      }

      for (let w = 0; w < 6; w++) {
        const windowBase = 200 + w * 30;
        for (let i = 0; i < 10; i++) {
          const day = windowBase + (i % 25);
          const noShow = i < 1 ? true : false;
          insertAppointment(
            `ap-18-${w}-${i}`,
            pids[w * 10 + i] ?? pids[0],
            doctorId,
            day,
            noShow ? 'NO_SHOW' : 'COMPLETED',
          );
        }
      }

      for (let i = 0; i < 10; i++) {
        insertAppointment(
          `ap-18-now-${i}`,
          pids[30 + i],
          doctorId,
          1 + i,
          i < 3 ? 'NO_SHOW' : 'COMPLETED',
        );
      }

      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          await service.batchDetectAnomalies();
          const rows = db.prepare(
            `SELECT * FROM DoctorPerformanceAnomaly WHERE doctorId = ? AND metric = ? AND clinicId = ?`
          ).all(doctorId, 'NO_SHOW_RATE_30D', TEST_CLINIC_ID) as any[];
          expect(rows.length).toBeGreaterThanOrEqual(1);
          const row = rows[0];
          expect(row.severity).toBe('CRITICAL');
          expect(row.zScore).toBeGreaterThan(3);
        },
      );
    });

    it('TR-11.19 VISITS_30D z=-3.1（暴跌）→ CRITICAL；z=0.5 NORMAL', () => {
      const sevBad = classifySeverity(-3.1);
      expect(sevBad).toBe('CRITICAL');
      const sevGood = classifySeverity(0.5);
      expect(sevGood).toBeNull();
    });

    it('TR-11.20 AVG_AOV_30D z=3.5 → CRITICAL', () => {
      expect(classifySeverity(3.5)).toBe('CRITICAL');
    });

    it('TR-11.21 resolve(id) → resolvedAt 非空；list filter resolved=false 过滤', async () => {
      const doctorId = makeDoctorId(21);
      insertDoctor(doctorId, '医生21');
      const now = new Date().toISOString();
      const datePart = now.slice(0, 10);
      const id = 'anom-21-crit';
      db.prepare(
        `INSERT INTO DoctorPerformanceAnomaly (id, doctorId, clinicId, metric, baselineMean, baselineStd, sampleSize, currentValue, zScore, severity, detectedAt, detectedAtDate, resolvedAt, note, updatedAt)
         VALUES (?, ?, ?, 'REVENUE_30D', 100, 10, 10, 150, 5, 'CRITICAL', ?, ?, NULL, NULL, ?)`
      ).run(id, doctorId, TEST_CLINIC_ID, now, datePart, now);

      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          const before = await service.listAnomalies({ resolved: false, page: 1, pageSize: 10 });
          const beforeItems = before.items as Array<{ id: string }>;
          expect(beforeItems.find(r => r.id === id)).toBeDefined();

          await service.resolve(id, '已处置');
          const after = db.prepare(
            `SELECT resolvedAt, note FROM DoctorPerformanceAnomaly WHERE id = ?`
          ).get(id) as any;
          expect(after.resolvedAt).not.toBeNull();
          expect(after.note).toBe('已处置');

          const filtered = await service.listAnomalies({ resolved: false, page: 1, pageSize: 10 });
          const filteredItems = filtered.items as Array<{ id: string }>;
          expect(filteredItems.find(r => r.id === id)).toBeUndefined();
        },
      );
    });

    it('TR-11.22 listAnomalies severity=CRITICAL → 仅 CRITICAL 条', async () => {
      const doctorId = makeDoctorId(22);
      insertDoctor(doctorId, '医生22');
      const now = new Date().toISOString();
      const datePart = now.slice(0, 10);
      db.prepare(
        `INSERT INTO DoctorPerformanceAnomaly (id, doctorId, clinicId, metric, baselineMean, baselineStd, sampleSize, currentValue, zScore, severity, detectedAt, detectedAtDate, resolvedAt, note, updatedAt)
         VALUES ('an-22-1', ?, ?, 'REVENUE_30D', 100, 10, 10, 150, 5, 'CRITICAL', ?, ?, NULL, NULL, ?)`
      ).run(doctorId, TEST_CLINIC_ID, now, datePart, now);
      db.prepare(
        `INSERT INTO DoctorPerformanceAnomaly (id, doctorId, clinicId, metric, baselineMean, baselineStd, sampleSize, currentValue, zScore, severity, detectedAt, detectedAtDate, resolvedAt, note, updatedAt)
         VALUES ('an-22-2', ?, ?, 'VISITS_30D', 50, 8, 10, 66, 2, 'WARN', ?, ?, NULL, NULL, ?)`
      ).run(doctorId, TEST_CLINIC_ID, now, `${datePart}-dup`, now);

      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          const res = await service.listAnomalies({ severity: 'CRITICAL', page: 1, pageSize: 20 });
          const items = res.items as Array<{ id: string; severity: string }>;
          expect(items.every(r => r.severity === 'CRITICAL')).toBe(true);
          expect(items.length).toBe(1);
          expect(items[0].id).toBe('an-22-1');
        },
      );
    });

    it('TR-11.23 当日去重：同 doctorId+metric+当天 2 次 detectAnomalies 调用 → 不重复', async () => {
      const doctorId = makeDoctorId(23);
      insertDoctor(doctorId, '医生23');
      const pids: string[] = [];
      for (let i = 0; i < 100; i++) {
        const pid = `p23-${i}`;
        db.prepare(
          `INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt)
           VALUES (?, ?, ?, 'MALE', '13800000000', ?, 1, ?, ?)`
        ).run(pid, `P23-${i}`, `p23-${i}`, TEST_CLINIC_ID, daysAgo(500), daysAgo(500));
        pids.push(pid);
      }

      for (let w = 0; w < 6; w++) {
        const windowBase = 200 + w * 30;
        for (let i = 0; i < 15; i++) {
          const day = windowBase + (i % 25);
          const pid = pids[w * 15 + i] ?? pids[0];
          insertCharge(`ch-23-${w}-${i}`, pid, doctorId, day, 5000 + i * 100);
          insertVisit(`v-23-${w}-${i}`, pid, doctorId, day);
        }
      }

      for (let i = 0; i < 5; i++) {
        insertCharge(`ch-23-cur-${i}`, pids[90 + i], doctorId, 1 + i, 100000);
        insertVisit(`v-23-cur-${i}`, pids[90 + i], doctorId, 1 + i);
      }

      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          await service.batchDetectAnomalies();
          const count1 = (db.prepare(
            `SELECT COUNT(*) AS c FROM DoctorPerformanceAnomaly WHERE doctorId = ? AND clinicId = ?`
          ).get(doctorId, TEST_CLINIC_ID) as any).c;

          await service.batchDetectAnomalies();
          const count2 = (db.prepare(
            `SELECT COUNT(*) AS c FROM DoctorPerformanceAnomaly WHERE doctorId = ? AND clinicId = ?`
          ).get(doctorId, TEST_CLINIC_ID) as any).c;

          expect(count2).toBe(count1);
        },
      );
    });

    it('TR-11.24 aiDoctorPerfAnomalyEnabled=false 时 batchDetectAnomalies 直接返回空 scanned=0', async () => {
      writeSetting('aiDoctorPerfAnomalyEnabled', 'false');
      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          const res = await service.batchDetectAnomalies();
          expect(res.scanned).toBe(0);
          expect(res.detectedWarn).toBe(0);
          expect(res.detectedCritical).toBe(0);
        },
      );
    });
  });
});
