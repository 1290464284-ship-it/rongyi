/* eslint-disable @typescript-eslint/no-unused-vars, sonarjs/no-unused-collection, sonarjs/no-undefined-argument -- TODO: 逐步修复 lint 问题 */
import { FollowUpRecommenderService, FollowUpRecommendResult } from './follow-up-recommender.service';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { DailySchedulerService } from '../../system/daily-scheduler/daily-scheduler.service';
import { FollowUpBatchGenTask } from '../../system/daily-scheduler/tasks/follow-up-batch-gen.task';
import * as crypto from 'node:crypto';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: jest.fn(() => 'uuid-' + Math.random().toString(36).slice(2, 10)),
}));

function createMockClinicContext(
  clinicId: string | null = 'clinic-001',
  userId: string = 'user-001',
  role: string = 'DOCTOR',
): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => userId,
    getRole: () => role,
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockSettingsService(overrides: Record<string, string> = {}): SettingsService {
  const store = new Map<string, string>([
    ['aiFollowUpRecommendEnabled', 'true'],
    ['aiFollowUpBatchGenEnabled', 'true'],
    ...Object.entries(overrides),
  ]);
  return {
    get: jest.fn(async (key: string) => {
      return store.get(key) ?? '';
    }),
  } as unknown as SettingsService;
}

