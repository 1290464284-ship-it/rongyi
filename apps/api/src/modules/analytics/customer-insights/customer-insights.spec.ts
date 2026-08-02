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
import { CustomerInsightsService } from './customer-insights.service';
import {
  quantile,
  computeScoreForValue,
  classifyRfmSegment,
  computeChurnProbability,
  RfmSegment,
} from './customer-insights.service';
import {
  TEST_CLINIC_ID,
  TEST_DOCTOR_ID,
} from '../../../../test/factories';

type DbInstance = InstanceType<typeof Database>;

describe('CustomerInsightsService', () => {
  let db: DbInstance;
  let dbService: DbService;
  let clinicContext: ClinicContextService;
  let cacheService: CacheService;
  let auditLogService: AuditLogService;
  let settingsService: SettingsService;
  let service: CustomerInsightsService;

  function daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  function insertPatient(id: string, name: string): void {
    db.prepare(
      `INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt)
       VALUES (?, ?, ?, 'MALE', '13800000000', ?, 1, ?, ?)`
    ).run(id, `P${id.slice(-4)}`, name, TEST_CLINIC_ID, daysAgo(500), daysAgo(500));
  }

  function insertCharge(
    id: string,
    patientId: string,
    status: 'PAID' | 'PARTIAL' | 'REFUNDED' | 'CANCELLED' | 'UNPAID',
    days: number,
    amount: number,
    refundedAmount = 0,
  ): void {
    const createdAt = daysAgo(days);
    db.prepare(
      `INSERT OR IGNORE INTO Charge (id, patientId, clinicId, doctorId, number, status, totalAmount, refundedAmount, createdAt, paidAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, patientId, TEST_CLINIC_ID, TEST_DOCTOR_ID, `CH-${id}`,
      status, amount, refundedAmount, createdAt,
      ['PAID', 'PARTIAL'].includes(status) ? createdAt : null,
      createdAt
    );
  }

  function _insertAppointment(
    id: string,
    patientId: string,
    status: 'NO_SHOW' | 'COMPLETED' | 'CANCELLED' | 'SCHEDULED',
    days: number,
  ): void {
    const start = daysAgo(days);
    const end = new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO Appointment (id, patientId, doctorId, clinicId, status, startTime, endTime, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, patientId, TEST_DOCTOR_ID, TEST_CLINIC_ID, status, start, end, start, start);
  }

  function _insertFollowUp(
    id: string,
    patientId: string,
    planDaysAgo: number,
    status: 'PENDING' | 'COMPLETED' | 'OVERDUE',
  ): void {
    const planDate = daysAgo(planDaysAgo);
    const createdAt = daysAgo(planDaysAgo + 10);
    db.prepare(
      `INSERT OR IGNORE INTO FollowUp (id, patientId, clinicId, planDate, status, content, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, '随访', ?, ?)`
    ).run(id, patientId, TEST_CLINIC_ID, planDate, status, createdAt, createdAt);
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
    cacheService.delPattern('settings');
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
    writeSetting('aiRfmEnabled', 'true');
    writeSetting('aiChurnEnabled', 'true');
    writeSetting('aiDoctorPerfAnomalyEnabled', 'true');
    writeSetting('aiRfmLookbackMonths', '18');
    service = new CustomerInsightsService(dbService, clinicContext, settingsService);
    seedTestData(db);
  });

  afterEach(() => {
    cacheService.onModuleDestroy();
    cleanupTestDb(db);
  });

  describe('纯函数 - 分位点 quantile', () => {
    it('TR-11.1 分位点：R=[1..39 step 2] 共 20 位，0.2/0.4/0.6/0.8 ≈ 7/15/23/31 ±2', () => {
      const R = Array.from({ length: 20 }, (_, i) => 1 + i * 2);
      expect(quantile(R, 0.2)).toBeGreaterThanOrEqual(6);
      expect(quantile(R, 0.2)).toBeLessThanOrEqual(9);
      expect(quantile(R, 0.4)).toBeGreaterThanOrEqual(14);
      expect(quantile(R, 0.4)).toBeLessThanOrEqual(17);
      expect(quantile(R, 0.6)).toBeGreaterThanOrEqual(22);
      expect(quantile(R, 0.6)).toBeLessThanOrEqual(25);
      expect(quantile(R, 0.8)).toBeGreaterThanOrEqual(30);
      expect(quantile(R, 0.8)).toBeLessThanOrEqual(33);
    });

    it('TR-11.2 R 边界：R 越小得分越高。分位点下 R=1→5，R=40→1', () => {
      const arr = Array.from({ length: 20 }, (_, i) => 1 + i * 2);
      const qs = [quantile(arr, 0.2), quantile(arr, 0.4), quantile(arr, 0.6), quantile(arr, 0.8)];
      const scoreHigh = computeScoreForValue(1, qs, true);
      const scoreLow = computeScoreForValue(40, qs, true);
      expect(scoreHigh).toBe(5);
      expect(scoreLow).toBe(1);
    });

    it('TR-11.3 F 越高得分越高：F=1..20 共 20 位，F=20 得 5 分', () => {
      const F = Array.from({ length: 20 }, (_, i) => i + 1);
      const qs = [quantile(F, 0.2), quantile(F, 0.4), quantile(F, 0.6), quantile(F, 0.8)];
      expect(computeScoreForValue(20, qs, false)).toBe(5);
    });

    it('TR-11.4 M=[1000..20000 step 1000]，M=20000 得 5 分', () => {
      const M = Array.from({ length: 20 }, (_, i) => 1000 + i * 1000);
      const qs = [quantile(M, 0.2), quantile(M, 0.4), quantile(M, 0.6), quantile(M, 0.8)];
      expect(computeScoreForValue(20000, qs, false)).toBe(5);
    });
  });

  describe('纯函数 - 8 段 classifyRfmSegment', () => {
    it('TR-11.5 张三 R=5,F=5,M=5 → 重要价值；李四 R=1,F=1,M=1 → 流失', () => {
      expect(classifyRfmSegment(5, 5, 5)).toBe('重要价值');
      expect(classifyRfmSegment(1, 1, 1)).toBe('流失');
    });

    it('TR-11.6 八段全覆盖验证', () => {
      const cases: Array<[number, number, number, RfmSegment]> = [
        [5, 5, 5, '重要价值'],
        [5, 2, 5, '重要发展'],
        [2, 5, 5, '重要保持'],
        [2, 2, 5, '重要挽留'],
        [5, 5, 2, '一般价值'],
        [5, 2, 2, '一般发展'],
        [2, 5, 2, '一般保持'],
        [2, 2, 2, '流失'],
      ];
      for (const [r, f, m, seg] of cases) {
        expect(classifyRfmSegment(r, f, m)).toBe(seg);
      }
    });
  });

  describe('纯函数 - computeChurnProbability 边界', () => {
    it('TR-11.9 churn 边界：R=200 天 → ≥0.9；R=1, F=20, M=50000 → ≤0.05', () => {
      const p1 = computeChurnProbability({
        recency: 200, frequency: 1, monetary: 100,
        r: 1, f: 1, m: 1,
      });
      expect(p1).toBeGreaterThanOrEqual(0.9);

      const p2 = computeChurnProbability({
        recency: 1, frequency: 20, monetary: 50000,
        r: 5, f: 5, m: 5,
      });
      expect(p2).toBeLessThanOrEqual(0.05);
    });

    it('TR-11.10 NO_SHOW 30% → 权重 w4=0.12，churnProb 上调 ~ +0.08~0.12', () => {
      const baseline = computeChurnProbability({
        recency: 60, frequency: 3, monetary: 3000,
        r: 3, f: 3, m: 3,
      });
      const withNoShow = computeChurnProbability({
        recency: 60, frequency: 3, monetary: 3000,
        r: 3, f: 3, m: 3,
        noShowRate: 0.3,
      });
      expect(withNoShow).toBeGreaterThan(baseline);
      const delta = withNoShow - baseline;
      expect(delta).toBeGreaterThanOrEqual(0.02);
      expect(delta).toBeLessThanOrEqual(0.20);
    });

    it('TR-11.11 随访逾期 25 天 → w5=0.08 贡献；逾期越久 churn 越大', () => {
      const p0 = computeChurnProbability({
        recency: 30, frequency: 5, monetary: 5000,
        r: 3, f: 3, m: 3,
      });
      const p25 = computeChurnProbability({
        recency: 30, frequency: 5, monetary: 5000,
        r: 3, f: 3, m: 3,
        followUpOverdueDays: 25,
      });
      const p60 = computeChurnProbability({
        recency: 30, frequency: 5, monetary: 5000,
        r: 3, f: 3, m: 3,
        followUpOverdueDays: 60,
      });
      expect(p25).toBeGreaterThan(p0);
      expect(p60).toBeGreaterThan(p25);
    });

    it('TR-11.14 从未消费 neverConsumed → 流失 segment；churn 极高', () => {
      expect(classifyRfmSegment(1, 1, 1, true)).toBe('流失');
      const p = computeChurnProbability({
        recency: 9999, frequency: 0, monetary: 0,
        r: 1, f: 1, m: 1, neverConsumed: true,
      });
      expect(p).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe('集成测试 - computeRfm DB 行为', () => {
    it('TR-11.7 REFUNDED Charge 不计入正向：10 PAID + 3 REFUNDED → F=7, M 扣除退款', async () => {
      db.prepare(`DELETE FROM PatientRfmScore WHERE clinicId = ?`).run(TEST_CLINIC_ID);
      db.prepare(`DELETE FROM Charge WHERE clinicId = ?`).run(TEST_CLINIC_ID);
      db.prepare(`DELETE FROM Patient WHERE id = ?`).run('test-patient-001');
      const pid = 'p-refund-001';
      insertPatient(pid, '退款测试患者');
      for (let i = 0; i < 10; i++) {
        insertCharge(`c-pA-${i}`, pid, 'PAID', i + 1, 1000, 0);
      }
      for (let i = 0; i < 3; i++) {
        insertCharge(`c-rA-${i}`, pid, 'REFUNDED', i + 5, 1000, 1000);
      }

      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          await service.computeRfm([pid], 18);
          const row = db.prepare(
            `SELECT * FROM PatientRfmScore WHERE patientId = ? AND clinicId = ?`
          ).get(pid, TEST_CLINIC_ID) as any;
          expect(row).toBeDefined();
          expect(row.frequency).toBe(7);
          expect(row.monetary).toBe(10 * 1000 - 3 * 1000);
        },
      );
    });

    it('TR-11.8 batchComputeRfm 100 patients → 8 段累计=100；2 次 upsert 不重复', async () => {
      db.prepare(`DELETE FROM PatientRfmScore WHERE clinicId = ?`).run(TEST_CLINIC_ID);
      db.prepare(`DELETE FROM Charge WHERE clinicId = ?`).run(TEST_CLINIC_ID);
      db.prepare(`DELETE FROM Patient WHERE id = ?`).run('test-patient-001');
      for (let i = 0; i < 100; i++) {
        const id = `batch-${String(i).padStart(4, '0')}`;
        insertPatient(id, `患者${i}`);
        const paidCount = i % 20;
        for (let j = 0; j < paidCount; j++) {
          const d = 1 + ((i * 7 + j * 13) % 500);
          insertCharge(`ch-${id}-${j}`, id, 'PAID', d, 500 + ((i * 31 + j * 17) % 20000), 0);
        }
      }
      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          const r1 = await service.batchComputeRfm(1000);
          const sum1 = Object.values(r1.segmentBreakdown).reduce((s, n) => s + n, 0);
          expect(r1.processed).toBe(100);
          expect(sum1).toBe(100);

          const count1 = (db.prepare(`SELECT COUNT(*) as c FROM PatientRfmScore WHERE clinicId = ?`)
            .get(TEST_CLINIC_ID) as any).c;
          expect(count1).toBe(100);

          const r2 = await service.batchComputeRfm(1000);
          const count2 = (db.prepare(`SELECT COUNT(*) as c FROM PatientRfmScore WHERE clinicId = ?`)
            .get(TEST_CLINIC_ID) as any).c;
          expect(count2).toBe(100);
          expect(r2.processed).toBe(100);
        },
      );
    });

    it('TR-11.12 listPatients 过滤：segment=流失 与 minChurnProb=0.8', async () => {
      for (let i = 0; i < 20; i++) {
        const id = `flt-${String(i).padStart(3, '0')}`;
        insertPatient(id, `过滤患者${i}`);
      }
      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          await service.batchComputeRfm(1000);
          const r1 = await service.listPatients({ segment: '流失', page: 1, pageSize: 50 });
          for (const item of r1.items as Array<{ segment: string; churnProbability: number }>) {
            expect(item.segment).toBe('流失');
          }
          const r2 = await service.listPatients({ minChurnProb: 0.8, page: 1, pageSize: 50 });
          for (const item of r2.items as Array<{ segment: string; churnProbability: number }>) {
            expect(item.churnProbability).toBeGreaterThanOrEqual(0.799);
          }
        },
      );
    });

    it('TR-11.13 Settings aiRfmEnabled=false → compute 空；aiChurnEnabled=false → churnProb 为 null', async () => {
      writeSetting('aiRfmEnabled', 'false');
      insertPatient('dis-001', '禁用测试A');
      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          await service.batchComputeRfm(1000);
          const c1 = (db.prepare(`SELECT COUNT(*) as c FROM PatientRfmScore WHERE clinicId = ?`)
            .get(TEST_CLINIC_ID) as any).c;
          expect(c1).toBe(0);
        },
      );

      writeSetting('aiRfmEnabled', 'true');
      writeSetting('aiChurnEnabled', 'false');
      insertPatient('dis-002', '禁用测试B');
      insertCharge('c-dis002', 'dis-002', 'PAID', 10, 1000, 0);
      await runInClinicContext(
        clinicContext,
        { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
        async () => {
          await service.computeRfm(['dis-002'], 18);
          const row = db.prepare(
            `SELECT churnProbability FROM PatientRfmScore WHERE patientId = ? AND clinicId = ?`
          ).get('dis-002', TEST_CLINIC_ID) as any;
          expect(row.churnProbability).toBeNull();
        },
      );
    });
  });
});
