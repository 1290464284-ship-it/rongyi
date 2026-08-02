import { PatientRiskService } from './patient-risk.service';
import { PatientRiskController } from './patient-risk.controller';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { CacheService } from '../../../common/services/cache.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { Gender, PatientSource } from '@dental/shared';
import { scoreToLevel, DEFAULT_RISK_WEIGHTS, RiskWeights } from './risk-factor-weights';
import { AuditLogType } from '../../../common/constants';
import { BusinessValidationException } from '../../../common/errors';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-only-00000000000000000000000000000000';

const TEST_CLINIC_ID = 'test-clinic-001';
const TEST_USER_ID = 'test-user-001';

function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => TEST_CLINIC_ID,
    getUserId: () => TEST_USER_ID,
    getRole: () => 'DOCTOR',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockCache(): CacheService {
  const store = new Map<string, { value: unknown; expire: number }>();
  return {
    get: async <T>(key: string) => {
      const entry = store.get(key);
      if (!entry) return;
      if (entry.expire > 0 && Date.now() > entry.expire) {
        store.delete(key);
        return;
      }
      return entry.value as T;
    },
    set: async <T>(key: string, value: T, ttlMs: number = 0) => {
      store.set(key, { value, expire: ttlMs > 0 ? Date.now() + ttlMs : 0 });
      return true;
    },
    del: async (key: string) => { store.delete(key); return true; },
    delPattern: async (_pattern: string) => { /* noop in mock */ },
  } as unknown as CacheService;
}

function seedPatient(
  db: MockDbService,
  patientId: string,
  overrides: Partial<{
    birthDate?: string;
    tags?: string[];
    medicalHistory?: string[];
    systemicDiseases?: string[];
    fluorideExposure?: number;
    name?: string;
  }> = {},
) {
  const now = new Date().toISOString();
  db.seed('Patient', [{
    id: patientId,
    code: 'P' + patientId.slice(-6),
    name: overrides.name || '测试患者',
    gender: Gender.MALE,
    birthDate: overrides.birthDate ?? null,
    phone: '13800000000',
    clinicId: TEST_CLINIC_ID,
    tags: JSON.stringify(overrides.tags ?? []),
    medicalHistory: JSON.stringify(overrides.medicalHistory ?? []),
    allergies: '[]',
    medicationHistory: '[]',
    systemicDiseases: JSON.stringify(overrides.systemicDiseases ?? []),
    fluorideExposure: overrides.fluorideExposure ?? null,
    source: PatientSource.WALK_IN,
    active: 1,
    createdAt: now,
    updatedAt: now,
  }]);
}

function seedTreatment(
  db: MockDbService,
  data: {
    id?: string;
    patientId: string;
    name: string;
    category?: string;
    teethNumbers?: string[];
    completedDate?: string;
    remark?: string;
    status?: string;
  },
) {
  const now = new Date().toISOString();
  db.seed('Treatment', [{
    id: data.id ?? 'tx-' + Math.random().toString(36).slice(2, 10),
    patientId: data.patientId,
    doctorId: TEST_USER_ID,
    code: 'TX' + Date.now(),
    name: data.name,
    category: data.category ?? 'GENERAL',
    price: 100,
    quantity: 1,
    teethNumbers: JSON.stringify(data.teethNumbers ?? []),
    completedDate: data.completedDate ?? null,
    remark: data.remark ?? null,
    status: data.status ?? 'COMPLETED',
    clinicId: TEST_CLINIC_ID,
    createdAt: now,
    updatedAt: now,
  }]);
}

function seedPeriodontalRecord(
  db: MockDbService,
  data: {
    id?: string;
    patientId: string;
    data?: Record<string, unknown>;
    plaqueIndex?: number;
    boneLoss?: string;
  },
) {
  const now = new Date().toISOString();
  db.seed('PeriodontalRecord', [{
    id: data.id ?? 'pr-' + Math.random().toString(36).slice(2, 10),
    patientId: data.patientId,
    data: JSON.stringify(data.data ?? {}),
    plaqueIndex: data.plaqueIndex ?? null,
    boneLoss: data.boneLoss ?? null,
    clinicId: TEST_CLINIC_ID,
    createdAt: now,
    updatedAt: now,
  }]);
}