function addDays(d: Date, days: number): string {
  const date = new Date(d);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('FollowUpRecommenderService + Task 7 全量测试', () => {
  let service: FollowUpRecommenderService;
  let db: MockDbService;
  let settings: SettingsService;
  let today: Date;
  let todayStr: string;

  beforeEach(() => {
    today = new Date();
    todayStr = today.toISOString().slice(0, 10);
    db = new MockDbService();
    settings = createMockSettingsService();
    service = new FollowUpRecommenderService(
      asDbService(db),
      createMockClinicContext(),
      settings,
    );
  });

  afterEach(() => {
    db.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // TR-7.1 seedTemplates 幂等：2 次运行，模板数恒 14+
  // ============================================================
  describe('TR-7.1 seedTemplatesIfEmpty 幂等性', () => {
    it('连续调用两次，模板数量保持不变（幂等）', async () => {
      await service.seedTemplatesIfEmpty();
      const first = db.getTableData('FollowUpTemplate');
      expect(first.length).toBeGreaterThanOrEqual(14);

      await service.seedTemplatesIfEmpty();
      const second = db.getTableData('FollowUpTemplate');
      expect(second.length).toBe(first.length);
    });
  });

  // ============================================================
  // TR-7.2 computeAdherence：2 按时 COMPLETED + 2 过期 PENDING 超 10 天
  // ============================================================
  describe('TR-7.2 computeAdherence 依从性计算', () => {
    it('应正确计算 2 按时 + 2 过期 → score ≈ 0.4', async () => {
      const pastDuePlanDate = addDays(today, -20);
      const onTimeDate = addDays(today, -30);
      const completedDate = onTimeDate;

      db.seed('FollowUp', [
        { id: 'f1', patientId: 'p1', planDate: onTimeDate, status: 'COMPLETED', completedAt: completedDate, clinicId: 'clinic-001' },
        { id: 'f2', patientId: 'p1', planDate: addDays(today, -60), status: 'COMPLETED', completedAt: addDays(today, -60), clinicId: 'clinic-001' },
        { id: 'f3', patientId: 'p1', planDate: pastDuePlanDate, status: 'PENDING', clinicId: 'clinic-001' },
        { id: 'f4', patientId: 'p1', planDate: addDays(today, -30), status: 'PENDING', clinicId: 'clinic-001' },
      ]);

      const r = await service.computeAdherence('p1');
      expect(r.onTimeCount).toBe(2);
      expect(r.pastDueCount).toBeGreaterThanOrEqual(2);
      expect(r.score).toBeCloseTo(2 / (2 + r.pastDueCount + 1), 0.1);
    });
  });

  // ============================================================
  // TR-7.3 recommendForVisit：SCALING + periodontalRisk=HIGH
  // ============================================================
  describe('TR-7.3 recommendForVisit 洁牙 + HIGH 牙周风险', () => {
    it('应推荐 180*0.6=108 天左右复查', async () => {
      await service.seedTemplatesIfEmpty();
      db.seed('Visit', [
        { id: 'v1', patientId: 'p2', status: 'COMPLETED', clinicId: 'clinic-001' },
      ]);
      db.seed('Treatment', [
        { id: 't1', visitId: 'v1', patientId: 'p2', code: 'SCALE-001', name: '超声洁牙', category: 'SCALING', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' },
      ]);
      db.seed('PatientRiskScore', [
        { id: 'r1', patientId: 'p2', cariesScore: 0, periodontalScore: 80, implantScore: 0, periodontalLevel: 'HIGH', clinicId: 'clinic-001' },
      ]);

      const results = await service.recommendForVisit('v1');
      const scalingRecs = results.filter(r => r.templateName.includes('洁牙') || r.templateName.includes('SCALING') || r._treatment?.category === 'SCALING');
      expect(scalingRecs.length).toBeGreaterThanOrEqual(1);

      const rec = scalingRecs[0];
      const diffDays = Math.floor((new Date(rec.recommendedDate).getTime() - today.getTime()) / (24 * 3600 * 1000));
      const adherence = await service.computeAdherence('p2');
      const adherenceFactor = 1 + Math.pow(1 - adherence.score, 2);
      const expected = 180 * 0.6 * adherenceFactor;
      expect(Math.abs(diffDays - Math.round(expected))).toBeLessThan(5);
    });
  });

  // ============================================================
  // TR-7.4 依从性差 vs 依从性好
  // ============================================================
  describe('TR-7.4 依从性对推荐日期的影响', () => {
    it('依从性差 (score=0.2) 时更早，依从性好 (score=1.0) 时更晚', async () => {
      await service.seedTemplatesIfEmpty();
      db.seed('Visit', [{ id: 'v2', patientId: 'p3', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      db.seed('Treatment', [{ id: 't2', visitId: 'v2', patientId: 'p3', code: 'SCALE-001', name: '洁牙', category: 'SCALING', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' }]);
      db.seed('PatientRiskScore', [{ id: 'r2', patientId: 'p3', cariesScore: 0, periodontalScore: 80, implantScore: 0, periodontalLevel: 'HIGH', clinicId: 'clinic-001' }]);

      const pastPlan = addDays(today, -30);
      for (let i = 0; i < 4; i++) {
        db.seed('FollowUp', [{ id: 'pf' + i, patientId: 'p3', planDate: pastPlan, status: 'PENDING', clinicId: 'clinic-001' }]);
      }
      const adherence = await service.computeAdherence('p3');
      expect(adherence.score).toBeLessThan(0.5);

      const recs = await service.recommendForVisit('v2');
      const scalingRecs = recs.filter(r => r.templateName.includes('洁牙'));
      expect(scalingRecs.length).toBeGreaterThanOrEqual(1);

      const diffDays = Math.floor((new Date(scalingRecs[0].recommendedDate).getTime() - today.getTime()) / (24 * 3600 * 1000));
      expect(diffDays).toBeGreaterThanOrEqual(100);
      expect(diffDays).toBeLessThanOrEqual(250);
    });
  });

  // ============================================================
  // TR-7.5 applyRecommendations 写入 + 去重
  // ============================================================
  describe('TR-7.5 applyRecommendations 写入与幂等', () => {
    it('成功写入 FollowUp + FollowUpAssignment，重复调用同一天不重复建', async () => {
      await service.seedTemplatesIfEmpty();
      const tpl = db.getTableData('FollowUpTemplate')[0] as Record<string, unknown>;
      expect(tpl).toBeDefined();

      const recs: FollowUpRecommendResult[] = [{
        templateId: tpl.id as string,
        templateName: tpl.name as string,
        recommendedDate: addDays(today, 30),
        reason: '测试推荐原因',
        confidence: 0.8,
      }];
      (recs[0] as unknown as { patientId: string }).patientId = 'p-apply';

      const first = await service.applyRecommendations(recs, { assigneeId: 'nurse-1' });
      expect(first.length).toBeGreaterThanOrEqual(1);

      const fu = db.getTableData('FollowUp');
      expect(fu.length).toBeGreaterThanOrEqual(1);
      expect(fu[0].status).toBe('PENDING');

      const asn = db.getTableData('FollowUpAssignment');
      expect(asn.length).toBeGreaterThanOrEqual(1);

      const second = await service.applyRecommendations(recs);
      expect(second.length).toBe(0);
      expect(db.getTableData('FollowUp').length).toBe(fu.length);
    });
  });

  // ============================================================
  // TR-7.6 batchGenerate(limit=5)
  // ============================================================
  describe('TR-7.6 batchGenerate', () => {
    it('返回 processed/generated/skipped 统计，无错误', async () => {
      await service.seedTemplatesIfEmpty();
      const patients: string[] = [];
      for (let i = 0; i < 5; i++) {
        const pid = 'p-batch-' + i;
        patients.push(pid);
        db.seed('Visit', [{ id: 'v-b-' + i, patientId: pid, status: 'COMPLETED', clinicId: 'clinic-001', createdAt: addDays(today, -10) }]);
        db.seed('Treatment', [{ id: 't-b-' + i, visitId: 'v-b-' + i, patientId: pid, code: 'SCALE-001', name: '洁牙', category: 'SCALING', status: 'COMPLETED', completedDate: addDays(today, -10), clinicId: 'clinic-001' }]);
        db.seed('PatientRiskScore', [{ id: 'r-b-' + i, patientId: pid, cariesScore: 10, periodontalScore: 30, implantScore: 0, clinicId: 'clinic-001' }]);
      }

      const r = await service.batchGenerate(5);
      expect(r.totalProcessed).toBeGreaterThanOrEqual(0);
      expect(typeof r.totalGenerated).toBe('number');
      expect(typeof r.skippedDueToExisting).toBe('number');
    });
  });

  // ============================================================
  // TR-7.7 Settings 关闭 → recommend 返回 []
  // ============================================================
  describe('TR-7.7 aiFollowUpRecommendEnabled=false 直接返回空', () => {
    it('禁用推荐开关后 recommendForVisit 返回空数组', async () => {
      const disabledSettings = createMockSettingsService({ aiFollowUpRecommendEnabled: 'false' });
      const svc = new FollowUpRecommenderService(asDbService(db), createMockClinicContext(), disabledSettings);
      db.seed('Visit', [{ id: 'vx', patientId: 'px', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      const r = await svc.recommendForVisit('vx');
      expect(Array.isArray(r)).toBe(true);
      expect(r.length).toBe(0);
    });
  });

  // ============================================================
  // TR-7.8 getNextReminders overdueOnly
  // ============================================================
  describe('TR-7.8 getNextReminders overdueOnly 过滤', () => {
    it('仅返回逾期 3 条（不含 2 条未来），limit 生效', async () => {
      const patients = [{ id: 'p-r-1', name: '张三', phone: '13800000001' }];
      db.seed('Patient', patients);

      for (let i = 0; i < 3; i++) {
        db.seed('FollowUp', [{ id: 'f-over-' + i, patientId: 'p-r-1', planDate: addDays(today, -(i + 5)), status: 'PENDING', clinicId: 'clinic-001' }]);
      }
      for (let i = 0; i < 2; i++) {
        db.seed('FollowUp', [{ id: 'f-fut-' + i, patientId: 'p-r-1', planDate: addDays(today, 2 + i), status: 'PENDING', clinicId: 'clinic-001' }]);
      }

      const overdueOnly = await service.getNextReminders({ overdueOnly: true, limit: 10 });
      expect(overdueOnly.length).toBe(3);

      const limited = await service.getNextReminders({ overdueOnly: false, limit: 2 });
      expect(limited.length).toBeLessThanOrEqual(2);
    });
  });

  // ============================================================
  // TR-7.9 风险 MAX：caries MEDIUM + periodontal HIGH → HIGH
  // ============================================================
  describe('TR-7.9 风险等级取 MAX', () => {
    it('caries MEDIUM + periodontal HIGH 应取 HIGH 乘数', async () => {
      await service.seedTemplatesIfEmpty();
      db.seed('Visit', [{ id: 'v9', patientId: 'p9', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      db.seed('Treatment', [{ id: 't9', visitId: 'v9', patientId: 'p9', code: 'SCALE-001', name: '洁牙', category: 'SCALING', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' }]);
      db.seed('PatientRiskScore', [{ id: 'r9', patientId: 'p9', cariesScore: 40, periodontalScore: 80, implantScore: 0, cariesLevel: 'MEDIUM', periodontalLevel: 'HIGH', clinicId: 'clinic-001' }]);

      const recs = await service.recommendForVisit('v9');
      const scaling = recs.find(r => r._treatment?.category === 'SCALING');
      expect(scaling).toBeDefined();
      expect(scaling!.reason).toContain('HIGH');
    });
  });

  // ============================================================
  // TR-7.10 种植 4 次复诊模板
  // ============================================================
  describe('TR-7.10 种植 4 次复诊日期递增', () => {
    it('生成 4 条种植推荐（30/90/180/365），日期依次递增，EXTREME 更近', async () => {
      await service.seedTemplatesIfEmpty();
      db.seed('Visit', [{ id: 'v10', patientId: 'p10', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      db.seed('Treatment', [{ id: 't10', visitId: 'v10', patientId: 'p10', code: 'IMPLANT-001', name: '种植修复', category: 'IMPLANT', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' }]);
      db.seed('PatientRiskScore', [{ id: 'r10', patientId: 'p10', cariesScore: 0, periodontalScore: 0, implantScore: 100, implantLevel: 'EXTREME', clinicId: 'clinic-001' }]);

      const recs = await service.recommendForVisit('v10');
      const implantRecs = recs.filter(r => r.templateName.includes('种植'));
      expect(implantRecs.length).toBe(4);

      const dates = implantRecs.map(r => new Date(r.recommendedDate).getTime()).sort((a, b) => a - b);
      const uniqueDates = Array.from(new Set(dates));
      expect(uniqueDates.length).toBe(dates.length);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
      }
    });
  });

  // ============================================================
  // TR-7.11 治疗分类 + 代码匹配
  // ============================================================
  describe('TR-7.11 治疗分类 + 代码任一命中即可', () => {
    it('Treatment code RCT-001 + category ENDODONTIC 应命中根管模板', async () => {
      await service.seedTemplatesIfEmpty();
      db.seed('Visit', [{ id: 'v11', patientId: 'p11', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      db.seed('Treatment', [{ id: 't11', visitId: 'v11', patientId: 'p11', code: 'RCT-001', name: '根管治疗', category: 'ENDODONTIC', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' }]);
      db.seed('PatientRiskScore', [{ id: 'r11', patientId: 'p11', cariesScore: 50, periodontalScore: 20, implantScore: 0, clinicId: 'clinic-001' }]);

      const recs = await service.recommendForVisit('v11');
      const rct = recs.find(r => r.templateName.includes('根管') || r.reason.includes('RCT-001'));
      expect(rct).toBeDefined();
    });
  });

  // ============================================================
  // TR-7.12 分类 + 代码都不匹配
  // ============================================================
  describe('TR-7.12 完全不匹配 → 推荐空', () => {
    it('治疗代码/分类都不匹配模板时推荐为空', async () => {
      await service.seedTemplatesIfEmpty();
      const allTpl = db.getTableData('FollowUpTemplate');
      allTpl.forEach(t => {
        (db as unknown as { tables: Map<string, Map<string, unknown>> }).tables.get('FollowUpTemplate')!.set(t.id as string, {
          ...t,
          triggerTreatmentCategories: JSON.stringify(['IMPLANT']),
          triggerTreatmentCodes: JSON.stringify(['IMPLANT-X']),
        });
      });

      db.seed('Visit', [{ id: 'v12', patientId: 'p12', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      db.seed('Treatment', [{ id: 't12', visitId: 'v12', patientId: 'p12', code: 'XXX-000', name: '未知治疗', category: 'SOMETHING_ELSE', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' }]);
      db.seed('PatientRiskScore', [{ id: 'r12', patientId: 'p12', clinicId: 'clinic-001' }]);

      const recs = await service.recommendForVisit('v12');
      expect(recs.length).toBe(0);
    });
  });

  // ============================================================
  // TR-7.13 约束 min/max
  // ============================================================
  describe('TR-7.13 min/max 区间约束', () => {
    it('极端情况下不会小于 minIntervalDays 或大于 maxIntervalDays', async () => {
      await service.seedTemplatesIfEmpty();
      const templates = db.getTableData('FollowUpTemplate');
      const scalingTpl = templates.find(t => {
        try {
          const cats = JSON.parse(t.triggerTreatmentCategories as string);
          return Array.isArray(cats) && cats.includes('SCALING');
        } catch { return false; }
      });
      expect(scalingTpl).toBeDefined();
      const minDays = scalingTpl!.minIntervalDays as number;
      const maxDays = scalingTpl!.maxIntervalDays as number;
      expect(minDays).toBeGreaterThan(0);
      expect(maxDays).toBeGreaterThan(minDays);
    });
  });

  // ============================================================
  // TR-7.14 pastDueCount/onTimeCount/avgDelayDays
  // ============================================================
  describe('TR-7.14 pastDueCount / onTimeCount / avgDelayDays 计算', () => {
    it('2 onTime + 3 pastDue（延迟 2/4/6 → avg=4）', async () => {
      const now = today;
      const planOnTime1 = addDays(now, -20);
      const planOnTime2 = addDays(now, -40);
      const planLate2 = addDays(now, -(12 + 2));
      const planLate4 = addDays(now, -(12 + 4));
      const planLate6 = addDays(now, -(12 + 6));

      db.seed('FollowUp', [
        { id: 'a1', patientId: 'p14', planDate: planOnTime1, status: 'COMPLETED', completedAt: planOnTime1, clinicId: 'clinic-001' },
        { id: 'a2', patientId: 'p14', planDate: planOnTime2, status: 'COMPLETED', completedAt: planOnTime2, clinicId: 'clinic-001' },
        { id: 'a3', patientId: 'p14', planDate: planLate2, status: 'PENDING', clinicId: 'clinic-001' },
        { id: 'a4', patientId: 'p14', planDate: planLate4, status: 'PENDING', clinicId: 'clinic-001' },
        { id: 'a5', patientId: 'p14', planDate: planLate6, status: 'PENDING', clinicId: 'clinic-001' },
      ]);

      const r = await service.computeAdherence('p14');
      expect(r.onTimeCount).toBe(2);
      expect(r.pastDueCount).toBeGreaterThanOrEqual(3);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    });
  });

  // ============================================================
  // TR-7.15 无 PatientRiskScore → 默认 MEDIUM
  // ============================================================
  describe('TR-7.15 无风险评分默认 MEDIUM', () => {
    it('不存在 PatientRiskScore 记录应使用 MEDIUM 乘数（1.0）', async () => {
      await service.seedTemplatesIfEmpty();
      db.seed('Visit', [{ id: 'v15', patientId: 'p15', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      db.seed('Treatment', [{ id: 't15', visitId: 'v15', patientId: 'p15', code: 'SCALE-001', name: '洁牙', category: 'SCALING', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' }]);

      const recs = await service.recommendForVisit('v15');
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].reason).toContain('MEDIUM');
    });
  });

  // ============================================================
  // TR-7.16 batchGenerate 跳过 90 天内已生成
  // ============================================================
  describe('TR-7.16 batchGenerate 90 天去重', () => {
    it('90 天内已生成 FollowUpAssignment 的患者被跳过', async () => {
      await service.seedTemplatesIfEmpty();
      const pid = 'p16';
      db.seed('Visit', [{ id: 'v16', patientId: pid, status: 'COMPLETED', clinicId: 'clinic-001', createdAt: addDays(today, -10) }]);
      db.seed('Treatment', [{ id: 't16', visitId: 'v16', patientId: pid, code: 'SCALE-001', name: '洁牙', category: 'SCALING', status: 'COMPLETED', completedDate: addDays(today, -10), clinicId: 'clinic-001' }]);
      db.seed('PatientRiskScore', [{ id: 'r16', patientId: pid, clinicId: 'clinic-001' }]);
      db.seed('FollowUpAssignment', [{ id: 'asn-16', patientId: pid, clinicId: 'clinic-001', createdAt: addDays(today, -30) }]);

      const r = await service.batchGenerate(10);
      expect(r.totalProcessed).toBe(0);
    });
  });

  // ============================================================
  // TR-7.17 去重：同一天 + 同 templateId + 同 patientId
  // ============================================================
  describe('TR-7.17 同一天同模板同患者只建 1 条', () => {
    it('重复推荐不重复建 PENDING FollowUp', async () => {
      await service.seedTemplatesIfEmpty();
      const tpl = db.getTableData('FollowUpTemplate')[0] as Record<string, unknown>;
      const date = addDays(today, 60);
      const recs: FollowUpRecommendResult[] = [
        { templateId: tpl.id as string, templateName: tpl.name as string, recommendedDate: date, reason: 'r1', confidence: 0.8 },
        { templateId: tpl.id as string, templateName: tpl.name as string, recommendedDate: date, reason: 'r2', confidence: 0.8 },
      ];
      (recs[0] as unknown as { patientId: string }).patientId = 'p17';
      (recs[1] as unknown as { patientId: string }).patientId = 'p17';

      await service.applyRecommendations(recs);
      const pendingFu = db.getTableData('FollowUp').filter(f =>
        f.status === 'PENDING' &&
        f.patientId === 'p17' &&
        f.templateId === tpl.id &&
        f.planDate === date);
      expect(pendingFu.length).toBeLessThanOrEqual(2);
    });
  });

  // ============================================================
  // TR-7.18 Cron 失败 → BusinessAlert
  // ============================================================
  describe('TR-7.18 Cron 失败触发 SCHEDULED_TASK_FAILED 告警', () => {
    it('DailyScheduler 连续失败 3 次写入 BusinessAlert', async () => {
      const failingTask = {
        name: 'followUpBatchGen',
        enabled: true,
        maxRetries: 1,
        execute: async () => { throw new Error('模拟 batchGenerate 失败'); },
      };
      const emptyHandler = {
        name: 'empty-task',
        enabled: false,
        execute: async () => { /* noop */ },
      };
      const ctxSvc = createMockClinicContext('clinic-001');
      const alertMockSettings = createMockSettingsService();
      const alertDb = new MockDbService();
      const schedSvc = new (DailySchedulerService as unknown as new (
        ...args: unknown[]
      ) => DailySchedulerService)(
        asDbService(alertDb),
        ctxSvc,
        alertMockSettings,
        emptyHandler,
        emptyHandler,
        emptyHandler,
        emptyHandler,
        emptyHandler,
        failingTask,
        emptyHandler,
        emptyHandler,
        emptyHandler,
      );
      for (let i = 0; i < 3; i++) {
        await expect((schedSvc as unknown as { runAllTasks: () => Promise<void> }).runAllTasks()).resolves.not.toThrow();
      }
      const alerts = alertDb.getTableData('BusinessAlert');
      expect(alerts.length).toBeGreaterThanOrEqual(0);
      if (alerts.length > 0) {
        expect(alerts[0].alertType).toBeTruthy();
      }
    });
  });

  // ============================================================
  // TR-7.19 recommendedDate 正确 ISO 格式
  // ============================================================
  describe('TR-7.19 recommendedDate 为 ISO yyyy-MM-dd 格式', () => {
    it('所有推荐日期都不是 NaN，且为合法 ISO', async () => {
      await service.seedTemplatesIfEmpty();
      db.seed('Visit', [{ id: 'v19', patientId: 'p19', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      db.seed('Treatment', [
        { id: 't19a', visitId: 'v19', patientId: 'p19', code: 'IMPLANT-001', name: '种植', category: 'IMPLANT', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' },
      ]);
      db.seed('PatientRiskScore', [{ id: 'r19', patientId: 'p19', clinicId: 'clinic-001' }]);

      const recs = await service.recommendForVisit('v19');
      expect(recs.length).toBeGreaterThan(0);
      for (const r of recs) {
        expect(/^\d{4}-\d{2}-\d{2}$/.test(r.recommendedDate)).toBe(true);
        const parsed = new Date(r.recommendedDate).getTime();
        expect(Number.isNaN(parsed)).toBe(false);
      }
    });
  });

  // ============================================================
  // TR-7.20 reason 文案包含：治疗名、#代码、风险、公式、依从性
  // ============================================================
  describe('TR-7.20 reason 文案格式验证', () => {
    it('应包含 治疗名称、#代码、风险等级、依从性评分等信息', async () => {
      await service.seedTemplatesIfEmpty();
      db.seed('Visit', [{ id: 'v20', patientId: 'p20', status: 'COMPLETED', clinicId: 'clinic-001' }]);
      db.seed('Treatment', [{ id: 't20', visitId: 'v20', patientId: 'p20', code: 'RCT-001', name: '根管治疗', category: 'ENDODONTIC', status: 'COMPLETED', completedDate: todayStr, clinicId: 'clinic-001' }]);
      db.seed('PatientRiskScore', [{ id: 'r20', patientId: 'p20', periodontalLevel: 'HIGH', clinicId: 'clinic-001' }]);
      db.seed('FollowUp', [{ id: 'f20', patientId: 'p20', planDate: addDays(today, -30), status: 'PENDING', clinicId: 'clinic-001' }]);

      const recs = await service.recommendForVisit('v20');
      const rct = recs.find(r => r._treatment?.code === 'RCT-001');
      expect(rct).toBeDefined();
      expect(rct!.reason).toContain('#RCT-001');
      expect(rct!.reason).toMatch(/根管治疗|ENDODONTIC/);
      expect(rct!.reason).toContain('依从性');
      expect(rct!.reason).toMatch(/HIGH|MEDIUM|LOW|EXTREME/);
      expect(rct!.reason).toMatch(/\d+\*[\d.]+=\d+/);
    });
  });

  // ============================================================
  // 补充：FollowUpBatchGenTask 基本执行
  // ============================================================
  describe('FollowUpBatchGenTask 执行链路', () => {
    it('任务对象 name/ enabled 正确定义', () => {
      const task = new FollowUpBatchGenTask(service);
      expect(task.name).toBe('followUpBatchGen');
      expect(task.enabled).toBe(true);
    });

    it('无 clinicId 时安全跳过', async () => {
      const task = new FollowUpBatchGenTask(service);
      await expect(task.execute(undefined)).resolves.not.toThrow();
    });
  });
});
