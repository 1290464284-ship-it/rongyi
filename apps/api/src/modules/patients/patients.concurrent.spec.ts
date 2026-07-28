import { Test, TestingModule } from '@nestjs/testing';
import { PatientsService } from './patients.service';
import { DbService } from '../../db/db.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { StatsService } from '../system/stats/stats.service';
import { EventBusService } from '../../common/events/event-bus.service';
import { PatientRepository } from './repositories/patient.repository';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  runInClinicContext,
  seedTestData,
} from '../../db/test-helpers';
import {
  runConcurrentTest,
  expectNoDuplicates,
} from '../../common/test-helpers/concurrent-test-utils';
import Database from 'better-sqlite3';
import { Gender, PatientSource } from '@dental/shared';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-concurrent-tests-00000000000000';

describe('PatientsService - 并发测试', () => {
  let module: TestingModule;
  let db: Database.Database;
  let _dbService: DbService;
  let service: PatientsService;
  let clinicContext: ClinicContextService;

  const TEST_CLINIC_ID = 'test-clinic-001';
  const TEST_USER_ID = 'test-user-001';

  beforeAll(async () => {
    db = createTestDb();
    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        { provide: StatsService, useValue: { invalidateStatsCache: jest.fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn(), on: jest.fn(), onAll: jest.fn() } },
        PatientRepository,
        PatientsService,
      ],
    }).compile();

    _dbService = module.get(DbService);
    service = module.get(PatientsService);
    clinicContext = module.get(ClinicContextService);

    seedTestData(db);
  });

  afterAll(async () => {
    await module.close();
    cleanupTestDb(db);
  });

  beforeEach(() => {
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM Patient').run();
    db.pragma('foreign_keys = ON');
  });

  function runInContext<T>(fn: () => T): T {
    return runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' },
      fn,
    );
  }

  function getPatientCount(): number {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM Patient WHERE clinicId = ? AND deletedAt IS NULL'
    ).get(TEST_CLINIC_ID) as { count: number };
    return row.count;
  }

  function getAllPatientCodes(): string[] {
    const rows = db.prepare(
      'SELECT code FROM Patient WHERE clinicId = ? AND deletedAt IS NULL'
    ).all(TEST_CLINIC_ID) as { code: string }[];
    return rows.map((r) => r.code);
  }

  describe('并发创建患者 - 编号生成', () => {
    it('并发创建患者时，所有患者编号不应重复', async () => {
      const concurrentCount = 10;

      const result = await runConcurrentTest(
        concurrentCount,
        async (index) => {
          return runInContext(async () => {
            return service.create({
              name: `并发患者${index}`,
              phone: `138${String(index).padStart(8, '0')}`,
              gender: Gender.MALE,
              source: PatientSource.WALK_IN,
            });
          });
        },
        concurrentCount,
      );

      const patientCount = getPatientCount();
      const codes = getAllPatientCodes();

      expect(result.successCount).toBe(concurrentCount);
      expect(patientCount).toBe(concurrentCount);
      expect(codes.length).toBe(concurrentCount);
      expectNoDuplicates(codes);
    });

    it('并发创建的患者编号应按顺序递增', async () => {
      const concurrentCount = 5;

      await runConcurrentTest(
        concurrentCount,
        async (index) => {
          return runInContext(async () => {
            return service.create({
              name: `顺序患者${index}`,
              phone: `139${String(index).padStart(8, '0')}`,
              gender: Gender.FEMALE,
              source: PatientSource.REFERRAL,
            });
          });
        },
        concurrentCount,
      );

      const codes = getAllPatientCodes().sort((a, b) => a.localeCompare(b));
      expect(codes.length).toBe(concurrentCount);

      for (let i = 0; i < codes.length - 1; i++) {
        const current = parseInt(codes[i].replace('P', ''), 10);
        const next = parseInt(codes[i + 1].replace('P', ''), 10);
        expect(next).toBeGreaterThan(current);
      }
    });

    it('大量并发创建患者时，重试机制应保证编号唯一', async () => {
      const concurrentCount = 20;

      const result = await runConcurrentTest(
        concurrentCount,
        async (index) => {
          return runInContext(async () => {
            return service.create({
              name: `大量并发${index}`,
              phone: `137${String(index).padStart(8, '0')}`,
              gender: Gender.MALE,
            });
          });
        },
        concurrentCount,
      );

      const codes = getAllPatientCodes();
      expect(result.successCount).toBe(concurrentCount);
      expect(codes.length).toBe(concurrentCount);
      expectNoDuplicates(codes);
    });
  });

  describe('并发创建患者 - 指定编号唯一约束', () => {
    it('并发使用相同指定编号创建患者时，只有一个成功，其余失败（指定编号不自动重试）', async () => {
      const sameCode = 'P999999';
      const concurrentCount = 5;

      const result = await runConcurrentTest(
        concurrentCount,
        async (index) => {
          return runInContext(async () => {
            return service.create({
              name: `同编号患者${index}`,
              phone: `138${String(index).padStart(8, '0')}`,
              gender: Gender.MALE,
              code: sameCode,
            });
          });
        },
        concurrentCount,
      );

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(concurrentCount - 1);

      const codes = getAllPatientCodes();
      expect(codes.length).toBe(1);
      expect(codes[0]).toBe(sameCode);
    });
  });

  describe('并发创建患者 - 多诊所场景', () => {
    it('不同诊所创建患者各自成功（v25迁移后 code 改为诊所内唯一）', async () => {
      const clinic1Id = 'clinic-1';
      const clinic2Id = 'clinic-2';

      db.prepare(
        "INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)"
      ).run(clinic1Id, '诊所1', 'CLINIC1', new Date().toISOString(), new Date().toISOString());
      db.prepare(
        "INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)"
      ).run(clinic2Id, '诊所2', 'CLINIC2', new Date().toISOString(), new Date().toISOString());

      const patient1 = await runInClinicContext(
        clinicContext,
        { clinicId: clinic1Id, userId: TEST_USER_ID, role: 'BOSS' },
        async () => {
          return service.create({
            name: '诊所1患者',
            phone: '13510000001',
            gender: Gender.MALE,
          });
        },
      );

      expect(patient1.code).toBeDefined();

      let patient2: any;
      let error: any;
      try {
        patient2 = await runInClinicContext(
          clinicContext,
          { clinicId: clinic2Id, userId: TEST_USER_ID, role: 'BOSS' },
          async () => {
            return service.create({
              name: '诊所2患者',
              phone: '13520000001',
              gender: Gender.FEMALE,
            });
          },
        );
      } catch (e) {
        error = e;
      }

      // v25迁移后 Patient.code 改为 UNIQUE(clinicId, code)，不同诊所的 code 允许重复
      const allCodes = (
        db.prepare(
          'SELECT code, clinicId FROM Patient WHERE deletedAt IS NULL'
        ).all() as { code: string; clinicId: string }[]
      );

      // 验证所有患者都创建成功
      expect(allCodes.length).toBe(2);
      // 验证每个诊所的 code 在该诊所内唯一
      const clinic1Codes = allCodes.filter(r => r.clinicId === clinic1Id).map(r => r.code);
      const clinic2Codes = allCodes.filter(r => r.clinicId === clinic2Id).map(r => r.code);
      expect(new Set(clinic1Codes).size).toBe(clinic1Codes.length);
      expect(new Set(clinic2Codes).size).toBe(clinic2Codes.length);

      if (patient2) {
        // 不同诊所的患者都应成功创建
        expect(patient2.code).toBeDefined();
      } else {
        // 如果创建失败（极低概率），应包含唯一约束错误
        expect(error.message).toMatch(/UNIQUE constraint failed/);
      }
    });
  });
});
