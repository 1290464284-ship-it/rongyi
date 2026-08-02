/* eslint-disable unicorn/no-useless-template-literals -- TODO: 逐步修复 lint 问题 */
import { MedicalSummaryService } from './medical-summary.service';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';

function createMockClinicContext(clinicId: string = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockSettingsService(overrides: Record<string, string> = {}): SettingsService {
  const defaults: Record<string, string> = {
    aiMedicalSummaryEnabled: 'true',
    ...overrides,
  };
  return {
    get: async (key: string) => defaults[key],
    getBoolean: async (key: string, def = false) => {
      const v = defaults[key];
      if (v == undefined) return def;
      return v === 'true' || v === '1' || v === 'yes';
    },
    getClinicInfo: async () => ({ ...defaults }),
  } as unknown as SettingsService;
}

describe('MedicalSummaryService', () => {
  let service: MedicalSummaryService;
  let db: MockDbService;
  let settings: SettingsService;

  beforeEach(() => {
    db = new MockDbService();
    settings = createMockSettingsService();
    service = new MedicalSummaryService(
      asDbService(db),
      createMockClinicContext(),
      settings,
    );
  });

  afterEach(() => {
    db.clear();
  });

  describe('generateSummary - 摘要拼接算法', () => {
    it('TR-3.1: 26 慢性根尖周炎 + 根管治疗 → 摘要含 26 + 根管 + 2周', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '牙痛', diagnosis: '26慢性根尖周炎', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '26根管治疗充填', category: 'ROOT_CANAL', teethNumbers: ['26'] },
        ],
      });
      expect(result.summary).toContain('26');
      expect(result.summary).toContain('根管');
      expect(result.summary).toContain('2 周');
    });

    it('TR-3.1: 38 水平阻生 + 拔除术 → 摘要含 拔除 + 3月后修复', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '智齿痛', diagnosis: '38水平阻生', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '38拔除术', category: 'EXTRACTION', teethNumbers: ['38'] },
        ],
      });
      expect(result.summary).toContain('拔除');
      expect(result.summary).toContain('3 月');
    });

    it('TR-3.1: 全口洁治 + 抛光 → 摘要含 洁治 + 6月', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '洗牙', diagnosis: '牙结石', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '全口洁治+抛光', category: 'SCALING', teethNumbers: [] },
        ],
      });
      expect(result.summary).toContain('洁治');
      expect(result.summary).toContain('6 月');
    });

    it('TR-3.1: 16,26 中龋 + 树脂充填 → 摘要含 16,26 + 充填', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '蛀牙', diagnosis: '16中龋，26中龋', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '16树脂充填', category: 'FILLING', teethNumbers: ['16'] },
          { name: '26树脂充填', category: 'FILLING', teethNumbers: ['26'] },
        ],
      });
      expect(result.summary).toContain('16');
      expect(result.summary).toContain('26');
      expect(result.summary).toContain('充填');
    });

    it('TR-3.1: 空病例（无诊断无治疗）→ 摘要含 一般检查（兜底 T0）', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '', diagnosis: '', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [],
      });
      expect(result.summary).toContain('一般检查');
      expect(result.summary).toContain('半年复查');
    });

    it('TR-3.2: 长度 ≤ 100 字，超 100 截断加 …', () => {
      const manyTreatments = Array.from({ length: 10 }, (_, i) => ({
        name: `${11 + i}根管治疗充填`,
        category: 'ROOT_CANAL',
        teethNumbers: [`${11 + i}`],
      }));
      const result = service.generateSummary({
        visit: { chiefComplaint: '多颗牙痛', diagnosis: '多颗慢性根尖周炎', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: manyTreatments,
      });
      expect(result.summary.length).toBeLessThanOrEqual(100);
      expect(result.summary.endsWith('…')).toBe(true);
    });

    it('TR-3.5: 多个治疗（根管 + 洁牙）→ 取 14 天最小间隔', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '牙痛+洗牙', diagnosis: '26慢性根尖周炎', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '26根管治疗充填', category: 'ROOT_CANAL', teethNumbers: ['26'] },
          { name: '全口洁治', category: 'SCALING', teethNumbers: [] },
        ],
      });
      const expected = new Date('2026-07-01T09:00:00.000Z');
      expected.setDate(expected.getDate() + 14);
      expect(result.nextReminder).toBe(expected.toISOString().slice(0, 10));
    });

    it('T5 冠修复匹配：全瓷冠 + 牙位', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '戴牙冠', diagnosis: '16牙体缺损', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '16全瓷冠粘接', category: 'CROWN', teethNumbers: ['16'] },
        ],
      });
      expect(result.summary).toContain('16');
      expect(result.summary).toContain('全瓷');
      expect(result.summary).toContain('1 周');
    });

    it('T6 种植匹配：一期植入', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '种牙', diagnosis: '26缺失', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '26种植一期植入', category: 'IMPLANT', teethNumbers: ['26'] },
        ],
      });
      expect(result.summary).toContain('26');
      expect(result.summary).toContain('种植');
      expect(result.summary).toContain('一期植入');
    });

    it('T7 正畸匹配：弓丝更换', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '正畸复诊', diagnosis: '正畸治疗中', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '正畸弓丝更换', category: 'ORTHO', teethNumbers: [] },
        ],
      });
      expect(result.summary).toContain('正畸');
      expect(result.summary).toContain('弓丝更换');
    });

    it('T8 乳牙充填匹配', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '儿童补牙', diagnosis: '54乳牙中龋', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '54乳牙充填', category: 'PEDIATRIC', teethNumbers: ['54'] },
        ],
      });
      expect(result.summary).toContain('54');
      expect(result.summary).toContain('乳牙');
      expect(result.summary).toContain('充填');
    });

    it('T10 复查/随访匹配', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '复查', diagnosis: '', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '定期复查', category: 'CHECKUP', teethNumbers: [] },
        ],
      });
      expect(result.summary).toContain('复查');
      expect(result.summary).toContain('半年后复诊');
    });

    it('T11 根尖切除小手术匹配', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '手术', diagnosis: '26根尖囊肿', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '26根尖切除术', category: 'SURGERY', teethNumbers: ['26'] },
        ],
      });
      expect(result.summary).toContain('26');
      expect(result.summary).toContain('根尖切除');
      expect(result.summary).toContain('1 周');
    });

    it('T12 牙外伤固定匹配', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '外伤', diagnosis: '11牙外伤', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '11外伤固定', category: 'TRAUMA', teethNumbers: ['11'] },
        ],
      });
      expect(result.summary).toContain('11');
      expect(result.summary).toContain('外伤');
      expect(result.summary).toContain('固定');
    });

    it('T13 干髓匹配', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '补牙', diagnosis: '36牙髓炎', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '36干髓术', category: 'OTHER', teethNumbers: ['36'] },
        ],
      });
      expect(result.summary).toContain('36');
      expect(result.summary).toContain('干髓');
    });

    it('诊断关键词兜底：龋 → T4 充填', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '蛀牙', diagnosis: '深龋', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [],
        medicalRecord: { teethInvolved: ['26'] },
      });
      expect(result.summary).toContain('充填');
      expect(result.summary).toContain('深');
    });

    it('诊断关键词兜底：根尖周/牙髓 → T1 根管', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '牙痛', diagnosis: '慢性根尖周炎', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [],
        medicalRecord: { teethInvolved: ['26'] },
      });
      expect(result.summary).toContain('根管');
    });

    it('牙位缺失时写「患牙」替代数字', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '牙痛', diagnosis: '牙髓炎', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '根管治疗充填', category: 'ROOT_CANAL', teethNumbers: [] },
        ],
      });
      expect(result.summary).toContain('患牙');
    });

    it('多条命中按牙位去重合并', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '多颗牙', diagnosis: '中龋', startTime: '2026-07-01T09:00:00.000Z' },
        treatments: [
          { name: '16树脂充填', category: 'FILLING', teethNumbers: ['16'] },
          { name: '16树脂充填', category: 'FILLING', teethNumbers: ['16'] },
          { name: '26树脂充填', category: 'FILLING', teethNumbers: ['26'] },
        ],
      });
      const matches = result.summary.match(/16/g);
      expect(matches ? matches.length : 0).toBe(1);
    });

    it('就诊日期推算复诊日期：格式 YYYY-MM-DD', () => {
      const result = service.generateSummary({
        visit: { chiefComplaint: '常规检查', diagnosis: '', startTime: '2026-01-15T08:30:00.000Z' },
        treatments: [],
      });
      expect(/^\d{4}-\d{2}-\d{2}$/.test(result.nextReminder)).toBe(true);
    });
  });

  describe('generateAndSave - 数据库写回 + 审计', () => {
    const VISIT_ID = 'visit-summary-001';

    beforeEach(() => {
      db.seed('Visit', [
        {
          id: VISIT_ID,
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: '26慢性根尖周炎',
          startTime: '2026-07-01T09:00:00.000Z',
          status: 'IN_PROGRESS',
          summaryAutoGenerated: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);
      db.seed('Treatment', [
        {
          id: 'treat-001',
          patientId: 'patient-001',
          visitId: VISIT_ID,
          doctorId: 'doctor-001',
          code: 'RCT-001',
          name: '26根管治疗充填',
          category: 'ROOT_CANAL',
          price: 800,
          quantity: 1,
          teethNumbers: JSON.stringify(['26']),
          status: 'COMPLETED',
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);
    });

    it('TR-3.3: summaryAutoGenerated = 0（医生手动已改）→ 不被覆盖，返回 wasAutoGenerated=false', async () => {
      db.seed('Visit', [
        {
          id: 'visit-manual-001',
          patientId: 'patient-002',
          doctorId: 'doctor-001',
          chiefComplaint: '检查',
          diagnosis: '健康',
          startTime: '2026-07-01T09:00:00.000Z',
          status: 'COMPLETED',
          summaryAutoGenerated: 0,
          summary: '医生手动填写的摘要',
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);
      const result = await service.generateAndSave('visit-manual-001');
      expect(result.wasAutoGenerated).toBe(false);
      const rows = db.getTableData('Visit');
      const updated = rows.find(r => r.id === 'visit-manual-001');
      expect(updated?.summary).toBe('医生手动填写的摘要');
    });

    it('TR-3.4: Settings.aiMedicalSummaryEnabled = "false" → 不生成', async () => {
      const disabledSettings = createMockSettingsService({ aiMedicalSummaryEnabled: 'false' });
      const disabledService = new MedicalSummaryService(
        asDbService(db),
        createMockClinicContext(),
        disabledSettings,
      );
      const result = await disabledService.generateAndSave(VISIT_ID);
      expect(result.wasAutoGenerated).toBe(false);
      expect(result.summary).toBe('');
    });

    it('TR-3.6: generateAndSave 写回 summary, nextReminder, summaryAutoGenerated=1', async () => {
      const result = await service.generateAndSave(VISIT_ID);
      expect(result.wasAutoGenerated).toBe(true);
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.nextReminder.length).toBeGreaterThan(0);

      const rows = db.getTableData('Visit');
      const updated = rows.find(r => r.id === VISIT_ID);
      expect(updated).toBeDefined();
      expect(updated!.summary).toBe(result.summary);
      expect(updated!.nextReminder).toBe(result.nextReminder);
      expect(updated!.summaryAutoGenerated).toBe(1);
    });

    it('TR-3.7: 审计日志写入，action=MEDICAL_SUMMARY_AUTO_GENERATED 存在', async () => {
      await service.generateAndSave(VISIT_ID);
      const logs = db.getTableData('AuditLog');
      const log = logs.find(l =>
        l.targetId === VISIT_ID &&
        l.targetType === 'Visit' &&
        l.type === 'MEDICAL_SUMMARY_AUTO_GENERATED',
      );
      expect(log).toBeDefined();
    });

    it('Visit 不存在 → 返回 wasAutoGenerated=false', async () => {
      const result = await service.generateAndSave('visit-nonexistent-000');
      expect(result.wasAutoGenerated).toBe(false);
    });
  });

  describe('复诊间隔 lookup 表', () => {
    const START = '2026-01-01T00:00:00.000Z';

    function addDays(days: number): string {
      const d = new Date(START);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    }

    it('CROWN 冠修复 → 7 天', () => {
      const r = service.generateSummary({
        visit: { diagnosis: '', startTime: START },
        treatments: [{ name: '全瓷冠粘接', category: 'CROWN', teethNumbers: ['16'] }],
      });
      expect(r.nextReminder).toBe(addDays(7));
    });

    it('SURGERY 手术 → 7 天', () => {
      const r = service.generateSummary({
        visit: { diagnosis: '', startTime: START },
        treatments: [{ name: '根尖切除', category: 'SURGERY', teethNumbers: ['26'] }],
      });
      expect(r.nextReminder).toBe(addDays(7));
    });

    it('EXTRACTION 拔牙 → 90 天', () => {
      const r = service.generateSummary({
        visit: { diagnosis: '', startTime: START },
        treatments: [{ name: '38拔除', category: 'EXTRACTION', teethNumbers: ['38'] }],
      });
      expect(r.nextReminder).toBe(addDays(90));
    });

    it('ORTHO_VISIT 正畸 → 35 天', () => {
      const r = service.generateSummary({
        visit: { diagnosis: '', startTime: START },
        treatments: [{ name: '正畸弓丝更换', category: 'ORTHO', teethNumbers: [] }],
      });
      expect(r.nextReminder).toBe(addDays(35));
    });

    it('CHECKUP 初诊检查 → 180 天', () => {
      const r = service.generateSummary({
        visit: { diagnosis: '', startTime: START },
        treatments: [{ name: '初诊检查', category: 'CHECKUP', teethNumbers: [] }],
      });
      expect(r.nextReminder).toBe(addDays(180));
    });
  });
});
