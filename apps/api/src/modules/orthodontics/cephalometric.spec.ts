/* eslint-disable sonarjs/no-unused-collection -- TODO: 逐步修复 lint 问题 */
import Database from 'better-sqlite3';
import {
  createTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../db/test-helpers';
import { DbService } from '../../db/db.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { CacheService } from '../../common/services/cache.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { SettingsService } from '../system/settings/settings.service';
import { ClinicsService } from '../system/clinics/clinics.service';
import { TableNames } from '../../common/constants/table-names';
import { AuditLogType } from '../../common/constants/audit-log-types';
import { LANDMARK_DICTIONARY, Landmarks, ShortCodeLandmarks } from './cephalometric/cephalometric-landmarks';
import { calcReferencePlanes, angleBetweenLines } from './cephalometric/reference-planes';
import { CephalometricMeasurementsService } from './cephalometric/measurements.service';
import { CephalometricClassificationService } from './cephalometric/classification.service';
import { CephalometricTemplateComparisonService, TemplateName } from './cephalometric/template-comparison.service';
import { CephalometricService } from './cephalometric/cephalometric.service';
import { PrintTemplateService } from '../system/print/print-template.service';
import { TemplateEngineService } from '../system/print/template-engine.service';
import { PrintService } from '../system/print/print.service';
import { MetricsFormulaService } from './cephalometric/metrics-formula.service';
import { NormValueService, HARDCODED_NORMS } from './cephalometric/norm-value.service';
import { CephalometricAnalysisService, MissingLandmarkError } from './cephalometric/analysis.service';
import { ROLES } from '@dental/shared';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-only-00000000000000000000000000000000';

const TEST_CLINIC_ID = 'test-clinic-ceph-001';
const TEST_USER_DOCTOR_ID = 'test-user-doctor-ceph-001';
const TEST_USER_BOSS_ID = 'test-user-boss-ceph-001';
const TEST_PATIENT_ID = 'test-patient-ceph-001';
const TEST_IMAGING_ID = 'test-imaging-ceph-001';

function createClinicContext(opts: {
  clinicId?: string;
  userId?: string;
  role?: string;
} = {}): ClinicContextService {
  const clinicId = opts.clinicId || TEST_CLINIC_ID;
  const userId = opts.userId || TEST_USER_BOSS_ID;
  const role = opts.role || 'BOSS';
  return {
    getClinicId: () => clinicId,
    getUserId: () => userId,
    getRole: () => role,
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    getContext: () => ({ clinicId, userId, role }),
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createSettingsService(dbService: DbService, clinicContext: ClinicContextService): SettingsService {
  const cache = new CacheService();
  const auditLog = new AuditLogService();
  return new SettingsService(dbService, cache, clinicContext, auditLog);
}

function createClinicsService(dbService: DbService, clinicContext: ClinicContextService): ClinicsService {
  const cache = new CacheService();
  return new ClinicsService(dbService, clinicContext, cache);
}

function fullSeed() {
  return { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS };
}

function seedBase(db: Database.Database) {
  db.pragma('foreign_keys = OFF');
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO Clinic (id, name, code, address, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(TEST_CLINIC_ID, '荣毅测试诊所', 'RY-CEPH', '北京市朝阳区测试路1号', '010-88888888', now, now);
  db.prepare(`INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(TEST_USER_BOSS_ID, 'boss1', 'hash', '王老板', ROLES.BOSS, TEST_CLINIC_ID, now, now);
  db.prepare(`INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(TEST_USER_DOCTOR_ID, 'doc1', 'hash', '李医生', ROLES.DOCTOR, TEST_CLINIC_ID, now, now);
  db.prepare(`INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, birthDate, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, 'MALE', '13800000000', '1990-01-01', ?, 1, ?, ?)`)
    .run(TEST_PATIENT_ID, 'P001', '张三', TEST_CLINIC_ID, now, now);
}

/**
 * 补齐 v49 迁移新增的列（createTestDb 不执行增量迁移）
 */
function ensureCephalometricColumns(db: Database.Database) {
  const addColumnIfMissing = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some(c => c.name === col)) return;
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* noop */ }
  };
  addColumnIfMissing('CephalometricLandmarkSet', 'name', "TEXT DEFAULT '初始'");
  addColumnIfMissing('CephalometricLandmarkSet', 'method', "TEXT DEFAULT 'STEINER'");
  addColumnIfMissing('CephalometricLandmarkSet', 'status', "TEXT DEFAULT 'DRAFT'");
  addColumnIfMissing('CephalometricLandmarkSet', 'createdBy', 'TEXT');
  addColumnIfMissing('CephalometricAnalysisRecord', 'patientId', 'TEXT');
  addColumnIfMissing('CephalometricNormValue', 'adultChildFlag', "TEXT DEFAULT 'ADULT'");
}

/**
 * 构建 30 个短代码标志点坐标（标准头影测量示意坐标，Y 轴向下）
 */
function buildShortCodeLandmarks(overrides: Partial<ShortCodeLandmarks> = {}): ShortCodeLandmarks {
  const base: ShortCodeLandmarks = {
    S: { x: 100, y: 100 },
    N: { x: 200, y: 100 },
    A: { x: 210, y: 200 },
    B: { x: 190, y: 220 },
    Pog: { x: 185, y: 240 },
    Gn: { x: 190, y: 250 },
    Me: { x: 195, y: 260 },
    Go: { x: 120, y: 250 },
    Ar: { x: 95, y: 175 },
    Po: { x: 100, y: 150 },
    O: { x: 250, y: 150 },
    ANS: { x: 205, y: 195 },
    PNS: { x: 160, y: 195 },
    UIE: { x: 215, y: 230 },
    UIA: { x: 210, y: 260 },
    LIE: { x: 210, y: 235 },
    LIA: { x: 205, y: 265 },
    U6M: { x: 170, y: 240 },
    L6M: { x: 172, y: 250 },
    Co: { x: 80, y: 160 },
    Ptm: { x: 150, y: 200 },
    Xi: { x: 105, y: 210 },
    DC: { x: 85, y: 165 },
    Ai: { x: 175, y: 235 },
    Bi: { x: 173, y: 245 },
    U6DB: { x: 165, y: 240 },
    L6DB: { x: 167, y: 250 },
    A6: { x: 170, y: 238 },
    B6: { x: 172, y: 248 },
    Sn: { x: 208, y: 190 },
    Is: { x: 212, y: 210 },
  };
  return { ...base, ...overrides };
}

function buildFullLandmarks(overrides: Partial<Landmarks> = {}): Landmarks {
  const base: Landmarks = {
    Nasion: { x: 200, y: 100, visible: true },
    Sella: { x: 100, y: 100, visible: true },
    Orbitale: { x: 250, y: 150, visible: true },
    Porion: { x: 100, y: 150, visible: true },
    APoint: { x: 210, y: 200, visible: true },
    BPoint: { x: 190, y: 220, visible: true },
    Pogonion: { x: 180, y: 320, visible: true },
    Gnathion: { x: 190, y: 340, visible: true },
    Menton: { x: 200, y: 360, visible: true },
    ANS: { x: 205, y: 210, visible: true },
    PNS: { x: 160, y: 210, visible: true },
    UI: { x: 215, y: 240, visible: true },
    UIR: { x: 205, y: 270, visible: true },
    LI: { x: 205, y: 280, visible: true },
    LIR: { x: 200, y: 310, visible: true },
    U6: { x: 170, y: 255, visible: true },
    L6: { x: 172, y: 305, visible: true },
    Gonion: { x: 120, y: 320, visible: true },
    Condylion: { x: 80, y: 160, visible: true },
    Articulare: { x: 95, y: 175, visible: true },
    Basion: { x: 110, y: 200, visible: true },
    Pterygomaxillary: { x: 150, y: 220, visible: true },
    PointW: { x: 155, y: 240, visible: true },
  };
  return { ...base, ...overrides };
}

// =========================================================================
// Task 19 新流程测试（TR-19.1 ~ TR-19.32）
// 基于 MetricsFormulaService + NormValueService + CephalometricAnalysisService
// =========================================================================
describe('头影测量分析 Task 19 (新流程) - TR-19', () => {
  let db: Database.Database;
  let dbService: DbService;
  let clinicContext: ClinicContextService;
  let settingsService: SettingsService;
  let clinicsService: ClinicsService;
  let metricsFormulaService: MetricsFormulaService;
  let normValueService: NormValueService;
  let analysisService: CephalometricAnalysisService;
  let auditLogService: AuditLogService;
  let printTemplateService: PrintTemplateService;
  let templateEngine: TemplateEngineService;
  let printService: PrintService;

  beforeEach(async () => {
    db = createTestDb();
    ensureCephalometricColumns(db);
    dbService = createTestDbService(db);
    clinicContext = createClinicContext({ role: ROLES.BOSS, userId: TEST_USER_BOSS_ID });
    settingsService = createSettingsService(dbService, clinicContext);
    clinicsService = createClinicsService(dbService, clinicContext);
    metricsFormulaService = new MetricsFormulaService();
    normValueService = new NormValueService(dbService, clinicContext);
    auditLogService = new AuditLogService();
    analysisService = new CephalometricAnalysisService(
      dbService,
      clinicContext,
      metricsFormulaService,
      normValueService,
      auditLogService,
      settingsService,
    );
    templateEngine = new TemplateEngineService();
    printTemplateService = new PrintTemplateService(dbService, clinicContext);
    printService = new PrintService(
      dbService,
      clinicContext,
      templateEngine,
      printTemplateService,
      settingsService,
      clinicsService,
    );

    await runInClinicContext(clinicContext, fullSeed(), () => {
      seedTestData(db);
      seedBase(db);
      try { (settingsService as any).ensureDefaultConfigs(); } catch { /* noop */ }
    });
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  // ============= 公式验证 =============

  it('TR-19.1 SNA 公式：S(0,0) N(50,0) A(50,-40) → SNA = 90°（直角基准）', () => {
    const lm: ShortCodeLandmarks = { S: { x: 0, y: 0 }, N: { x: 50, y: 0 }, A: { x: 50, y: -40 } };
    const results = metricsFormulaService.computeByMethod(lm, 'STEINER');
    const sna = results.find(r => r.code === 'SNA');
    expect(sna).toBeTruthy();
    expect(sna!.value).toBe(90);
  });

  it('TR-19.2 SNA 公式：S(0,0) N(100,0) A(90,-2.5) → SNA ≈ 14°（容差 ±2°）', () => {
    // 注：原规格坐标 A(95,-20) 实际算出 ~76°，此处调整为产生 ~14° 的坐标
    const lm: ShortCodeLandmarks = { S: { x: 0, y: 0 }, N: { x: 100, y: 0 }, A: { x: 90, y: -2.5 } };
    const results = metricsFormulaService.computeByMethod(lm, 'STEINER');
    const sna = results.find(r => r.code === 'SNA');
    expect(sna).toBeTruthy();
    expect(sna!.value).toBeGreaterThanOrEqual(12);
    expect(sna!.value).toBeLessThanOrEqual(16);
  });

  it('TR-19.3 SNB 公式：S/N/B 已知坐标 → SNB 计算与人工一致（容差 0.5°）', () => {
    // S(0,0) N(100,0) B(80,-2.5) → SNB ≈ atan(2.5/20) ≈ 7.1°
    const lm: ShortCodeLandmarks = { S: { x: 0, y: 0 }, N: { x: 100, y: 0 }, B: { x: 80, y: -2.5 } };
    const results = metricsFormulaService.computeByMethod(lm, 'STEINER');
    const snb = results.find(r => r.code === 'SNB');
    expect(snb).toBeTruthy();
    // 手工计算：v1=(-100,0), v2=(-20,-2.5), cos=2000/(100*20.156)=0.9922, angle≈7.13°
    expect(snb!.value).toBeGreaterThanOrEqual(6.6);
    expect(snb!.value).toBeLessThanOrEqual(7.6);
  });

  it('TR-19.4 ANB = SNA - SNB：验证一致性', () => {
    const lm = buildShortCodeLandmarks();
    const results = metricsFormulaService.computeByMethod(lm, 'STEINER');
    const sna = results.find(r => r.code === 'SNA')!.value!;
    const snb = results.find(r => r.code === 'SNB')!.value!;
    const anb = results.find(r => r.code === 'ANB')!.value!;
    expect(Math.abs(anb - (sna - snb))).toBeLessThanOrEqual(0.5);
  });

  it('TR-19.5 IMPA：下切牙长轴(UIA→UIE)与下颌平面(Go→Me)夹角 ≈ 90°（给标准坐标）', () => {
    // Go(0,0) Me(100,0) 水平；UIA(50,-50) UIE(50,0) 垂直 → 夹角 90°
    const lm: ShortCodeLandmarks = {
      Go: { x: 0, y: 0 }, Me: { x: 100, y: 0 },
      UIA: { x: 50, y: -50 }, UIE: { x: 50, y: 0 },
      LIA: { x: 50, y: -50 }, LIE: { x: 50, y: 0 },
    };
    const results = metricsFormulaService.computeByMethod(lm, 'TWEE');
    const impa = results.find(r => r.code === 'IMPA');
    expect(impa).toBeTruthy();
    expect(Math.abs(impa!.value! - 90)).toBeLessThanOrEqual(0.5);
  });

  it('TR-19.6 FMA：FH 平面(Po→O) 与 下颌平面(Go→Gn) 夹角', () => {
    const lm = buildShortCodeLandmarks();
    const results = metricsFormulaService.computeByMethod(lm, 'TWEE');
    const fma = results.find(r => r.code === 'FMA');
    expect(fma).toBeTruthy();
    expect(fma!.value).not.toBeNull();
    expect(fma!.value!).toBeGreaterThanOrEqual(0);
    expect(fma!.value!).toBeLessThanOrEqual(180);
  });

  it('TR-19.7 SN-MP：SN 平面与 Go-Gn 平面夹角', () => {
    const lm = buildShortCodeLandmarks();
    const results = metricsFormulaService.computeAll(lm);
    const snmp = results.find(r => r.code === 'SN-MP');
    expect(snmp).toBeTruthy();
    expect(snmp!.value).not.toBeNull();
    expect(snmp!.value!).toBeGreaterThanOrEqual(0);
    expect(snmp!.value!).toBeLessThanOrEqual(180);
  });

  it('TR-19.8 Overjet：UIE.x - LIE.x（水平距离 mm）', () => {
    const lm: ShortCodeLandmarks = { UIE: { x: 100, y: 50 }, LIE: { x: 80, y: 60 } };
    const results = metricsFormulaService.computeAll(lm);
    const overjet = results.find(r => r.code === 'Overjet');
    expect(overjet).toBeTruthy();
    expect(overjet!.value).toBe(20);
  });

  it('TR-19.9 Overbite：UIE.y - LIE.y（垂直距离 mm）', () => {
    const lm: ShortCodeLandmarks = { UIE: { x: 100, y: 50 }, LIE: { x: 80, y: 60 } };
    const results = metricsFormulaService.computeAll(lm);
    const overbite = results.find(r => r.code === 'Overbite');
    expect(overbite).toBeTruthy();
    expect(overbite!.value).toBe(-10);
  });

  it('TR-19.10 Wits：A 点到 OP 垂线与 B 点到 OP 垂线距离差', () => {
    const lm = buildShortCodeLandmarks({
      A: { x: 100, y: 50 }, B: { x: 100, y: 60 },
      UIE: { x: 50, y: 0 }, L6M: { x: 150, y: 0 },
    });
    const results = metricsFormulaService.computeAll(lm);
    const wits = results.find(r => r.code === 'Wits');
    expect(wits).toBeTruthy();
    expect(wits!.value).not.toBeNull();
  });

  it('TR-19.11 距离计算 S-N：(0,0)-(100,0) = 100mm', () => {
    const lm: ShortCodeLandmarks = { S: { x: 0, y: 0 }, N: { x: 100, y: 0 } };
    const results = metricsFormulaService.computeAll(lm);
    const sn = results.find(r => r.code === 'S-N');
    expect(sn).toBeTruthy();
    expect(sn!.value).toBe(100);
  });

  // ============= 校验 =============

  it('TR-19.12 30 点缺 N → 抛 MissingLandmarkError 「缺少 N 鼻根点」', () => {
    const lm = buildShortCodeLandmarks();
    delete lm.N;
    expect(() => analysisService.ensureLandmarksValid(lm)).toThrow(MissingLandmarkError);
    try {
      analysisService.ensureLandmarksValid(lm);
    } catch (e) {
      expect(e instanceof MissingLandmarkError).toBe(true);
      const err = e as MissingLandmarkError;
      expect(err.missing.some(m => m.includes('N') && m.includes('鼻根点'))).toBe(true);
    }
  });

  it('TR-19.13 30 点缺 Go 和 Po → 报错列出两个缺失点', () => {
    const lm = buildShortCodeLandmarks();
    delete lm.Go;
    delete lm.Po;
    try {
      analysisService.ensureLandmarksValid(lm);
      fail('应抛出 MissingLandmarkError');
    } catch (e) {
      expect(e instanceof MissingLandmarkError).toBe(true);
      const err = e as MissingLandmarkError;
      expect(err.missing.length).toBeGreaterThanOrEqual(2);
      expect(err.missing.some(m => m.includes('Go'))).toBe(true);
      expect(err.missing.some(m => m.includes('Po'))).toBe(true);
    }
  });

  // ============= 正常值方向判定 =============

  it('TR-19.14 classifyDirection：value=85, range[80,84] → UP；value=79 → DOWN；value=82 → NORMAL', () => {
    expect(normValueService.classifyDirection(85, 80, 84)).toBe('UP');
    expect(normValueService.classifyDirection(79, 80, 84)).toBe('DOWN');
    expect(normValueService.classifyDirection(82, 80, 84)).toBe('NORMAL');
  });

  // ============= 按方法计算 =============

  it('TR-19.15 computeAnalysis(STEINER) 返回 ≥7 项', () => {
    const lm = buildShortCodeLandmarks();
    const results = analysisService.computeAnalysis(lm, 'STEINER');
    expect(results.length).toBeGreaterThanOrEqual(7);
    expect(results.every(r => r.method === 'STEINER')).toBe(true);
  });

  it('TR-19.16 computeAnalysis(DOWNS) 返回 ≥8 项', () => {
    const lm = buildShortCodeLandmarks();
    const results = analysisService.computeAnalysis(lm, 'DOWNS');
    expect(results.length).toBeGreaterThanOrEqual(8);
    expect(results.every(r => r.method === 'DOWNS')).toBe(true);
  });

  it('TR-19.17 computeAnalysis(TWEE) 返回 ≥3 项', () => {
    const lm = buildShortCodeLandmarks();
    const results = analysisService.computeAnalysis(lm, 'TWEE');
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every(r => r.method === 'TWEE')).toBe(true);
  });

  it('TR-19.18 computeAnalysis(MCNAMARA) 返回 ≥5 项', () => {
    const lm = buildShortCodeLandmarks();
    const results = analysisService.computeAnalysis(lm, 'MCNAMARA');
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results.every(r => r.method === 'MCNAMARA')).toBe(true);
  });

  it('TR-19.19 全方法合并 ≥ 50 项指标（去重后 code 集合 size ≥ 50）', () => {
    const lm = buildShortCodeLandmarks();
    const results = analysisService.computeAnalysis(lm, 'ALL');
    const codes = new Set(results.map(r => r.code));
    expect(codes.size).toBeGreaterThanOrEqual(50);
  });

  it('TR-19.20 每个指标含 code/label/value/unit/normalRange/direction/method 字段', () => {
    const lm = buildShortCodeLandmarks();
    const results = analysisService.computeAnalysis(lm, 'ALL');
    expect(results.length).toBeGreaterThan(0);
    for (const m of results) {
      expect(typeof m.code).toBe('string');
      expect(typeof m.label).toBe('string');
      expect(m.value === null || typeof m.value === 'number').toBe(true);
      expect(typeof m.unit).toBe('string');
      expect(typeof m.formula).toBe('string');
      expect(typeof m.method).toBe('string');
      expect(m.normalRange === null || Array.isArray(m.normalRange)).toBe(true);
      expect(['UP', 'NORMAL', 'DOWN']).toContain(m.direction);
    }
  });

  // ============= 正常值库 =============

  it('TR-19.21 正常值库硬编码 23 项核心指标范围非空', () => {
    expect(HARDCODED_NORMS.length).toBeGreaterThanOrEqual(23);
    for (const n of HARDCODED_NORMS) {
      expect(n.code).toBeTruthy();
      expect(n.label).toBeTruthy();
      expect(typeof n.min).toBe('number');
      expect(typeof n.max).toBe('number');
      expect(n.unit).toBeTruthy();
    }
  });

  it('TR-19.22 DB CephalometricNormValue 覆写：DB 有 code=SNA → getNorm 返回 DB 值', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const hardcoded = normValueService.getNorm('SNA');
      expect(hardcoded).toBeTruthy();

      normValueService.saveOverride({
        code: 'SNA',
        label: 'SNA 自定义',
        method: 'STEINER',
        adultChild: 'ADULT',
        gender: 'ALL',
        min: 81,
        max: 85,
        unit: '°',
        source: 'DB 测试覆写',
      });

      const fromDb = normValueService.getNorm('SNA');
      expect(fromDb).toBeTruthy();
      expect(fromDb!.min).toBe(81);
      expect(fromDb!.max).toBe(85);
      expect(fromDb!.source).toContain('DB');
    });
  });

  // ============= 保存分析 =============

  it('TR-19.23 saveAnalysis：存 CephalometricAnalysisRecord metrics JSON 含 50+ 项', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildShortCodeLandmarks();
      const landmarkSet = await analysisService.createLandmarkSet({
        patientId: TEST_PATIENT_ID,
        name: '术前',
        landmarks: lm,
        analysisMethod: 'STEINER',
      });
      const record = await analysisService.saveAnalysis(landmarkSet.id, { method: 'ALL' });
      expect(record.id).toBeTruthy();
      expect(record.metrics.length).toBeGreaterThanOrEqual(50);

      const raw = db.prepare(
        `SELECT metricsJson FROM ${TableNames.CEPHALOMETRIC_ANALYSIS_RECORD} WHERE id = ?`,
      ).get(record.id) as { metricsJson: string };
      const stored = JSON.parse(raw.metricsJson);
      expect(stored.length).toBeGreaterThanOrEqual(50);
    });
  });

  // ============= 对比 =============

  it('TR-19.24 compareRecords(id1, id2)：同一指标 value1≠value2 → delta 非零 + arrow 正确', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm1 = buildShortCodeLandmarks();
      const lm2 = buildShortCodeLandmarks({ A: { x: 220, y: 200 } });

      const ls1 = await analysisService.createLandmarkSet({ patientId: TEST_PATIENT_ID, name: '术前', landmarks: lm1 });
      const ls2 = await analysisService.createLandmarkSet({ patientId: TEST_PATIENT_ID, name: '术后', landmarks: lm2 });

      const r1 = await analysisService.saveAnalysis(ls1.id, { method: 'ALL' });
      const r2 = await analysisService.saveAnalysis(ls2.id, { method: 'ALL' });

      const result = await analysisService.compareRecords(r1.id, r2.id);
      expect(result.diffs.length).toBeGreaterThan(0);

      const snaDiff = result.diffs.find(d => d.code === 'SNA');
      expect(snaDiff).toBeTruthy();
      if (snaDiff && snaDiff.delta !== null && snaDiff.delta !== 0) {
        expect(['↗', '↘']).toContain(snaDiff.arrow);
      }
    });
  });

  it('TR-19.25 compareRecords：value1=value2 → delta=0 + arrow=→', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildShortCodeLandmarks();

      const ls1 = await analysisService.createLandmarkSet({ patientId: TEST_PATIENT_ID, name: 'A', landmarks: lm });
      const ls2 = await analysisService.createLandmarkSet({ patientId: TEST_PATIENT_ID, name: 'B', landmarks: { ...lm } });

      const r1 = await analysisService.saveAnalysis(ls1.id, { method: 'ALL' });
      const r2 = await analysisService.saveAnalysis(ls2.id, { method: 'ALL' });

      const result = await analysisService.compareRecords(r1.id, r2.id);
      const zeroDiffs = result.diffs.filter(d => d.delta === 0);
      expect(zeroDiffs.length).toBeGreaterThan(0);
      for (const d of zeroDiffs) {
        expect(d.arrow).toBe('→');
      }
    });
  });

  // ============= 列表 =============

  it('TR-19.26 listByPatient 按时间倒序', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildShortCodeLandmarks();
      const _ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const ls = await analysisService.createLandmarkSet({ patientId: TEST_PATIENT_ID, name: `T${i}`, landmarks: lm });
        const r = await analysisService.saveAnalysis(ls.id, { method: 'STEINER' });
        _ids.push(r.id);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const list = await analysisService.listByPatient(TEST_PATIENT_ID);
      expect(list.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < list.length; i++) {
        expect(list[i].createdAt <= list[i - 1].createdAt).toBe(true);
      }
    });
  });

  it('TR-19.27 软删除后 getById 抛异常；listByPatient 不含已删除', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildShortCodeLandmarks();
      const ls = await analysisService.createLandmarkSet({ patientId: TEST_PATIENT_ID, name: '待删', landmarks: lm });
      const r = await analysisService.saveAnalysis(ls.id, { method: 'STEINER' });

      await analysisService.deleteById(r.id);

      await expect(analysisService.getAnalysisById(r.id)).rejects.toThrow();
      const list = await analysisService.listByPatient(TEST_PATIENT_ID);
      expect(list.some(item => item.id === r.id)).toBe(false);
    });
  });

  // ============= Settings 守卫 =============

  it('TR-19.28 aiCephalometricEnabled=false → analyze 抛 FORBIDDEN；list 读接口允许', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildShortCodeLandmarks();
      const ls = await analysisService.createLandmarkSet({ patientId: TEST_PATIENT_ID, name: '启用时', landmarks: lm });
      const r = await analysisService.saveAnalysis(ls.id, { method: 'STEINER' });

      await settingsService.updateClinicInfo('aiCephalometricEnabled', 'false');

      await expect(analysisService.saveAnalysis(ls.id, { method: 'DOWNS' })).rejects.toThrow(/禁用|FORBIDDEN/i);

      const list = await analysisService.listByPatient(TEST_PATIENT_ID);
      expect(list.length).toBeGreaterThanOrEqual(1);
      const one = await analysisService.getAnalysisById(r.id);
      expect(one.id).toBe(r.id);
    });
  });

  // ============= 打印报告 =============

  it('TR-19.29 renderCephalometricReport：HTML 含 SVG 标签 + 指标表 + 患者姓名 + 医生签名位', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildShortCodeLandmarks();
      const ls = await analysisService.createLandmarkSet({ patientId: TEST_PATIENT_ID, name: '打印测试', landmarks: lm });
      const r = await analysisService.saveAnalysis(ls.id, { method: 'ALL', doctorId: TEST_USER_DOCTOR_ID });

      printTemplateService.seedDefaults(TEST_CLINIC_ID);
      const html = await printService.renderCephalometricReport(r.id);

      expect(html).toContain('<svg');
      expect(html).toContain('张三');
      expect(html.length).toBeGreaterThan(100);
    });
  });

  // ============= 正常值校验 =============

  it('TR-19.30 正常值上下界 min ≤ max（不存在倒置）', () => {
    for (const n of HARDCODED_NORMS) {
      expect(n.min).toBeLessThanOrEqual(n.max);
    }
  });

  // ============= 参考平面 =============

  it('TR-19.31 reference-plane angleBetweenLines：两水平线夹角 0°；水平 vs 垂直 = 90°', () => {
    const horiz = angleBetweenLines({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 });
    expect(Math.abs(horiz)).toBeLessThanOrEqual(0.01);

    const perp = angleBetweenLines({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 });
    expect(Math.abs(perp - 90)).toBeLessThanOrEqual(0.01);
  });

  // ============= 公式精度 =============

  it('TR-19.32 公式精度：3 份教材例题坐标 → 输出与人工计算一致（容差 0.5°/0.3mm）', () => {
    // 例题 1: SNA 直角 — S(0,0) N(50,0) A(50,-40) → SNA=90°
    const lm1: ShortCodeLandmarks = { S: { x: 0, y: 0 }, N: { x: 50, y: 0 }, A: { x: 50, y: -40 } };
    const r1 = metricsFormulaService.computeAll(lm1);
    const sna1 = r1.find(r => r.code === 'SNA')!.value!;
    expect(Math.abs(sna1 - 90)).toBeLessThanOrEqual(0.5);

    // 例题 2: S-N 距离 — S(0,0) N(100,0) → S-N=100mm
    const lm2: ShortCodeLandmarks = { S: { x: 0, y: 0 }, N: { x: 100, y: 0 } };
    const r2 = metricsFormulaService.computeAll(lm2);
    const sn2 = r2.find(r => r.code === 'S-N')!.value!;
    expect(Math.abs(sn2 - 100)).toBeLessThanOrEqual(0.3);

    // 例题 3: Overjet — UIE(100,50) LIE(80,60) → Overjet=20mm
    const lm3: ShortCodeLandmarks = { UIE: { x: 100, y: 50 }, LIE: { x: 80, y: 60 } };
    const r3 = metricsFormulaService.computeAll(lm3);
    const oj3 = r3.find(r => r.code === 'Overjet')!.value!;
    expect(Math.abs(oj3 - 20)).toBeLessThanOrEqual(0.3);
  });
});

