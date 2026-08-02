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
import { SatisfactionService, NEGATIVE_KEYWORDS_SET, POSITIVE_KEYWORDS_SET } from './satisfaction.service';
import { NpsSnapshotTask } from '../../system/daily-scheduler/tasks/nps-snapshot.task';
import {
  TEST_CLINIC_ID,
  TEST_DOCTOR_ID,
  TEST_PATIENT_ID,
} from '../../../../test/factories';
import { SubmitSurveyDto } from './dto/submit-survey.dto';
import { IDatabase } from '../../../db/db.interface';

type DbInstance = InstanceType<typeof Database>;

function wrapDbAsDbService(database: DbInstance): DbService {
  const dbWrapper: IDatabase = {
    prepare: (sql: string) => {
      const stmt = database.prepare(sql);
      return {
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params),
        run: (...params: unknown[]) => stmt.run(...params) as unknown as { changes: number; lastInsertRowid: string | number | bigint },
      };
    },
    exec: (sql: string) => { database.exec(sql); },
    transaction: <T>(fn: (db: IDatabase) => T): T => {
      return database.transaction(() => fn(dbWrapper))() as T;
    },
    pragma: (sql: string, options?: unknown) => database.pragma(sql, options as never),
    name: database.name,
    close: () => {},
    backup: async (_dest: string) => {},
  };
  return dbWrapper as unknown as DbService;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function insertDoctor(db: DbInstance, id: string, name: string): void {
  const now = daysAgo(100);
  db.prepare(
    `INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, clinicId, active, createdAt, updatedAt)
     VALUES (?, ?, 'hash', ?, 'DOCTOR', ?, 1, ?, ?)`
  ).run(id, `doc-${id.slice(-4)}`, name, TEST_CLINIC_ID, now, now);
}

function _insertPatient(db: DbInstance, id: string, name: string): void {
  const now = daysAgo(100);
  db.prepare(
    `INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt)
     VALUES (?, ?, ?, 'MALE', '13800000000', ?, 1, ?, ?)`
  ).run(id, `P${id.slice(-4)}`, name, TEST_CLINIC_ID, now, now);
}