function seedFirstExam(
  db: MockDbService,
  data: {
    id: string;
    patientId: string;
    remark?: string;
  },
) {
  const now = new Date().toISOString();
  db.seed('FirstExam', [{
    id: data.id,
    patientId: data.patientId,
    remark: data.remark ?? null,
    status: 'COMPLETED',
    clinicId: TEST_CLINIC_ID,
    createdAt: now,
    updatedAt: now,
  }]);
}

function seedFirstExamTooth(
  db: MockDbService,
  data: {
    examId: string;
    toothNumber: number;
    diseases?: string[];
  },
) {
  db.seed('FirstExamTooth', [{
    id: 'fet-' + Math.random().toString(36).slice(2, 10),
    examId: data.examId,
    toothNumber: data.toothNumber,
    toothStatus: 'DECAYED',
    diseases: JSON.stringify(data.diseases ?? []),
    isChief: 0,
  }]);
}

describe('PatientRiskService & Controller - TR-6 患者风险评分', () => {
  let service: PatientRiskService;
  let controller: PatientRiskController;
  let db: MockDbService;
  let settingsService: SettingsService;

  const now8YearsAgo = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 8);
    return d.toISOString().slice(0, 10);
  };
  const now10YearsAgo = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 10);
    return d.toISOString().slice(0, 10);
  };
  const now66YearsAgo = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 66);
    return d.toISOString().slice(0, 10);
  };
  const now48YearsAgo = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 48);
    return d.toISOString().slice(0, 10);
  };
  const now7YearsAgo = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 7);
    return d.toISOString().slice(0, 10);
  };

  beforeEach(() => {
    db = new MockDbService();
    if (!(db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.has('PatientRiskScore')) {
      (db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.set('PatientRiskScore', new Map());
    }
    if (!(db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.has('AuditLog')) {
      (db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.set('AuditLog', new Map());
    }
    if (!(db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.has('ClinicInfo')) {
      (db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.set('ClinicInfo', new Map());
    }
    if (!(db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.has('PeriodontalRecord')) {
      (db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.set('PeriodontalRecord', new Map());
    }
    if (!(db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.has('FirstExam')) {
      (db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.set('FirstExam', new Map());
    }
    if (!(db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.has('FirstExamTooth')) {
      (db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.set('FirstExamTooth', new Map());
    }

    const auditLogService = new AuditLogService();
    settingsService = new SettingsService(
      asDbService(db),
      createMockCache(),
      createMockClinicContext(),
      auditLogService,
    );
    service = new PatientRiskService(
      asDbService(db),
      createMockClinicContext(),
      settingsService,
    );
    controller = new PatientRiskController(service);
  });

  afterEach(() => {
    db.clear();
  });

  function setupCaseA_HealthyChild() {
    const pid = 'case-a-child';
    seedPatient(db, pid, { birthDate: now8YearsAgo(), name: '健康儿童A', fluorideExposure: 1 });
    return pid;
  }

  function setupCaseB_HighCariesChild() {
    const pid = 'case-b-caries';
    seedPatient(db, pid, {
      birthDate: now10YearsAgo(),
      name: '龋高风险儿童B',
      tags: ['SUGAR_HIGH'],
      medicalHistory: ['FAMILY_CARIES_HISTORY'],
      fluorideExposure: 1,
    });
    seedTreatment(db, { patientId: pid, name: '树脂充填', teethNumbers: ['3','4'], completedDate: now8YearsAgo() });
    const examId = 'exam-b-001';
    seedFirstExam(db, { id: examId, patientId: pid, remark: '患者主诉喜食甜食' });
    seedFirstExamTooth(db, { examId, toothNumber: 1, diseases: ['龋齿'] });
    seedFirstExamTooth(db, { examId, toothNumber: 2, diseases: ['龋齿'] });
    return pid;
  }

  function setupCaseC_SeniorDiabeticSmoker() {
    const pid = 'case-c-senior';
    seedPatient(db, pid, {
      birthDate: now66YearsAgo(),
      name: '糖尿病吸烟老年C',
      tags: ['SMOKER_HEAVY'],
      systemicDiseases: ['DIABETES_TYPE2'],
    });
    seedPeriodontalRecord(db, {
      patientId: pid,
      data: {
        '11': { pd: 7, mobility: 2 },
        '16': { pd: 6, mobility: 1 },
        '26': { pd: 8, mobility: 2 },
        '36': { pd: 6, mobility: 1 },
      },
      plaqueIndex: 4,
      boneLoss: 'SEVERE',
    });
    return pid;
  }

  function setupCaseD_ImplantRisk() {
    const pid = 'case-d-implant';
    seedPatient(db, pid, {
      birthDate: now48YearsAgo(),
      name: '种植体风险D',
      tags: ['SMOKER_LIGHT', 'PERIODONTITIS', 'OCCLUSAL_OVERLOAD'],
      systemicDiseases: ['OSTEOPOROSIS'],
    });
    seedTreatment(db, {
      patientId: pid,
      name: '种植二期修复',
      category: 'IMPLANT',
      teethNumbers: ['26'],
      completedDate: now7YearsAgo(),
    });
    seedPeriodontalRecord(db, {
      patientId: pid,
      data: { '26': { pd: 5, mobility: 1 } },
      plaqueIndex: 3,
      boneLoss: 'MODERATE',
    });
    return pid;
  }

  describe('TR-6.1: 四组典型病例等级命中', () => {
    it('Case A 健康儿童：龋 LOW，牙周 LOW，种植 LOW', async () => {
      const pid = setupCaseA_HealthyChild();
      const result = await service.calculateAndSave(pid);
      expect(result.cariesScore).toBeGreaterThanOrEqual(0);
      expect(result.cariesScore).toBeLessThanOrEqual(29);
      expect(result.cariesLevel).toBe('LOW');
      expect(result.periodontalScore).toBe(0);
      expect(result.periodontalLevel).toBe('LOW');
      expect(result.implantScore).toBe(0);
      expect(result.implantLevel).toBe('LOW');
    });

    it('Case B 龋高风险儿童：龋 HIGH (60-79)', async () => {
      const pid = setupCaseB_HighCariesChild();
      const result = await service.calculateAndSave(pid);
      expect(result.cariesScore).toBeGreaterThanOrEqual(60);
      expect(['HIGH', 'EXTREME']).toContain(result.cariesLevel);
    });

    it('Case C 糖尿病+吸烟65岁老年：牙周 EXTREME (100)', async () => {
      const pid = setupCaseC_SeniorDiabeticSmoker();
      const result = await service.calculateAndSave(pid);
      expect(result.periodontalScore).toBe(100);
      expect(result.periodontalLevel).toBe('EXTREME');
    });

    it('Case D 种植体周炎风险：种植 HIGH', async () => {
      const pid = setupCaseD_ImplantRisk();
      const result = await service.calculateAndSave(pid);
      expect(result.implantScore).toBeGreaterThanOrEqual(60);
      expect(result.implantLevel).toBe('HIGH');
    });
  });

  describe('TR-6.2: 7个边界点等级切换', () => {
    const cases: Array<{ score: number; expected: string; label: string }> = [
      { score: 0, expected: 'LOW', label: '0分→LOW' },
      { score: 29, expected: 'LOW', label: '29分→LOW' },
      { score: 30, expected: 'MEDIUM', label: '30分→MEDIUM' },
      { score: 59, expected: 'MEDIUM', label: '59分→MEDIUM' },
      { score: 60, expected: 'HIGH', label: '60分→HIGH' },
      { score: 79, expected: 'HIGH', label: '79分→HIGH' },
      { score: 80, expected: 'EXTREME', label: '80分→EXTREME' },
    ];
    for (const c of cases) {
      it(c.label, () => {
        expect(scoreToLevel(c.score)).toBe(c.expected);
      });
    }
  });

  describe('TR-6.3: factorSnapshotJson 结构完整', () => {
    it('三项指标 key 存在，caries C1..C7 键都存在缺数据为0', async () => {
      const pid = 'snapshot-empty';
      seedPatient(db, pid, { birthDate: now8YearsAgo() });
      const result = await service.calculateAndSave(pid);
      const snap = result.factorSnapshot;
      expect(snap.caries).toBeDefined();
      expect(snap.periodontal).toBeDefined();
      expect(snap.implant).toBeDefined();
      const cariesKeys = ['C1','C2','C3','C4','C5','C6','C7'] as const;
      for (const k of cariesKeys) {
        expect(Object.prototype.hasOwnProperty.call(snap.caries, k)).toBe(true);
        expect(typeof snap.caries[k]).toBe('number');
        expect(Number.isFinite(snap.caries[k])).toBe(true);
      }
      const periodontalKeys = ['P1','P2','P3','P4','P5','P6','P7'] as const;
      for (const k of periodontalKeys) {
        expect(Object.prototype.hasOwnProperty.call(snap.periodontal, k)).toBe(true);
        expect(typeof snap.periodontal[k]).toBe('number');
        expect(Number.isFinite(snap.periodontal[k])).toBe(true);
        expect(snap.periodontal[k]).toBeGreaterThanOrEqual(0);
      }
      const implantKeys = ['I1','I2','I3','I4','I5','I6','I7','I8'] as const;
      for (const k of implantKeys) {
        expect(Object.prototype.hasOwnProperty.call(snap.implant, k)).toBe(true);
        expect(Number.isFinite(snap.implant[k])).toBe(true);
      }
      expect(snap.dataSources).toBeDefined();
      expect(snap.dataSources.treatmentCount).toBeDefined();
      expect(snap.dataSources.periodontalRecords).toBeDefined();
      expect(snap.dataSources.firstExamRows).toBeDefined();
    });
  });

  describe('TR-6.4: Settings 自定义权重覆盖', () => {
    it('aiRiskCariesPriorRctWeight 5→15：根管=1 分数差异约为 3x（权重变3倍）不触发上限', async () => {
      const pid = 'weight-rct';
      seedPatient(db, pid, { birthDate: '1990-01-01', fluorideExposure: 1 });
      seedTreatment(db, {
        patientId: pid,
        name: '根管治疗单颗',
        teethNumbers: ['1'],
        completedDate: '2024-01-01',
      });
      const wDefault: RiskWeights = structuredClone(DEFAULT_RISK_WEIGHTS);
      const rDefault = await service.calculateAndSave(pid, wDefault);
      const scoreDefault = rDefault.factorSnapshot.caries.C5;

      const wHigh: RiskWeights = structuredClone(DEFAULT_RISK_WEIGHTS);
      wHigh.caries.priorRctWeight = 15;
      const rHigh = await service.calculateAndSave(pid, wHigh);
      const scoreHigh = rHigh.factorSnapshot.caries.C5;

      expect(scoreDefault).toBe(1 * DEFAULT_RISK_WEIGHTS.caries.priorRctWeight);
      expect(scoreDefault).toBe(5);
      expect(scoreHigh).toBe(1 * 15);
      const ratio = scoreHigh / scoreDefault;
      expect(ratio).toBeCloseTo(3.0, 1);
    });

    it('overrideWeights 参数覆盖默认权重通过 Settings 覆盖默认值也生效', async () => {
      const pid = 'weight-settings';
      seedPatient(db, pid, {
        birthDate: '1940-01-01',
        tags: ['SMOKER_HEAVY'],
        systemicDiseases: ['DIABETES_TYPE2'],
      });
      const heavyOverride: RiskWeights = {
        ...structuredClone(DEFAULT_RISK_WEIGHTS),
        periodontal: {
          ...DEFAULT_RISK_WEIGHTS.periodontal,
          smokingHeavy: 50,
          diabetes: 50,
        },
      };
      const resultHigh = await service.calculateAndSave(pid, heavyOverride);
      expect(resultHigh.periodontalScore).toBeGreaterThanOrEqual(60);
    });
  });

  describe('TR-6.5: DB 写快照验证', () => {
    it('调用 calculateAndSave 两次 → DB新增两行，createdAt 升序，最新值正确', async () => {
      const pid = 'db-write-snap';
      seedPatient(db, pid, { birthDate: now8YearsAgo() });
      const r1 = await service.calculateAndSave(pid);
      const r2 = await service.calculateAndSave(pid);
      const rows = db.getTableData('PatientRiskScore') as Array<{ id: string; patientId: string; createdAt: string; cariesScore: number }>;
      expect(rows.length).toBe(2);
      const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      expect(sorted[0].id).toBe(r1.id);
      expect(sorted[1].id).toBe(r2.id);
      expect(r2.cariesScore).toBe(r1.cariesScore);
      expect(r2.id).not.toBe(r1.id);
    });
  });

  describe('TR-6.6: Controller API 调用', () => {
    it('GET /risk-score/:patientId 返回最新快照', async () => {
      const pid = 'ctrl-latest';
      seedPatient(db, pid, { birthDate: '1990-01-01', fluorideExposure: 1 });
      await service.calculateAndSave(pid);
      const result = await controller.getLatest(pid);
      expect(result).not.toBeNull();
      expect(result!.cariesScore).toBeDefined();
      expect(result!.cariesLevel).toBe('LOW');
    });

    it('POST /risk-score/:patientId 强制重算返回新快照', async () => {
      const pid = 'ctrl-recalc';
      seedPatient(db, pid, { birthDate: '1990-01-01', fluorideExposure: 1 });
      const result = await controller.recalculate(pid);
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.cariesLevel).toBe('LOW');
      const rows = db.getTableData('PatientRiskScore') as unknown[];
      expect(rows.length).toBe(1);
    });

    it('GET history/:patientId 历史列表分页', async () => {
      const pid = 'ctrl-hist';
      seedPatient(db, pid, { birthDate: '1990-01-01', fluorideExposure: 1 });
      await service.calculateAndSave(pid);
      await service.calculateAndSave(pid);
      const hist = await controller.getHistory(pid, '1', '10');
      expect(['LOW', 'MEDIUM']).toContain(hist.items[0]?.cariesLevel ?? 'LOW');
      expect(hist.items.length).toBeGreaterThanOrEqual(0);
      expect(hist.page).toBe(1);
      expect(hist.pageSize).toBe(10);
      const rows = db.getTableData('PatientRiskScore') as unknown[];
      expect(rows.length).toBe(2);
    });

    it('GET history 默认分页参数', async () => {
      const pid = 'ctrl-hist-default';
      seedPatient(db, pid, { birthDate: now8YearsAgo() });
      await service.calculateAndSave(pid);
      const hist = await controller.getHistory(pid, undefined, undefined);
      expect(hist.page).toBe(1);
      expect(hist.pageSize).toBe(20);
    });
  });

  describe('TR-6.7: auditLog 写入与患者不存在异常', () => {
    it('auditLog PATIENT_RISK_SCORE_CALCULATED 写入 AuditLog 表', async () => {
      const pid = 'audit-pid';
      seedPatient(db, pid, { birthDate: now8YearsAgo() });
      await service.calculateAndSave(pid, undefined, TEST_USER_ID);
      const logs = db.getTableData('AuditLog') as Array<{ type: string; targetId: string }>;
      const hit = logs.find(l => l.type === AuditLogType.PATIENT_RISK_SCORE_CALCULATED);
      expect(hit).toBeDefined();
      expect(hit!.targetId).toBe(pid);
    });

    it('patientId 不存在抛 BusinessValidationException「患者不存在」', async () => {
      await expect(service.calculateAndSave('non-existent-pid')).rejects.toThrow(BusinessValidationException);
      try {
        await service.calculateAndSave('non-existent-pid-2');
      } catch (e) {
        expect((e as Error).message).toContain('患者不存在');
      }
    });

    it('patientId 空字符串也抛异常', async () => {
      await expect(service.calculateAndSave('')).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('TR-6.8: 空数据患者不崩溃', () => {
    it('无 Treatment/PeriodontalRecord/FirstExam → 牙周和种植 0 分 LOW，龋非 NaN/null', async () => {
      const pid = 'empty-patient';
      seedPatient(db, pid, { birthDate: '1990-01-01', fluorideExposure: 1 });
      const result = await service.calculateAndSave(pid);
      expect(Number.isFinite(result.cariesScore)).toBe(true);
      expect(Number.isFinite(result.periodontalScore)).toBe(true);
      expect(Number.isFinite(result.implantScore)).toBe(true);
      expect(result.cariesScore).toBeGreaterThanOrEqual(0);
      expect(result.periodontalScore).toBe(0);
      expect(result.implantScore).toBe(0);
      expect(result.cariesLevel).toBeDefined();
      expect(result.periodontalLevel).toBe('LOW');
      expect(result.implantLevel).toBe('LOW');
      expect(result.cariesScore).not.toBeNaN();
    });
  });

  describe('附加测试：龋因子细项验证', () => {
    it('C1 DT 计数充填/根管/拔除统计', async () => {
      const pid = 'c1-dt';
      seedPatient(db, pid, { birthDate: '1990-01-01' });
      seedTreatment(db, { patientId: pid, name: '树脂充填', teethNumbers: ['1','2'], completedDate: '2024-01-01' });
      seedTreatment(db, { patientId: pid, name: '根管治疗', teethNumbers: ['3'], completedDate: '2024-01-01' });
      seedTreatment(db, { patientId: pid, name: '拔除', teethNumbers: ['4'], completedDate: '2024-01-01' });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.caries.C1).toBe(4 * DEFAULT_RISK_WEIGHTS.caries.dtWeight);
    });

    it('C2 年龄<12加分 C2正确加分', async () => {
      const pid = 'c2-age';
      seedPatient(db, pid, { birthDate: now8YearsAgo() });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.caries.C2).toBe(DEFAULT_RISK_WEIGHTS.caries.ageUnder12);
    });

    it('C5 既往根管数计数', async () => {
      const pid = 'c5-rct';
      seedPatient(db, pid, { birthDate: '1990-01-01' });
      for (let i = 0; i < 6; i++) {
        seedTreatment(db, { patientId: pid, name: `根管治疗${i}`, teethNumbers: [String(i + 1)], completedDate: '2024-01-01' });
      }
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.caries.C5).toBe(Math.min(20, 6 * DEFAULT_RISK_WEIGHTS.caries.priorRctWeight));
    });

    it('C6 氟暴露不足扣分', async () => {
      const pidNoFluoride = 'c6-no-f';
      seedPatient(db, pidNoFluoride, { birthDate: '1990-01-01' });
      const r1 = await service.calculateAndSave(pidNoFluoride);
      expect(r1.factorSnapshot.caries.C6).toBe(DEFAULT_RISK_WEIGHTS.caries.fluoride);

      const pidWithFluoride = 'c6-yes-f';
      seedPatient(db, pidWithFluoride, { birthDate: '1990-01-01', fluorideExposure: 1 });
      const r2 = await service.calculateAndSave(pidWithFluoride);
      expect(r2.factorSnapshot.caries.C6).toBe(0);
    });

    it('C7 家族史加分', async () => {
      const pid = 'c7-family';
      seedPatient(db, pid, {
        birthDate: '1990-01-01',
        medicalHistory: ['FAMILY_CARIES_HISTORY'],
        tags: ['CARIES_HIGH_RISK'],
      });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.caries.C7).toBe(DEFAULT_RISK_WEIGHTS.caries.family);
    });
  });

  describe('附加测试：牙周因子细项验证', () => {
    it('P1 PD≥6mm牙位计数', async () => {
      const pid = 'p1-pd';
      seedPatient(db, pid, { birthDate: '1950-01-01' });
      seedPeriodontalRecord(db, {
        patientId: pid,
        data: {
          '11': { pd: 6 },
          '12': { pd: 7 },
          '21': { pd: 5 },
          '26': { probeDepth: 8 },
        },
      });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.periodontal.P1).toBe(3 * DEFAULT_RISK_WEIGHTS.periodontal.pdGte6Weight);
    });

    it('P2 骨吸收程度严重/中度/轻度打分', async () => {
      const pidS = 'p2-severe';
      seedPatient(db, pidS, { birthDate: '1950-01-01' });
      seedPeriodontalRecord(db, { patientId: pidS, boneLoss: 'SEVERE' });
      const rS = await service.calculateAndSave(pidS);
      expect(rS.factorSnapshot.periodontal.P2).toBe(DEFAULT_RISK_WEIGHTS.periodontal.boneLossSevere);

      const pidM = 'p2-moderate';
      seedPatient(db, pidM, { birthDate: '1950-01-01' });
      seedPeriodontalRecord(db, { patientId: pidM, boneLoss: 'MODERATE' });
      const rM = await service.calculateAndSave(pidM);
      expect(rM.factorSnapshot.periodontal.P2).toBe(DEFAULT_RISK_WEIGHTS.periodontal.boneLossModerate);
    });

    it('P3 松动度≥2计数', async () => {
      const pid = 'p3-mob';
      seedPatient(db, pid, { birthDate: '1950-01-01' });
      seedPeriodontalRecord(db, {
        patientId: pid,
        data: {
          '11': { mobility: 2 },
          '21': { mobility: 3 },
          '22': { mobility: 1 },
          '31': { mobility: 2 },
        },
      });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.periodontal.P3).toBe(3 * DEFAULT_RISK_WEIGHTS.periodontal.mobility);
    });

    it('P4 吸烟重度/轻度', async () => {
      const pidH = 'p4-heavy';
      seedPatient(db, pidH, { birthDate: '1950-01-01', tags: ['SMOKER_HEAVY'] });
      const rH = await service.calculateAndSave(pidH);
      expect(rH.factorSnapshot.periodontal.P4).toBe(DEFAULT_RISK_WEIGHTS.periodontal.smokingHeavy);

      const pidL = 'p4-light';
      seedPatient(db, pidL, { birthDate: '1950-01-01', tags: ['SMOKER_LIGHT'] });
      const rL = await service.calculateAndSave(pidL);
      expect(rL.factorSnapshot.periodontal.P4).toBe(DEFAULT_RISK_WEIGHTS.periodontal.smokingLight);
    });

    it('P5 糖尿病', async () => {
      const pid = 'p5-diabetes';
      seedPatient(db, pid, {
        birthDate: '1950-01-01',
        systemicDiseases: ['DIABETES_TYPE1'],
      });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.periodontal.P5).toBe(DEFAULT_RISK_WEIGHTS.periodontal.diabetes);
    });

    it('P7 年龄≥60加分', async () => {
      const pid = 'p7-age60+';
      seedPatient(db, pid, { birthDate: now66YearsAgo() });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.periodontal.P7).toBe(DEFAULT_RISK_WEIGHTS.periodontal.ageOver60);
    });
  });

  describe('附加测试：种植因子细项', () => {
    it('I1 有植体+菌斑高', async () => {
      const pid = 'i1-plaque';
      seedPatient(db, pid, { birthDate: '1980-01-01' });
      seedTreatment(db, { patientId: pid, name: '种植体植入', category: 'IMPLANT', completedDate: '2020-01-01' });
      seedPeriodontalRecord(db, { patientId: pid, plaqueIndex: 4 });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.implant.I1).toBe(DEFAULT_RISK_WEIGHTS.implant.plaqueHigh);
    });

    it('I6 植体>5年 加8分 >10年 加15分', async () => {
      const pid5 = 'i6-5year';
      seedPatient(db, pid5, { birthDate: '1980-01-01' });
      seedTreatment(db, {
        patientId: pid5, name: '种植修复', category: 'IMPLANT', completedDate: now7YearsAgo(),
      });
      const r5 = await service.calculateAndSave(pid5);
      expect(r5.factorSnapshot.implant.I6).toBe(DEFAULT_RISK_WEIGHTS.implant.implantAgeOver5);

      const pid10 = 'i6-10year';
      seedPatient(db, pid10, { birthDate: '1980-01-01' });
      const d = new Date(); d.setFullYear(d.getFullYear() - 12);
      seedTreatment(db, {
        patientId: pid10, name: '种植修复', category: 'IMPLANT', completedDate: d.toISOString().slice(0, 10),
      });
      const r10 = await service.calculateAndSave(pid10);
      expect(r10.factorSnapshot.implant.I6).toBe(DEFAULT_RISK_WEIGHTS.implant.implantAgeOver10);
    });

    it('I7 近18个月无洁治→维护不佳加分', async () => {
      const pid = 'i7-poor-maintain';
      seedPatient(db, pid, { birthDate: '1980-01-01' });
      seedTreatment(db, { patientId: pid, name: '种植体植入', category: 'IMPLANT', completedDate: '2020-01-01' });
      const d = new Date(); d.setFullYear(d.getFullYear() - 2);
      seedTreatment(db, { patientId: pid, name: '超声波洁治', completedDate: d.toISOString().slice(0,10) });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.implant.I7).toBe(DEFAULT_RISK_WEIGHTS.implant.poorMaintenance);
    });

    it('I8 全身性疾病（除糖尿病外）', async () => {
      const pid = 'i8-systemic';
      seedPatient(db, pid, {
        birthDate: '1980-01-01',
        systemicDiseases: ['OSTEOPOROSIS', 'DIABETES_TYPE2'],
      });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.implant.I8).toBe(DEFAULT_RISK_WEIGHTS.implant.systemic);
    });
  });

  describe('附加测试：getLatest / getHistory 基础功能', () => {
    it('getLatest 无记录返回 null', async () => {
      const pid = 'getlatest-null';
      seedPatient(db, pid, { birthDate: '1990-01-01' });
      const result = await service.getLatest(pid);
      expect(result).toBeNull();
    });

    it('getHistory 无记录返回空数组 total=0', async () => {
      const pid = 'hist-empty';
      seedPatient(db, pid, { birthDate: '1990-01-01' });
      const hist = await service.getHistory(pid, 1, 10);
      expect(hist.total).toBe(0);
      expect(hist.items.length).toBe(0);
    });

    it('两次计算后 DB 有两行快照，龋分更高那条存在', async () => {
      const pid = 'latest-desc';
      seedPatient(db, pid, { birthDate: '1990-01-01', fluorideExposure: 1 });
      const r1 = await service.calculateAndSave(pid);
      seedTreatment(db, { patientId: pid, name: '充填', teethNumbers: ['1','2','3','4','5'], completedDate: '2024-01-01' });
      const r2 = await service.calculateAndSave(pid);
      expect(r2.cariesScore).toBeGreaterThan(r1.cariesScore);
      const all = db.getTableData('PatientRiskScore') as Array<{ patientId: string; cariesScore: number }>;
      expect(all.length).toBe(2);
      expect(all.filter(r => r.patientId === pid).length).toBe(2);
      const highScore = all.find(r => r.cariesScore === r2.cariesScore);
      expect(highScore).toBeDefined();
    });
  });

  describe('附加：分值上限封顶测试', () => {
    it('龋上限100，各指标 MIN(100, sum)', async () => {
      const pid = 'cap-100';
      seedPatient(db, pid, {
        birthDate: now10YearsAgo(),
        tags: ['SUGAR_HIGH', 'POOR_ORAL_HYGIENE', 'CARIES_HIGH_RISK'],
        medicalHistory: ['FAMILY_CARIES_HISTORY'],
      });
      for (let i = 1; i <= 8; i++) {
        seedTreatment(db, { patientId: pid, name: '充填', teethNumbers: [String(i)], completedDate: '2024-01-01' });
      }
      for (let i = 0; i < 5; i++) {
        seedTreatment(db, { patientId: pid, name: `根管${i}`, teethNumbers: [String(10 + i)], completedDate: '2024-01-01' });
      }
      const result = await service.calculateAndSave(pid);
      expect(result.cariesScore).toBeLessThanOrEqual(100);
      expect(result.cariesScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('附加：FirstExamTooth 龋标记 DT 统计', () => {
    it('FirstExamTooth DECAY 疾病计为龋齿', async () => {
      const pid = 'dt-exam-tooth';
      seedPatient(db, pid, { birthDate: '1990-01-01' });
      const examId = 'exam-dt-1';
      seedFirstExam(db, { id: examId, patientId: pid });
      seedFirstExamTooth(db, { examId, toothNumber: 1, diseases: ['DECAY'] });
      seedFirstExamTooth(db, { examId, toothNumber: 2, diseases: ['DECAYED'] });
      seedFirstExamTooth(db, { examId, toothNumber: 3, diseases: ['龋齿'] });
      seedFirstExamTooth(db, { examId, toothNumber: 55, diseases: ['DECAY'] });
      const result = await service.calculateAndSave(pid);
      expect(result.factorSnapshot.caries.C1).toBe(3 * DEFAULT_RISK_WEIGHTS.caries.dtWeight);
    });
  });
});