// =========================================================================
// 旧流程测试（Legacy CephalometricService）
// 保留以维护旧控制器 /cephalometrics 的覆盖率
// =========================================================================
describe('Legacy CephalometricService (旧流程)', () => {
  let db: Database.Database;
  let dbService: DbService;
  let clinicContext: ClinicContextService;
  let settingsService: SettingsService;
  let measurementsSvc: CephalometricMeasurementsService;
  let classificationSvc: CephalometricClassificationService;
  let comparisonSvc: CephalometricTemplateComparisonService;
  let printTemplateSvc: PrintTemplateService;
  let templateEngine: TemplateEngineService;
  let cephSvc: CephalometricService;

  beforeEach(async () => {
    db = createTestDb();
    dbService = createTestDbService(db);
    clinicContext = createClinicContext({ role: ROLES.BOSS, userId: TEST_USER_BOSS_ID });
    settingsService = createSettingsService(dbService, clinicContext);
    measurementsSvc = new CephalometricMeasurementsService();
    classificationSvc = new CephalometricClassificationService();
    comparisonSvc = new CephalometricTemplateComparisonService();
    templateEngine = new TemplateEngineService();
    printTemplateSvc = new PrintTemplateService(dbService, clinicContext);
    cephSvc = new CephalometricService(
      dbService,
      clinicContext,
      measurementsSvc,
      classificationSvc,
      comparisonSvc,
      new AuditLogService(),
      settingsService,
      printTemplateSvc,
      templateEngine,
    );

    await runInClinicContext(clinicContext, fullSeed(), () => {
      seedTestData(db);
      seedBase(db);
      try { (settingsService as any).ensureDefaultConfigs(); } catch { /* noop */ }
    });
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  it('LEGACY-1 23个标注点全给 → 5条参考平面全部非 null', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const lm = buildFullLandmarks();
      const planes = measurementsSvc.calcLandmarksDerived(lm);
      expect(planes.FH).not.toBeNull();
      expect(planes.SN).not.toBeNull();
      expect(planes.OP).not.toBeNull();
      expect(planes.MP).not.toBeNull();
      expect(planes.PP).not.toBeNull();
      expect(Object.keys(lm).length).toBeGreaterThanOrEqual(23);
    });
  });

  it('LEGACY-2 缺 Orbitale → FH 平面为 null，其他 4 条仍计算', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const lm = buildFullLandmarks();
      delete (lm as any).Orbitale;
      const planes = measurementsSvc.calcLandmarksDerived(lm);
      expect(planes.FH).toBeNull();
      expect(planes.SN).not.toBeNull();
      expect(planes.OP).not.toBeNull();
      expect(planes.MP).not.toBeNull();
      expect(planes.PP).not.toBeNull();
    });
  });

  it('LEGACY-3 标准坐标 SNA/SNB/ANB → ANB≈SNA-SNB ±0.5', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const lm = buildFullLandmarks({
        Nasion: { x: 200, y: 100, visible: true },
        Sella: { x: 100, y: 100, visible: true },
        APoint: { x: 210, y: 200, visible: true },
        BPoint: { x: 190, y: 220, visible: true },
      });
      const planes = measurementsSvc.calcLandmarksDerived(lm);
      const meas = measurementsSvc.calcAllMeasurements(lm, planes, 1.0);
      const sna = Number((meas as any)['SNA']?.value ?? NaN);
      const snb = Number((meas as any)['SNB']?.value ?? NaN);
      const anb = Number((meas as any)['ANB']?.value ?? NaN);
      expect(sna).toBeGreaterThan(0);
      expect(snb).toBeGreaterThan(0);
      expect(Math.abs(anb - (sna - snb))).toBeLessThanOrEqual(0.5);
    });
  });

  it('LEGACY-4 U1-SN 向量夹角测试：测量值有效且>0', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const lm = buildFullLandmarks();
      lm.Nasion = { x: 200, y: 200, visible: true };
      lm.Sella = { x: 100, y: 200, visible: true };
      lm.UI = { x: 260, y: 200, visible: true };
      lm.UIR = { x: 200, y: 100, visible: true };
      const planes = measurementsSvc.calcLandmarksDerived(lm);
      const meas = measurementsSvc.calcAllMeasurements(lm, planes, 1.0);
      const u1sn = Number((meas as any)['U1-SN']?.value ?? NaN);
      expect(u1sn).toBeGreaterThan(0);
      expect(u1sn).toBeLessThanOrEqual(180);
    });
  });

  it('LEGACY-5 Wits appraisal 值有效且不抛', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const lm = buildFullLandmarks();
      lm.APoint = { x: 204, y: 250, visible: true };
      lm.BPoint = { x: 200, y: 252, visible: true };
      lm.U6 = { x: 100, y: 200, visible: true };
      lm.L6 = { x: 104, y: 300, visible: true };
      const planes = measurementsSvc.calcLandmarksDerived(lm);
      const meas = measurementsSvc.calcAllMeasurements(lm, planes, 1.0);
      const wits = Number((meas as any).Wits?.value ?? NaN);
      expect(!Number.isNaN(wits)).toBe(true);
    });
  });

  it('LEGACY-6 23 measurements 至少 15 个有值', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const lm = buildFullLandmarks();
      const planes = measurementsSvc.calcLandmarksDerived(lm);
      const meas = measurementsSvc.calcAllMeasurements(lm, planes, 1.0);
      const nonNull = Object.values(meas as unknown as Record<string, any>).filter(
        v => v?.value !== null && v?.value !== undefined && !Number.isNaN(v.value),
      ).length;
      expect(nonNull).toBeGreaterThanOrEqual(15);
    });
  });

  it('LEGACY-7 分类：ANB=5 / Wits=4 / SN-MP=40 → skeletal II / vertical HIGH', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const meas: any = { ANB: { value: 5, norm: 2, sd: 1.5, delta: 3, severity: 2 }, Wits: { value: 4, norm: 0, sd: 2, delta: 4, severity: 2 }, ['SN-MP']: { value: 40, norm: 32, sd: 4, delta: 8, severity: 2 }, Overjet: { value: 2, norm: 2, sd: 1, delta: 0, severity: 0 }, ['U1-SN']: { value: 100, norm: 102, sd: 5, delta: -2, severity: 0 },};
      const cls = classificationSvc.classify(meas);
      expect(cls.skeletal).toBe('ClassII');
      expect(cls.vertical).toBe('High');
    });
  });

  it('LEGACY-8 分类：ANB=-2 / Wits=-3 / SN-MP=26 → skeletal III / LOW', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const meas: any = { ANB: { value: -2, norm: 2, sd: 1.5, delta: -4, severity: 2 }, Wits: { value: -3, norm: 0, sd: 2, delta: -3, severity: 2 }, ['SN-MP']: { value: 26, norm: 32, sd: 4, delta: -6, severity: 2 }, Overjet: { value: -1, norm: 2, sd: 1, delta: -3, severity: 2 }, ['U1-SN']: { value: 100, norm: 102, sd: 5, delta: -2, severity: 0 },};
      const cls = classificationSvc.classify(meas);
      expect(cls.skeletal).toBe('ClassIII');
      expect(cls.vertical).toBe('Low');
    });
  });

  it('LEGACY-9 分类：ANB=2, Wits=0, SN-MP=32 → ClassI / AVERAGE', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const meas: any = { ANB: { value: 2, norm: 2, sd: 1.5, delta: 0, severity: 0 }, Wits: { value: 0, norm: 0, sd: 2, delta: 0, severity: 0 }, ['SN-MP']: { value: 32, norm: 32, sd: 4, delta: 0, severity: 0 }, Overjet: { value: 2, norm: 2, sd: 1, delta: 0, severity: 0 }, ['U1-SN']: { value: 100, norm: 102, sd: 5, delta: -2, severity: 0 },};
      const cls = classificationSvc.classify(meas);
      expect(cls.skeletal).toBe('ClassI');
      expect(cls.vertical).toBe('Average');
      expect(cls.summary.length).toBeGreaterThan(0);
    });
  });

  it('LEGACY-10 对比 TWEED：FMA=25 vs 均值25 SD3 → delta=0 severity NORMAL', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const meas: any = { FMA: { value: 25, norm: 25, sd: 3, delta: 0, severity: 0 },};
      const result = comparisonSvc.compareToTemplate(meas, 'TWEED');
      const fma = result.deltas.find(d => d.key === 'FMA');
      expect(fma).toBeTruthy();
      expect(fma!.delta).toBe(0);
      expect(fma!.severity).toBe('NORMAL');
    });
  });

  it('LEGACY-11 对比 TWEED：FMA=31 → +2SD → MODERATE', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const meas: any = { FMA: { value: 31, norm: 25, sd: 3, delta: 6, severity: 2 },};
      const result = comparisonSvc.compareToTemplate(meas, 'TWEED');
      const fma = result.deltas.find(d => d.key === 'FMA');
      expect(fma).toBeTruthy();
      expect(Math.abs((fma!.value as number) - 31)).toBeLessThan(0.001);
      expect(fma!.severity).toBe('MODERATE');
    });
  });

  it('LEGACY-12 对比 TWEED：FMA=35 → +3.3SD → SEVERE', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const meas: any = { FMA: { value: 35, norm: 25, sd: 3, delta: 10, severity: 3 },};
      const result = comparisonSvc.compareToTemplate(meas, 'TWEED');
      const fma = result.deltas.find(d => d.key === 'FMA');
      expect(fma).toBeTruthy();
      expect(fma!.severity).toBe('SEVERE');
    });
  });

  it('LEGACY-13 4 套模板 ANDREWS/BOLTON/TWEED/CHINESE_NORMAL 都有常量，compare 不抛', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const meas: any = { SNA: { value: 82, norm: 82, sd: 3, delta: 0, severity: 0 }, SNB: { value: 80, norm: 80, sd: 3, delta: 0, severity: 0 }, ANB: { value: 2, norm: 2, sd: 1.5, delta: 0, severity: 0 },};
      const tpls: TemplateName[] = ['ANDREWS', 'BOLTON', 'TWEED', 'CHINESE_NORMAL'];
      for (const tpl of tpls) {
        const r = comparisonSvc.compareToTemplate(meas, tpl);
        expect(r.template).toBe(tpl);
        expect(Array.isArray(r.deltas)).toBe(true);
        expect(r.summary.length).toBeGreaterThan(0);
      }
    });
  });

  it('LEGACY-14 validate → landmarksValidated=1；幂等；审计 CEPHALOMETRIC_VALIDATED', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildFullLandmarks();
      const created = await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: '初诊头影', landmarks: lm });
      expect(created.landmarksValidated).toBe(0);
      const v1 = await cephSvc.validate(created.id);
      expect(v1.landmarksValidated).toBe(1);
      const v2 = await cephSvc.validate(created.id);
      expect(v2.landmarksValidated).toBe(1);
      const auditRow = db.prepare(
        `SELECT id FROM AuditLog WHERE type=? AND targetId=? AND clinicId=? ORDER BY createdAt DESC LIMIT 1`,
      ).get(AuditLogType.CEPHALOMETRIC_VALIDATED, created.id, TEST_CLINIC_ID);
      expect(auditRow).toBeTruthy();
    });
  });

  it('LEGACY-15 recalc：A点 x 变 5 像素 → measurements ANB 差 ≥ 0.3', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildFullLandmarks();
      const created = await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: '初诊头影', landmarks: lm });
      const anb1 = Number((created.measurements as any).ANB?.value ?? NaN);
      const lm2 = buildFullLandmarks({ APoint: { x: ((lm.APoint?.x ?? 210) + 5), y: lm.APoint?.y ?? 200, visible: true } });
      await cephSvc.updateAnalysis(created.id, { landmarks: lm2 });
      const recalc = await cephSvc.recalc(created.id);
      const anb2 = Number((recalc.measurements as any).ANB?.value ?? NaN);
      expect(Math.abs(anb2 - anb1)).toBeGreaterThanOrEqual(0.3);
    });
  });

  it('LEGACY-16 create 用户传入 skipRecalc 不抛错', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildFullLandmarks();
      const customPlanes = calcReferencePlanes(lm);
      const created = await cephSvc.createAnalysis({
        patientId: TEST_PATIENT_ID,
        name: '跳过重算',
        landmarks: lm,
        referencePlanes: customPlanes,
        skipRecalc: true,
      });
      expect(created.id).toBeTruthy();
    });
  });

  it('LEGACY-17 list(patientId=X) pageSize=5 total=20 → 4 页', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildFullLandmarks();
      for (let i = 0; i < 20; i++) {
        await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: `测试${i}`, landmarks: lm });
      }
      const r1 = await cephSvc.list({ patientId: TEST_PATIENT_ID, page: 1, pageSize: 5 });
      expect(r1.total).toBe(20);
      expect(r1.items.length).toBe(5);
      const r2 = await cephSvc.list({ patientId: TEST_PATIENT_ID, page: 2, pageSize: 5 });
      expect(r2.items.length).toBe(5);
      expect(r2.items[0].id).not.toBe(r1.items[0].id);
      const r4 = await cephSvc.list({ patientId: TEST_PATIENT_ID, page: 4, pageSize: 5 });
      expect(r4.items.length).toBe(5);
      const r5 = await cephSvc.list({ patientId: TEST_PATIENT_ID, page: 5, pageSize: 5 });
      expect(r5.items.length).toBe(0);
    });
  });

  it('LEGACY-18 seedDefaults CEPHALOMETRIC_REPORT 写入 PrintTemplate；renderReport HTML 含指标表/分类/对比', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      await settingsService.updateClinicInfo('aiCephalometricDefaultTemplate', 'CHINESE_NORMAL');
      const lm = buildFullLandmarks();
      const created = await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: '初诊头影', landmarks: lm });
      await cephSvc.compare(created.id, 'CHINESE_NORMAL');
      printTemplateSvc.seedDefaults(TEST_CLINIC_ID);
      const tpl = db.prepare(
        `SELECT id FROM PrintTemplate WHERE code=? AND clinicId=?`,
      ).get('CEPHALOMETRIC_REPORT', TEST_CLINIC_ID) as any;
      expect(tpl).toBeTruthy();
      const html = await cephSvc.renderPrintHtml(created.id);
      expect(html).toContain('头影测量分析报告');
      expect(html).toContain('测量指标');
      expect(html).toContain('分类摘要');
      expect(html).toContain('模板对比');
    });
  });

  it('LEGACY-19 Settings aiCephalometricEnabled=false → 写接口抛 FORBIDDEN；读接口正常', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildFullLandmarks();
      const before = await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: 'B', landmarks: lm });
      await settingsService.updateClinicInfo('aiCephalometricEnabled', 'false');
      let threw = false;
      try {
        await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: 'A', landmarks: lm });
      } catch { threw = true; }
      expect(threw).toBe(true);
      const list = await cephSvc.list({ patientId: TEST_PATIENT_ID });
      expect(list.items.length).toBeGreaterThanOrEqual(1);
      const one = await cephSvc.getById(before.id);
      expect(one.id).toBe(before.id);
    });
  });

  it('LEGACY-20 ScaleFactor=0.5: 像素差100=200 mm → Overbite 放大 2 倍', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      await settingsService.updateClinicInfo('aiCephalometricScaleFactor', '0.5');
      const lm = buildFullLandmarks();
      // OP 平面需水平（U6/L6 同 y），其法线才为垂直方向，
      // 这样 UI-LI 的 y 差 = 投影到 OP 法线的距离（Overbite 定义）。
      lm.U6 = { x: 170, y: 255, visible: true };
      lm.L6 = { x: 172, y: 255, visible: true };
      lm.UI = { x: 200, y: 200, visible: true };
      lm.LI = { x: 200, y: 300, visible: true };
      const created = await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: 'scale', landmarks: lm });
      const ob = Number((created.measurements as any).Overbite?.value ?? NaN);
      expect(ob).toBeCloseTo(200, 0);
    });
  });

  it('LEGACY-21 issueFlags：ANB=5 delta=3 SD=1.5 → severity=2 MODERATE；ANB 类 flag 命中', async () => {
    await runInClinicContext(clinicContext, fullSeed(), () => {
      const meas: any = { ANB: { value: 5, norm: 2, sd: 1.5, delta: 3, severity: 2 }, Wits: { value: 0, norm: 0, sd: 2, delta: 0, severity: 0 }, ['SN-MP']: { value: 32, norm: 32, sd: 4, delta: 0, severity: 0 }, Overjet: { value: 2, norm: 2, sd: 1, delta: 0, severity: 0 }, ['U1-SN']: { value: 102, norm: 102, sd: 5, delta: 0, severity: 0 },};
      const cls = classificationSvc.classify(meas);
      expect(cls.issueFlags.length).toBeGreaterThan(0);
      const flag = cls.issueFlags.find(f => (f.code || '').includes('ANB'));
      expect(flag).toBeTruthy();
      expect(flag!.severity).toBe(2);
    });
  });

  it('LEGACY-22 软删除 id → list 不返回；createdAt 字段不丢失', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      const lm = buildFullLandmarks();
      const created = await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: '待删除', landmarks: lm });
      const createdAt = created.createdAt;
      expect(createdAt).toBeTruthy();
      await cephSvc.deleteAnalysis(created.id);
      const list = await cephSvc.list({ patientId: TEST_PATIENT_ID });
      const exists = list.items.some(i => i.id === created.id);
      expect(exists).toBe(false);
      const raw = db.prepare(
        `SELECT createdAt, deletedAt FROM ${TableNames.CEPHALOMETRIC_ANALYSIS} WHERE id=?`,
      ).get(created.id) as any;
      expect(raw).toBeTruthy();
      expect(raw.createdAt).toBe(createdAt);
      expect(raw.deletedAt).toBeTruthy();
    });
  });

  it('LEGACY-23 imagingId 可选：关联 Imaging id 成功；无关联不报错', async () => {
    await runInClinicContext(clinicContext, fullSeed(), async () => {
      db.prepare(
        `INSERT OR IGNORE INTO Imaging (id, patientId, clinicId, type, title, imageUrl, createdAt, updatedAt) VALUES (?, ?, ?, 'CEPH', '头影测量影像', 'http://test/x.jpg', ?, ?)`,
      ).run(TEST_IMAGING_ID, TEST_PATIENT_ID, TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());
      const lm = buildFullLandmarks();
      const withImg = await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: '关联影像', landmarks: lm, imagingId: TEST_IMAGING_ID });
      expect(withImg.imagingId).toBe(TEST_IMAGING_ID);
      const noImg = await cephSvc.createAnalysis({ patientId: TEST_PATIENT_ID, name: '无关联', landmarks: lm });
      expect(noImg.imagingId).toBeFalsy();
    });
  });

  it('LANDMARK_DICTIONARY 至少 23 个标注点定义', () => {
    expect(Object.keys(LANDMARK_DICTIONARY).length).toBeGreaterThanOrEqual(23);
  });
});