function insertRawSurvey(
  db: DbInstance,
  id: string,
  data: {
    patientId?: string;
    doctorId?: string;
    npsScore: number;
    ratingMedical?: number;
    ratingService?: number;
    ratingEnvironment?: number;
    ratingPrice?: number;
    ratingWait?: number;
    comment?: string;
    tags?: string[];
    createdAtDaysAgo?: number;
    source?: string;
    visitId?: string;
  },
): void {
  const createdAt = daysAgo(data.createdAtDaysAgo ?? 0);
  const tagsJson = data.tags ? JSON.stringify(data.tags) : '[]';
  db.prepare(`
    INSERT INTO SatisfactionSurvey
      (id, visitId, appointmentId, patientId, doctorId, npsScore,
       ratingMedical, ratingService, ratingEnvironment, ratingPrice, ratingWait,
       comment, tags, source, clinicId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.visitId ?? null,
    null,
    data.patientId ?? TEST_PATIENT_ID,
    data.doctorId ?? TEST_DOCTOR_ID,
    data.npsScore,
    data.ratingMedical ?? null,
    data.ratingService ?? null,
    data.ratingEnvironment ?? null,
    data.ratingPrice ?? null,
    data.ratingWait ?? null,
    data.comment ?? null,
    tagsJson,
    data.source ?? 'CLINIC',
    TEST_CLINIC_ID,
    createdAt,
  );
}

function writeSetting(db: DbInstance, cacheService: CacheService, key: string, value: string): void {
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

describe('SatisfactionService', () => {
  let db: DbInstance;
  let dbService: DbService;
  let clinicContext: ClinicContextService;
  let cacheService: CacheService;
  let auditLogService: AuditLogService;
  let settingsService: SettingsService;
  let service: SatisfactionService;

  beforeEach(async () => {
    db = createTestDb();
    // 重建三个核心表（避免 migrate helper 的 UNIQUE/NOT NULL 异常约束 + CHECK 约束）
    db.exec(`DROP TABLE IF EXISTS SatisfactionSurvey`);
    db.exec(`DROP TABLE IF EXISTS NpsSnapshot`);
    db.exec(`DROP TABLE IF EXISTS BusinessAlert`);
    db.exec(`CREATE TABLE IF NOT EXISTS BusinessAlert (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      alertType TEXT NOT NULL CHECK(alertType IN ('REVENUE_DROP','NEW_PATIENTS','NO_SHOW_RATE','AOV','INVENTORY_STOCKOUT','SCHEDULER_TASK_FAILURE','PERFORMANCE_ANOMALY','SATISFACTION_NEGATIVE')),
      severity TEXT NOT NULL CHECK(severity IN ('INFO','WARN','CRITICAL')) DEFAULT 'WARN',
      metricName TEXT NOT NULL,
      currentValue REAL,
      baselineValue REAL,
      deviationPercent REAL,
      message TEXT NOT NULL,
      suggestion TEXT,
      acknowledged INTEGER DEFAULT 0 CHECK(acknowledged IN (0,1)),
      acknowledgedAt TEXT,
      acknowledgedBy TEXT,
      occurredAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT,
      FOREIGN KEY (acknowledgedBy) REFERENCES User(id)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS SatisfactionSurvey (
      id TEXT PRIMARY KEY,
      visitId TEXT UNIQUE,
      appointmentId TEXT,
      patientId TEXT NOT NULL,
      doctorId TEXT,
      npsScore INTEGER NOT NULL CHECK (npsScore BETWEEN 0 AND 10),
      ratingMedical INTEGER CHECK (ratingMedical BETWEEN 1 AND 5),
      ratingService INTEGER CHECK (ratingService BETWEEN 1 AND 5),
      ratingEnvironment INTEGER CHECK (ratingEnvironment BETWEEN 1 AND 5),
      ratingPrice INTEGER CHECK (ratingPrice BETWEEN 1 AND 5),
      ratingWait INTEGER CHECK (ratingWait BETWEEN 1 AND 5),
      comment TEXT,
      tags TEXT DEFAULT '[]',
      source TEXT DEFAULT 'CLINIC' CHECK (source IN ('CLINIC','QR_CODE','SMS_LINK','FOLLOW_UP_CALL')),
      clinicId TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      deletedAt TEXT
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS NpsSnapshot (
      id TEXT PRIMARY KEY,
      clinicId TEXT NOT NULL,
      snapshotDate TEXT NOT NULL,
      totalResponses INTEGER NOT NULL,
      promoters INTEGER NOT NULL,
      detractors INTEGER NOT NULL,
      passives INTEGER NOT NULL,
      nps REAL NOT NULL,
      avgRatingMedical REAL,
      avgRatingService REAL,
      avgRatingEnvironment REAL,
      avgRatingPrice REAL,
      avgRatingWait REAL,
      negativeKeywordCount TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clinicId, snapshotDate)
    )`);
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
    writeSetting(db, cacheService, 'aiSatisfactionEnabled', 'true');
    writeSetting(db, cacheService, 'aiSatisfactionAutoAlertThresholdScore', '6');
    service = new SatisfactionService(dbService, clinicContext, settingsService, auditLogService);
    seedTestData(db);
  });

  afterEach(() => {
    cacheService.onModuleDestroy();
    cleanupTestDb(db);
  });

  function runInClinic(fn: () => unknown) {
    return runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
      fn,
    );
  }

  describe('TR-13.1: NPS 基础计算 20 份 (12P+5Pa+3D)', () => {
    it('TR-13.1 promoters=12, detractors=3, passives=5 → nps=45%', () => {
      const surveys: Array<[string, number]> = [];
      for (let i = 0; i < 12; i++) surveys.push([`s-p-${i}`, 9 + (i % 2)]);   // 9 或 10
      for (let i = 0; i < 5; i++) surveys.push([`s-pa-${i}`, 7 + (i % 2)]);   // 7 或 8
      for (let i = 0; i < 3; i++) surveys.push([`s-d-${i}`, i * 2]);          // 0, 2, 4
      surveys.forEach(([id, score]) => insertRawSurvey(db, id, { npsScore: score }));

      const result = runInClinic(() => service.calcNps()) as ReturnType<typeof service.calcNps>;
      expect(result.totalResponses).toBe(20);
      expect(result.promoters).toBe(12);
      expect(result.detractors).toBe(3);
      expect(result.passives).toBe(5);
      expect(result.nps).toBeCloseTo(((12 - 3) / 20) * 100, 0);
    });
  });

  describe('TR-13.2: NPS 边界判定', () => {
    it('TR-13.2 nps=9→PROMOTER; 8→PASSIVE;7→PASSIVE;6→DETRACTOR;10→PROMOTER;0→DETRACTOR', () => {
      const cases = [
        ['p9', 9, 'promoters'],
        ['p10', 10, 'promoters'],
        ['pa8', 8, 'passives'],
        ['pa7', 7, 'passives'],
        ['d6', 6, 'detractors'],
        ['d0', 0, 'detractors'],
      ];
      for (const [id, score] of cases) insertRawSurvey(db, id as string, { npsScore: score as number });

      const result = runInClinic(() => service.calcNps()) as ReturnType<typeof service.calcNps>;
      expect(result.promoters).toBe(2);
      expect(result.passives).toBe(2);
      expect(result.detractors).toBe(2);
    });
  });

  describe('TR-13.3: ratings 1-5 校验', () => {
    it('TR-13.3 ratingMedical=6 → BusinessValidationException; rating=0 → 异常', async () => {
      const badDto6: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, npsScore: 9, ratingMedical: 6 };
      await expect(
        runInClinic(() => service.submitSurvey(badDto6)) as Promise<unknown>
      ).rejects.toThrow();

      const badDto0: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, npsScore: 9, ratingMedical: 0 };
      await expect(
        runInClinic(() => service.submitSurvey(badDto0)) as Promise<unknown>
      ).rejects.toThrow();
    });
  });

  describe('TR-13.4: comment 关键词匹配', () => {
    it('TR-13.4 comment=医生很专业，环境干净但是等候时间太长有点疼 → tags 含 [专业,干净,等候时间长,疼]', async () => {
      const dto: SubmitSurveyDto = {
        patientId: TEST_PATIENT_ID,
        npsScore: 8,
        comment: '医生很专业，环境干净但是等候时间太长有点疼',
      };
      const result = await (runInClinic(() => service.submitSurvey(dto)) as Promise<{ tags: string[] }>);
      const tags = result.tags;
      expect(tags).toContain('专业');
      expect(tags).toContain('干净');
      expect(tags).toContain('等候时间长');
      expect(tags).toContain('疼');
    });
  });

  describe('TR-13.5: 负面信号 BusinessAlert 生成', () => {
    it('TR-13.5 nps≤6 → SATISFACTION_NEGATIVE WARN 生成; ratingService=1→同样触发;nps=9不生成', async () => {
      const dtoBadNps: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, npsScore: 5 };
      await (runInClinic(() => service.submitSurvey(dtoBadNps)) as Promise<unknown>);
      const countBadNps = db.prepare(
        `SELECT COUNT(*) as c FROM BusinessAlert WHERE alertType = 'SATISFACTION_NEGATIVE' AND severity='WARN' AND clinicId=?`
      ).get(TEST_CLINIC_ID) as { c: number };
      expect(countBadNps.c).toBeGreaterThanOrEqual(1);

      db.exec(`DELETE FROM BusinessAlert WHERE clinicId='${TEST_CLINIC_ID}'`);

      const dtoBadRating: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, npsScore: 8, ratingService: 1 };
      await (runInClinic(() => service.submitSurvey(dtoBadRating)) as Promise<unknown>);
      const countBadRating = db.prepare(
        `SELECT COUNT(*) as c FROM BusinessAlert WHERE alertType = 'SATISFACTION_NEGATIVE' AND clinicId=?`
      ).get(TEST_CLINIC_ID) as { c: number };
      expect(countBadRating.c).toBeGreaterThanOrEqual(1);

      db.exec(`DELETE FROM BusinessAlert WHERE clinicId='${TEST_CLINIC_ID}'`);

      const dtoGood: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, npsScore: 9 };
      await (runInClinic(() => service.submitSurvey(dtoGood)) as Promise<unknown>);
      const countGood = db.prepare(
        `SELECT COUNT(*) as c FROM BusinessAlert WHERE alertType = 'SATISFACTION_NEGATIVE' AND clinicId=?`
      ).get(TEST_CLINIC_ID) as { c: number };
      expect(countGood.c).toBe(0);
    });
  });

  describe('TR-13.6: 负面关键词 top5', () => {
    it('TR-13.6 等候时间长×4、贵×3、态度差×2、疼×2、推销×1 → top5 正确按数量排序', () => {
      const tags: string[][] = [];
      for (let i = 0; i < 4; i++) tags.push(['等候时间长']);
      for (let i = 0; i < 3; i++) tags.push(['贵']);
      for (let i = 0; i < 2; i++) tags.push(['态度差']);
      for (let i = 0; i < 2; i++) tags.push(['疼']);
      tags.push(['推销']);
      tags.forEach((t, i) => insertRawSurvey(db, `s-kw-${i}`, { npsScore: 3, tags: t }));

      const result = runInClinic(() => service.calcNps()) as ReturnType<typeof service.calcNps>;
      const entries = Object.entries(result.negativeKeywordCount);
      expect(entries.length).toBeGreaterThanOrEqual(5);
      expect(entries[0][0]).toBe('等候时间长');
      expect(entries[0][1]).toBe(4);
      expect(entries[1][0]).toBe('贵');
      expect(entries[1][1]).toBe(3);
    });
  });

  describe('TR-13.7: doctorRank', () => {
    it('TR-13.7 doctorX(100份 nps=60)排第1; doctorY(4份)样本<5不排名', () => {
      insertDoctor(db, 'docX', 'X医生');
      insertDoctor(db, 'docY', 'Y医生');
      insertDoctor(db, 'docZ', 'Z医生');
      for (let i = 0; i < 100; i++) {
        // promoters = 80, detractors=20 → (80-20)/100*100 = 60
        const score = i < 80 ? 9 : 2;
        insertRawSurvey(db, `sX-${i}`, { doctorId: 'docX', npsScore: score });
      }
      for (let i = 0; i < 4; i++) {
        insertRawSurvey(db, `sY-${i}`, { doctorId: 'docY', npsScore: 10 });
      }
      for (let i = 0; i < 10; i++) {
        insertRawSurvey(db, `sZ-${i}`, { doctorId: 'docZ', npsScore: 8 });  // passives → nps=0
      }

      const rank = runInClinic(() => service.doctorRank(10)) as ReturnType<typeof service.doctorRank>;
      expect(rank[0].doctorId).toBe('docX');
      expect(rank[0].nps).toBeCloseTo(60, 0);
      const yInRank = rank.find(r => r.doctorId === 'docY');
      expect(yInRank).toBeUndefined();
    });
  });

  describe('TR-13.8: snapshotDaily UPSERT', () => {
    it('TR-13.8 snapshotDaily 2次 → UNIQUE(clinicId, date) UPSERT；行数不增', async () => {
      const today = new Date().toISOString().slice(0, 10);
      insertRawSurvey(db, 's-snap-1', { npsScore: 9 });
      await (runInClinic(() => service.snapshotDaily(today)) as Promise<unknown>);
      const r1 = db.prepare(`SELECT COUNT(*) as c FROM NpsSnapshot WHERE clinicId=? AND snapshotDate=?`)
        .get(TEST_CLINIC_ID, today) as { c: number };
      expect(r1.c).toBe(1);

      await (runInClinic(() => service.snapshotDaily(today)) as Promise<unknown>);
      const r2 = db.prepare(`SELECT COUNT(*) as c FROM NpsSnapshot WHERE clinicId=? AND snapshotDate=?`)
        .get(TEST_CLINIC_ID, today) as { c: number };
      expect(r2.c).toBe(1);
    });
  });

  describe('TR-13.9: trend 缺日补齐', () => {
    it('TR-13.9 trend(7) → 7 天日期升序，缺日补齐', () => {
      const result = runInClinic(() => service.trend(7)) as ReturnType<typeof service.trend>;
      expect(result.length).toBe(7);
      for (let i = 1; i < result.length; i++) {
        expect(new Date(result[i].date).getTime()).toBeGreaterThan(new Date(result[i - 1].date).getTime());
      }
    });
  });

  describe('TR-13.10: dashboard 综合', () => {
    it('TR-13.10 dashboard 返回：nps总+5维平均+好评差评率+TOP3医生+关键词+趋势30天', () => {
      insertDoctor(db, 'doc1', '医生1');
      for (let i = 0; i < 20; i++) insertRawSurvey(db, `sd-${i}`, { doctorId: 'doc1', npsScore: 9, ratingMedical: 5 });
      const dash = runInClinic(() => service.dashboard({ days: 7 })) as ReturnType<typeof service.dashboard>;
      expect(dash.overallNps).toBeDefined();
      expect(typeof dash.goodRate).toBe('number');
      expect(typeof dash.badRate).toBe('number');
      expect(Array.isArray(dash.topDoctors)).toBe(true);
      expect(Array.isArray(dash.topNegativeKeywords)).toBe(true);
      expect(dash.trend30.length).toBe(7);
    });
  });

  describe('TR-13.11: listSurveys 分页', () => {
    it('TR-13.11 list 分页：pageSize=5 → 10条分2页', async () => {
      for (let i = 0; i < 10; i++) {
        insertRawSurvey(db, `pg-${i}`, { npsScore: 8, createdAtDaysAgo: 10 - i });
      }
      const p1 = await (runInClinic(() => service.listSurveys({ pageSize: 5, page: 1 })) as Promise<Awaited<ReturnType<typeof service.listSurveys>>>);
      expect(p1.total).toBe(10);
      expect(p1.items.length).toBe(5);
      const p2 = await (runInClinic(() => service.listSurveys({ pageSize: 5, page: 2 })) as Promise<Awaited<ReturnType<typeof service.listSurveys>>>);
      expect(p2.items.length).toBe(5);
    });
  });

  describe('TR-13.12: UNIQUE visitId', () => {
    it('TR-13.12 同一 visitId 提交 2 次 → 第 2 次抛异常', async () => {
      const vid = 'visit-unique-123';
      const dto1: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, visitId: vid, npsScore: 9 };
      await (runInClinic(() => service.submitSurvey(dto1)) as Promise<unknown>);
      const dto2: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, visitId: vid, npsScore: 8 };
      await expect(
        runInClinic(() => service.submitSurvey(dto2)) as Promise<unknown>
      ).rejects.toThrow();
    });
  });

  describe('TR-13.13: tags 合并去重', () => {
    it('TR-13.13 用户传的tags + 自动匹配的合并去重，JSON数组存', async () => {
      const dto: SubmitSurveyDto = {
        patientId: TEST_PATIENT_ID,
        npsScore: 8,
        comment: '医生很专业，态度好',
        tags: ['专业', '满意', '推荐'],
      };
      const result = await (runInClinic(() => service.submitSurvey(dto)) as Promise<{ id: string; tags: string[] }>);
      const saved = db.prepare(`SELECT tags FROM SatisfactionSurvey WHERE id=?`).get(result.id) as { tags: string };
      const parsed = JSON.parse(saved.tags);
      expect(parsed).toContain('专业');
      expect(parsed.filter((t: string) => t === '专业').length).toBe(1);
      expect(parsed).toContain('满意');
      expect(parsed).toContain('推荐');
    });
  });

  describe('TR-13.14: threshold 可配置', () => {
    it('TR-13.14 threshold调到5 → nps=6 不再触发 alert', async () => {
      runInClinic(() => writeSetting(db, cacheService, 'aiSatisfactionAutoAlertThresholdScore', '5'));
      const dto: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, npsScore: 6 };
      await (runInClinic(() => service.submitSurvey(dto)) as Promise<unknown>);
      const count = db.prepare(
        `SELECT COUNT(*) as c FROM BusinessAlert WHERE alertType='SATISFACTION_NEGATIVE' AND clinicId=?`
      ).get(TEST_CLINIC_ID) as { c: number };
      expect(count.c).toBe(0);
    });
  });

  describe('TR-13.15: 空数据 calcNps', () => {
    it('TR-13.15 无 surveys → promoters/detractors/passives=0，totalResponses=0，nps=0；不除零', () => {
      const result = runInClinic(() => service.calcNps()) as ReturnType<typeof service.calcNps>;
      expect(result.totalResponses).toBe(0);
      expect(result.promoters).toBe(0);
      expect(result.detractors).toBe(0);
      expect(result.passives).toBe(0);
      expect(result.nps).toBe(0);
    });
  });

  describe('TR-13.16: aiSatisfactionEnabled=false', () => {
    it('TR-13.16 aiSatisfactionEnabled=false → submit 返回禁用异常；snapshot 空', async () => {
      runInClinic(() => writeSetting(db, cacheService, 'aiSatisfactionEnabled', 'false'));
      const dto: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, npsScore: 9 };
      await expect(
        runInClinic(() => service.submitSurvey(dto)) as Promise<unknown>
      ).rejects.toThrow();

      const snap = await (runInClinic(() => service.snapshotDaily()) as Promise<{ written: number }>);
      expect(snap.written).toBe(0);
    });
  });

  describe('TR-13.17: source 校验', () => {
    it('TR-13.17 source=QR_CODE有效；UNKNOWN→校验异常', async () => {
      const dtoOk: SubmitSurveyDto = { patientId: TEST_PATIENT_ID, npsScore: 9, source: 'QR_CODE' };
      const res = await (runInClinic(() => service.submitSurvey(dtoOk)) as Promise<{ id: string }>);
      const row = db.prepare(`SELECT source FROM SatisfactionSurvey WHERE id=?`).get(res.id) as { source: string };
      expect(row.source).toBe('QR_CODE');

      const dtoBad: SubmitSurveyDto = {
        patientId: TEST_PATIENT_ID, npsScore: 9, source: 'UNKNOWN' as SubmitSurveyDto['source'],
      };
      await expect(
        runInClinic(() => service.submitSurvey(dtoBad)) as Promise<unknown>
      ).rejects.toThrow();
    });
  });

  describe('TR-13.18: 医生维度过滤', () => {
    it('TR-13.18 doctorId=X，仅返回该医生 surveys；nps calc 相应受限', async () => {
      insertDoctor(db, 'docA', 'A医生');
      insertDoctor(db, 'docB', 'B医生');
      for (let i = 0; i < 5; i++) insertRawSurvey(db, `A-${i}`, { doctorId: 'docA', npsScore: 10 });
      for (let i = 0; i < 5; i++) insertRawSurvey(db, `B-${i}`, { doctorId: 'docB', npsScore: 0 });

      const listA = await (runInClinic(() => service.listSurveys({ doctorId: 'docA' })) as Promise<Awaited<ReturnType<typeof service.listSurveys>>>);
      expect(listA.total).toBe(5);

      const npsA = runInClinic(() => service.calcNps({ doctorId: 'docA' })) as ReturnType<typeof service.calcNps>;
      expect(npsA.nps).toBe(100);

      const npsB = runInClinic(() => service.calcNps({ doctorId: 'docB' })) as ReturnType<typeof service.calcNps>;
      expect(npsB.nps).toBe(-100);
    });
  });

  describe('TR-13.19: 日期区间', () => {
    it('TR-13.19 from=2024-01-01; to=2024-01-31 → 区间内 surveys', async () => {
      const mkDate = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();
      const iso0115 = mkDate(2024, 1, 15);
      const iso0215 = mkDate(2024, 2, 15);
      db.prepare(`INSERT INTO SatisfactionSurvey
        (id, patientId, doctorId, npsScore, tags, source, clinicId, createdAt)
        VALUES (?, ?, ?, ?, '[]', 'CLINIC', ?, ?)`)
        .run('d-jan', TEST_PATIENT_ID, TEST_DOCTOR_ID, 9, TEST_CLINIC_ID, iso0115);
      db.prepare(`INSERT INTO SatisfactionSurvey
        (id, patientId, doctorId, npsScore, tags, source, clinicId, createdAt)
        VALUES (?, ?, ?, ?, '[]', 'CLINIC', ?, ?)`)
        .run('d-feb', TEST_PATIENT_ID, TEST_DOCTOR_ID, 9, TEST_CLINIC_ID, iso0215);

      const r = await (runInClinic(() => service.listSurveys({ from: '2024-01-01', to: '2024-01-31' })) as Promise<Awaited<ReturnType<typeof service.listSurveys>>>);
      expect(r.total).toBe(1);
    });
  });

  describe('TR-13.20: avgRatingMedical 均值', () => {
    it('TR-13.20 avgRatingMedical 5个[5,4,3,2,1] → 均值 3.0', () => {
      const ratings = [5, 4, 3, 2, 1];
      ratings.forEach((r, i) => insertRawSurvey(db, `av-${i}`, { npsScore: 8, ratingMedical: r }));
      const result = runInClinic(() => service.calcNps()) as ReturnType<typeof service.calcNps>;
      expect(result.avgRatingMedical).toBeCloseTo(3.0, 1);
    });
  });

  describe('TR-13.21: 负面评分 nps+rating 组合 alert', () => {
    it('TR-13.21 comment空但 nps=3 且 rating=1 → alert 触发带负面评分 reason', async () => {
      const dto: SubmitSurveyDto = {
        patientId: TEST_PATIENT_ID, npsScore: 3, ratingMedical: 1,
      };
      await (runInClinic(() => service.submitSurvey(dto)) as Promise<unknown>);
      const row = db.prepare(
        `SELECT * FROM BusinessAlert WHERE alertType='SATISFACTION_NEGATIVE' AND clinicId=? ORDER BY createdAt DESC LIMIT 1`
      ).get(TEST_CLINIC_ID) as { message: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.message).toMatch(/nps=3/);
      expect(row!.message).toMatch(/低评分/);
    });
  });

  describe('TR-13.22: Cron 失败 BusinessAlert', () => {
    it('TR-13.22 Cron 失败 → BusinessAlert SCHEDULER_TASK_FAILURE', async () => {
      const badService = {
        snapshotDaily: jest.fn().mockRejectedValue(new Error('模拟 snapshot 失败')),
      } as unknown as SatisfactionService;
      const task = new NpsSnapshotTask(badService, wrapDbAsDbService(db));
      try {
        await runInClinic(() => task.execute(TEST_CLINIC_ID));
      } catch {
        // expected
      }
      const row = db.prepare(
        `SELECT COUNT(*) as c FROM BusinessAlert WHERE alertType='SCHEDULER_TASK_FAILURE' AND clinicId=?`
      ).get(TEST_CLINIC_ID) as { c: number };
      expect(row.c).toBeGreaterThanOrEqual(1);
    });
  });

  describe('纯函数 - 关键词集合定义', () => {
    it('POSITIVE_KEYWORDS_SET ≥ 20; NEGATIVE_KEYWORDS_SET ≥ 20', () => {
      expect(POSITIVE_KEYWORDS_SET.size).toBeGreaterThanOrEqual(20);
      expect(NEGATIVE_KEYWORDS_SET.size).toBeGreaterThanOrEqual(20);
    });
  });
});
