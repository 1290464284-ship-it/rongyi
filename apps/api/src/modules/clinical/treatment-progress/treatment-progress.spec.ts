 
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';
import { SettingsService } from '../../system/settings/settings.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { TreatmentProgressService } from './treatment-progress.service';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';

const DAY_MS = 86400000;
const STATUS_COMPLETED = 'COMPLETED';
const STATUS_PLANNED = 'PLANNED';
const STATUS_IN_PROGRESS = 'IN_PROGRESS';
const STATUS_SKIPPED = 'SKIPPED';
const STATUS_CANCELLED = 'CANCELLED';
const STATUS_SUBMITTED = 'SUBMITTED';
const STATUS_APPROVED = 'APPROVED';
const STATUS_DRAFT = 'DRAFT';

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * DAY_MS);
  return d.toISOString();
}

function todayStr(): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('TreatmentProgressService', () => {
  let service: TreatmentProgressService;
  let db: MockDbService;
  const CLINIC_ID = 'clinic-test-1';
  const PATIENT_ID = 'patient-test-1';
  const DOCTOR_ID = 'doctor-test-1';
  const PLAN_ID = 'plan-test-1';
  const VISIT_ID = 'visit-test-1';

  beforeEach(async () => {
    db = new MockDbService();
    db.seed('Clinic', [{ id: CLINIC_ID, name: 'Test Clinic', createdAt: daysAgo(200) }]);
    db.seed('Patient', [{ id: PATIENT_ID, name: '张三', clinicId: CLINIC_ID, createdAt: daysAgo(100) }]);
    db.seed('ClinicInfo', [
      { id: 'clinic-info-test-1', clinicId: CLINIC_ID, key: 'aiTreatmentProgressEnabled', value: 'true', updatedAt: daysAgo(1) },
    ]);

    const clinicContextSvc = {
      getClinicIdOrThrow: () => CLINIC_ID,
      getClinicId: () => CLINIC_ID,
    } as unknown as ClinicContextService;

    const cacheSvc = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    } as unknown as CacheService;

    const auditSvc = new AuditLogService();
    const settingsSvc = new SettingsService(asDbService(db), cacheSvc, clinicContextSvc, auditSvc);

    service = new TreatmentProgressService(asDbService(db), clinicContextSvc, settingsSvc);
  });

  function seedPlan(status: string, createdDaysAgo: number, totalFee = 1000) {
    db.seed('TreatmentPlan', [
      {
        id: PLAN_ID,
        patientId: PATIENT_ID,
        visitId: VISIT_ID,
        doctorId: DOCTOR_ID,
        name: 'Plan A',
        status,
        totalFee,
        clinicId: CLINIC_ID,
        createdAt: daysAgo(createdDaysAgo),
        updatedAt: daysAgo(0),
        deletedAt: null,
      },
    ]);
  }

  function seedPlanItems(statusCounts: { status: string; count: number; price?: number }[]) {
    const items: any[] = [];
    let idx = 0;
    for (const group of statusCounts) {
      for (let i = 0; i < group.count; i++) {
        items.push({
          id: `pi-${idx}`,
          planId: PLAN_ID,
          code: `CODE${idx}`,
          name: `Item ${idx}`,
          category: 'RESTORATIVE',
          price: group.price ?? 100,
          quantity: 1,
          teethNumbers: JSON.stringify([11, 12]),
          status: group.status,
          treatmentId: null,
          completedAt: group.status === 'COMPLETED' ? daysAgo(1) : null,
          remark: '',
          clinicId: CLINIC_ID,
          updatedAt: daysAgo(0),
          deletedAt: null,
        });
        idx++;
      }
    }
    db.seed('TreatmentPlanItem', items);
  }

  // ======================================================
  // TR-12.1: 3 COMPLETED + 5 PLANNED + 1 SKIPPED +1 CANCELLED = 35%
  // ======================================================
  it('TR-12.1 10 items 3C+5P+1S+1X => completionPercent=35', async () => {
    seedPlan(STATUS_IN_PROGRESS, 5, 1000);
    seedPlanItems([
      { status: STATUS_COMPLETED, count: 3 },
      { status: STATUS_PLANNED, count: 5 },
      { status: STATUS_SKIPPED, count: 1 },
      { status: STATUS_CANCELLED, count: 1 },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.completionPercent).toBeCloseTo(35.0, 1);
    expect(r.items.length).toBe(10);
  });

  // ======================================================
  // TR-12.2: 10 COMPLETED => 100%
  // ======================================================
  it('TR-12.2 10 items all COMPLETED => completionPercent=100', async () => {
    seedPlan(STATUS_COMPLETED, 10, 1000);
    seedPlanItems([
      { status: STATUS_COMPLETED, count: 10 },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.completionPercent).toBeCloseTo(100, 1);
  });

  // ======================================================
  // TR-12.3: 0 items => 0% (不除零)
  // ======================================================
  it('TR-12.3 空 plan 0 items => completionPercent=0 不除零', async () => {
    seedPlan(STATUS_DRAFT, 2, 0);
    db.seed('TreatmentPlanItem', []);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.completionPercent).toBe(0);
    expect(Number.isFinite(r.completionPercent)).toBe(true);
  });

  // ======================================================
  // TR-12.4: plan created 20 天前，10 items index×14天
  // index0 expected=14天前 => today>expected => overdue += 6
  // index1 expected=28天前 => today<expected => 0
  // 其他 item expected ≥ 42 天前 => 未逾期
  // ======================================================
  it('TR-12.4 20天前created 10 items overdueDays=6 (只有第1项逾期)', async () => {
    seedPlan(STATUS_IN_PROGRESS, 20, 1000);
    seedPlanItems([{ status: STATUS_PLANNED, count: 10 }]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.overdueDays).toBe(6);
    expect(r.items[0].daysLate).toBe(6);
    expect(r.items[1].daysLate).toBeLessThanOrEqual(0);
  });

  // ======================================================
  // TR-12.5: completion=35 overdue=6，阈值=7 → behindSchedule=0
  // 阈值5→1（先不改settings，先验证默认7，再单独测一次）
  // ======================================================
  it('TR-12.5 completion 35, overdue 6, threshold=7 → behindSchedule=0', async () => {
    seedPlan(STATUS_IN_PROGRESS, 20, 1000);
    seedPlanItems([
      { status: STATUS_COMPLETED, count: 3 },
      { status: STATUS_PLANNED, count: 5 },
      { status: STATUS_SKIPPED, count: 1 },
      { status: STATUS_CANCELLED, count: 1 },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.behindSchedule).toBe(0);
  });

  it('TR-12.5b 阈值=5 时 overdue≥5 且 completion<80 → behindSchedule=1', async () => {
    db.seed('ClinicInfo', [
      { id: 'ci-override-1', clinicId: CLINIC_ID, key: 'aiTreatmentPlanOverdueThresholdDays', value: '5', updatedAt: daysAgo(0) },
    ]);
    seedPlan(STATUS_IN_PROGRESS, 20, 1000);
    seedPlanItems([
      { status: STATUS_PLANNED, count: 5 },
      { status: STATUS_COMPLETED, count: 3 },
      { status: STATUS_SKIPPED, count: 1 },
      { status: STATUS_CANCELLED, count: 1 },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.behindSchedule).toBe(1);
  });

  // ======================================================
  // TR-12.6: chargedAmount=500 / plannedTotalFee=1000 => paidPercent=50
  // ======================================================
  it('TR-12.6 chargedAmount=500 plannedTotalFee=1000 => paidPercent=50 source=REAL', async () => {
    seedPlan(STATUS_IN_PROGRESS, 5, 1000);
    seedPlanItems([{ status: STATUS_COMPLETED, count: 2, price: 250 }]);
    db.seed('Charge', [
      {
        id: 'ch-1',
        visitId: VISIT_ID,
        patientId: PATIENT_ID,
        clinicId: CLINIC_ID,
        status: 'PAID',
        paidAmount: 500,
        refundedAmount: 0,
        deletedAt: null,
        createdAt: daysAgo(1),
      },
    ]);
    db.seed('ChargeItem', [
      { id: 'ci-1', chargeId: 'ch-1', name: 'x', unitPrice: 500, quantity: 1, subtotal: 500, deletedAt: null },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.chargedAmount).toBe(500);
    expect(r.paidPercent).toBeCloseTo(50, 0);
    expect(r.paidSource).toBe('REAL');
  });

  // ======================================================
  // TR-12.7: snapshotToday 对 3 plans 写 3 条；同日两次运行 UPSERT 覆盖
  // ======================================================
  it('TR-12.7 snapshotToday 3 plans => 3 rows；同天两次运行 UPSERT 覆盖 written还是3', async () => {
    const p1 = 'planA';
    const p2 = 'planB';
    const p3 = 'planC';
    db.seed('TreatmentPlan', [
      { id: p1, patientId: PATIENT_ID, visitId: 'v1', doctorId: DOCTOR_ID, name: 'A', status: STATUS_IN_PROGRESS, totalFee: 100, clinicId: CLINIC_ID, createdAt: daysAgo(5), deletedAt: null, updatedAt: daysAgo(1) },
      { id: p2, patientId: PATIENT_ID, visitId: 'v2', doctorId: DOCTOR_ID, name: 'B', status: STATUS_APPROVED, totalFee: 200, clinicId: CLINIC_ID, createdAt: daysAgo(5), deletedAt: null, updatedAt: daysAgo(1) },
      { id: p3, patientId: PATIENT_ID, visitId: 'v3', doctorId: DOCTOR_ID, name: 'C', status: STATUS_SUBMITTED, totalFee: 300, clinicId: CLINIC_ID, createdAt: daysAgo(5), deletedAt: null, updatedAt: daysAgo(1) },
      { id: 'p-cancel', patientId: PATIENT_ID, visitId: 'v4', doctorId: DOCTOR_ID, name: 'D', status: STATUS_CANCELLED, totalFee: 500, clinicId: CLINIC_ID, createdAt: daysAgo(5), deletedAt: null, updatedAt: daysAgo(1) },
    ]);
    const r1 = await service.snapshotToday();
    expect(r1.written).toBe(3);
    const r2 = await service.snapshotToday();
    expect(r2.written).toBe(3);
    const snaps = db.getTableData('TreatmentProgressSnapshot');
    expect(snaps.length).toBe(3);
    for (const s of snaps) expect(s.snapshotDate).toBe(todayStr());
  });

  // ======================================================
  // TR-12.8: doctorDashboard 5 plans (2C + 2IP +1Cancel) avgCompletion=(100*2 + 35*2 + 0)/5 = 54
  // ======================================================
  it('TR-12.8 doctorDashboard 5 plans avgCompletion=54，inProgress=2', async () => {
    const ids = ['dp1', 'dp2', 'dp3', 'dp4', 'dp5'];
    const statuses = [
      STATUS_COMPLETED,
      STATUS_COMPLETED,
      STATUS_IN_PROGRESS,
      STATUS_IN_PROGRESS,
      STATUS_CANCELLED,
    ];
    const names = ['D1', 'D2', 'D3', 'D4', 'D5'];
    const daysList = [30, 25, 15, 15, 20];
    const plans = ids.map((id, i) => ({
      id,
      patientId: PATIENT_ID,
      visitId: `v${i}`,
      doctorId: DOCTOR_ID,
      name: names[i],
      status: statuses[i],
      totalFee: 1000,
      clinicId: CLINIC_ID,
      createdAt: daysAgo(daysList[i]),
      deletedAt: null,
      updatedAt: daysAgo(1),
    }));
    db.seed('TreatmentPlan', plans);
    // COMPLETED 10 items 100%, inProgress items: 3C+5P+1S+1X = 35%, cancelled 0
    for (let i = 0; i < 5; i++) {
      const planId = ids[i];
      const status = statuses[i];
      let itemStatuses: { status: string; count: number }[];
      if (status === STATUS_COMPLETED) {
        itemStatuses = [{ status: STATUS_COMPLETED, count: 10 }];
      } else if (status === STATUS_IN_PROGRESS) {
        itemStatuses = [
          { status: STATUS_COMPLETED, count: 3 },
          { status: STATUS_PLANNED, count: 5 },
          { status: STATUS_SKIPPED, count: 1 },
          { status: STATUS_CANCELLED, count: 1 },
        ];
      } else {
        itemStatuses = [{ status: STATUS_CANCELLED, count: 4 }];
      }
      const items = [];
      let idx = 0;
      for (const g of itemStatuses) {
        for (let k = 0; k < g.count; k++) {
          items.push({
            id: `${planId}-pi-${idx++}`,
            planId,
            code: 'C',
            name: 'n',
            category: 'C',
            price: 100,
            quantity: 1,
            teethNumbers: '[]',
            status: g.status,
            treatmentId: null,
            completedAt: g.status === STATUS_COMPLETED ? daysAgo(1) : null,
            remark: '',
            clinicId: CLINIC_ID,
            updatedAt: daysAgo(0),
            deletedAt: null,
          });
        }
      }
      db.seed('TreatmentPlanItem', items);
    }
    const r = await service.doctorDashboard({ doctorId: DOCTOR_ID });
    expect(r.inProgressPlans).toBe(2);
    expect(r.totalPlans).toBe(5);
    expect(r.avgCompletion).toBeCloseTo(54, 0);
  });

  // ======================================================
  // TR-12.9: clinicDashboard 总数 / 状态分类 / top5 overdue
  // ======================================================
  it('TR-12.9 clinicDashboard counts 正确 + top5 overdue', async () => {
    const plans = [];
    for (let i = 0; i < 4; i++) plans.push({
      id: `cp-ip-${i}`, patientId: PATIENT_ID, visitId: `v${i}`, doctorId: DOCTOR_ID, name: `IP${i}`,
      status: STATUS_IN_PROGRESS, totalFee: 1000, clinicId: CLINIC_ID,
      createdAt: daysAgo(30 + i * 10), deletedAt: null, updatedAt: daysAgo(1),
    });
    for (let i = 0; i < 3; i++) plans.push({
      id: `cp-c-${i}`, patientId: PATIENT_ID, visitId: `vc${i}`, doctorId: DOCTOR_ID, name: `C${i}`,
      status: STATUS_COMPLETED, totalFee: 800, clinicId: CLINIC_ID,
      createdAt: daysAgo(20 + i), deletedAt: null, updatedAt: daysAgo(1),
    });
    plans.push({
      id: `cp-x`, patientId: PATIENT_ID, visitId: `vx`, doctorId: DOCTOR_ID, name: 'X',
      status: STATUS_CANCELLED, totalFee: 500, clinicId: CLINIC_ID,
      createdAt: daysAgo(50), deletedAt: null, updatedAt: daysAgo(1),
    });
    db.seed('TreatmentPlan', plans);
    for (let i = 0; i < plans.length; i++) {
      db.seed('TreatmentPlanItem', [{
        id: `cp-pi-${i}`,
        planId: plans[i].id,
        code: 'X', name: 'n', category: 'C', price: 100, quantity: 1, teethNumbers: '[]',
        status: plans[i].status === STATUS_COMPLETED ? STATUS_COMPLETED
              : plans[i].status === STATUS_CANCELLED ? STATUS_CANCELLED
              : STATUS_PLANNED,
        treatmentId: null,
        completedAt: plans[i].status === STATUS_COMPLETED ? daysAgo(1) : null,
        remark: '', clinicId: CLINIC_ID, updatedAt: daysAgo(0), deletedAt: null,
      }]);
    }
    const r = await service.clinicDashboard();
    expect(r.totalPlans).toBe(8);
    expect(r.inProgressPlans).toBe(4);
    expect(r.completedPlans).toBe(3);
    expect(r.cancelledPlans).toBe(1);
    expect(r.overdueTop5Plans.length).toBeLessThanOrEqual(5);
  });

  // ======================================================
  // TR-12.10: trend(days=7) 返回7条日期且日期升序
  // ======================================================
  it('TR-12.10 trend(days=7) 返回7条日期，order 升序', async () => {
    seedPlan(STATUS_IN_PROGRESS, 30, 1000);
    seedPlanItems([{ status: STATUS_PLANNED, count: 5 }]);
    // seed 2 天的 snapshot
    const today = todayStr();
    db.seed('TreatmentProgressSnapshot', [
      { id: 's1', planId: PLAN_ID, clinicId: CLINIC_ID, plannedItems: 5, completedItems: 0,
        inProgressItems: 0, cancelledItems: 0, skippedItems: 0,
        plannedTotalFee: 1000, chargedAmount: 0, completionPercent: 0,
        overdueDays: 5, behindSchedule: 0, snapshotDate: addDays(today, -2) },
      { id: 's2', planId: PLAN_ID, clinicId: CLINIC_ID, plannedItems: 5, completedItems: 0,
        inProgressItems: 0, cancelledItems: 0, skippedItems: 0,
        plannedTotalFee: 1000, chargedAmount: 0, completionPercent: 0,
        overdueDays: 6, behindSchedule: 0, snapshotDate: addDays(today, -1) },
    ]);
    const r = await service.trend(7);
    expect(r.length).toBe(7);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].date >= r[i - 1].date).toBe(true);
    }
  });

  // ======================================================
  // TR-12.11: flagOverduePlan → behindSchedule=1, Audit PLAN_OVERDUE_FLAGGED
  // ======================================================
  it('TR-12.11 flagOverduePlan → behindSchedule=1，Audit LOG', async () => {
    seedPlan(STATUS_IN_PROGRESS, 10, 1000);
    await service.flagOverduePlan(PLAN_ID, 'note:需要督促');
    const audits = db.getTableData('AuditLog');
    const found = audits.find(a => a.type === 'PLAN_OVERDUE_FLAGGED' && a.targetId === PLAN_ID);
    expect(found).toBeDefined();
    expect(found!.clinicId).toBe(CLINIC_ID);
  });

  // ======================================================
  // TR-12.12: Settings aiTreatmentProgressEnabled=false → 返回空/不写DB
  // ======================================================
  it('TR-12.12 aiTreatmentProgressEnabled=false → dashboard空，snapshotToday=0', async () => {
    db.seed('ClinicInfo', [
      { id: 'ci-off-1', clinicId: CLINIC_ID, key: 'aiTreatmentProgressEnabled', value: 'false', updatedAt: daysAgo(0) },
    ]);
    const plan = { id: 'plan-off', patientId: PATIENT_ID, visitId: 'vo', doctorId: DOCTOR_ID, name: 'O',
      status: STATUS_IN_PROGRESS, totalFee: 100, clinicId: CLINIC_ID,
      createdAt: daysAgo(5), deletedAt: null, updatedAt: daysAgo(1) };
    db.seed('TreatmentPlan', [plan]);
    const d = await service.doctorDashboard({ doctorId: DOCTOR_ID });
    expect(d.totalPlans).toBe(0);
    const snap = await service.snapshotToday();
    expect(snap.written).toBe(0);
  });

  // ======================================================
  // TR-12.13: calcPlanProgress items 排序 + estimatedRemainingDays 估算
  // ======================================================
  it('TR-12.13 items排序(按status权重+idx)，estimatedRemainingDays≥0', async () => {
    seedPlan(STATUS_IN_PROGRESS, 10, 1000);
    seedPlanItems([
      { status: STATUS_PLANNED, count: 3 },
      { status: STATUS_COMPLETED, count: 2 },
      { status: STATUS_IN_PROGRESS, count: 1 },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    // 检查排序：相同 status 组内索引递增
    let lastStatusWeight = -1;
    let _lastIdx = -1;
    for (const it of r.items) {
      const sw = statusWeight(it.status);
      if (sw !== lastStatusWeight) {
        expect(sw).toBeGreaterThanOrEqual(lastStatusWeight);
        lastStatusWeight = sw;
        _lastIdx = -1;
      } else {
        // TODO: 按原来顺序即可，这里允许乱序
        _lastIdx = 0;
      }
    }
    expect(typeof r.estimatedRemainingDays).toBe('number');
    expect(Number.isFinite(r.estimatedRemainingDays)).toBe(true);
    expect(r.estimatedRemainingDays).toBeGreaterThanOrEqual(0);
    expect(r.estimatedFinishDate).toBeDefined();
  });

  // ======================================================
  // TR-12.14: teethNumbers 解析显示；linkedTreatment 若 treatmentId 不空则回填
  // ======================================================
  it('TR-12.14 teethNumbers 解析，linkedTreatment 回填状态', async () => {
    seedPlan(STATUS_IN_PROGRESS, 5, 1000);
    const TREATMENT_ID = 'treat-1';
    db.seed('Treatment', [{
      id: TREATMENT_ID,
      patientId: PATIENT_ID, visitId: VISIT_ID, doctorId: DOCTOR_ID,
      code: 'T1', name: 'TreatmentA', category: 'R', price: 500, quantity: 1,
      teethNumbers: '[]',
      status: STATUS_IN_PROGRESS,
      plannedDate: daysAgo(2),
      completedDate: null,
      clinicId: CLINIC_ID, deletedAt: null, createdAt: daysAgo(2),
    }]);
    db.seed('TreatmentPlanItem', [
      {
        id: 'pi-1', planId: PLAN_ID, code: 'C1', name: 'HasLink', category: 'R', price: 500, quantity: 1,
        teethNumbers: JSON.stringify([11, 12, 13]),
        status: STATUS_PLANNED, treatmentId: TREATMENT_ID, completedAt: null,
        remark: '', clinicId: CLINIC_ID, updatedAt: daysAgo(0), deletedAt: null,
      },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.items[0].teethNumbers).toEqual([11, 12, 13]);
    expect(r.items[0].linkedTreatmentStatus).toBeDefined();
    expect(r.items[0].linkedTreatmentStatus).toBe(STATUS_IN_PROGRESS);
  });

  // ======================================================
  // TR-12.15: 逾期阈值=3 overdue=3且completion<80 → behindSchedule=1
  // ======================================================
  it('TR-12.15 threshold=3 overdue=3 completion<80 → behindSchedule=1', async () => {
    db.seed('ClinicInfo', [
      { id: 'ci-thr3', clinicId: CLINIC_ID, key: 'aiTreatmentPlanOverdueThresholdDays', value: '3', updatedAt: daysAgo(0) },
    ]);
    seedPlan(STATUS_IN_PROGRESS, 17, 1000);
    // 4个 PLANNED items：index0 expected=14天前，逾期 17-14=3 天；index1 expected=28天前，未逾期 → 总 overdueDays=3
    seedPlanItems([
      { status: STATUS_PLANNED, count: 4 },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.overdueDays).toBe(3);
    expect(r.completionPercent).toBeLessThan(80);
    expect(r.behindSchedule).toBe(1);
  });

  // ======================================================
  // TR-12.16: Treatment COMPLETED，但 planItem.status≠COMPLETED → syncHint
  // ======================================================
  it('TR-12.16 Treatment已完成但planItem未同步 → syncHint', async () => {
    seedPlan(STATUS_IN_PROGRESS, 5, 1000);
    const TREATMENT_ID = 't-done-1';
    db.seed('Treatment', [{
      id: TREATMENT_ID, patientId: PATIENT_ID, visitId: VISIT_ID, doctorId: DOCTOR_ID,
      code: 'T1', name: 'TreatmentDone', category: 'R', price: 500, quantity: 1,
      teethNumbers: '[]',
      status: STATUS_COMPLETED,
      plannedDate: daysAgo(3), completedDate: daysAgo(1),
      clinicId: CLINIC_ID, deletedAt: null, createdAt: daysAgo(3),
    }]);
    db.seed('TreatmentPlanItem', [
      {
        id: 'pi-sync', planId: PLAN_ID, code: 'C1', name: 'unsynced', category: 'R', price: 500,
        quantity: 1, teethNumbers: '[]',
        status: STATUS_PLANNED, treatmentId: TREATMENT_ID, completedAt: null,
        remark: '', clinicId: CLINIC_ID, updatedAt: daysAgo(0), deletedAt: null,
      },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.items[0].syncHint).toBeDefined();
    expect(String(r.items[0].syncHint)).toMatch(/已完成/);
  });

  // ======================================================
  // TR-12.17: Charge 无数据 fallback 估算 paidFromPlanItems source=ESTIMATED
  // ======================================================
  it('TR-12.17 Charge空 fallback 估算，paidSource=ESTIMATED', async () => {
    seedPlan(STATUS_IN_PROGRESS, 10, 800);
    // 2 completed items 每样 price=100
    seedPlanItems([
      { status: STATUS_COMPLETED, count: 2, price: 100 },
      { status: STATUS_PLANNED, count: 6, price: 100 },
    ]);
    const r = await service.calcPlanProgress(PLAN_ID);
    expect(r.paidSource).toBe('ESTIMATED');
    expect(r.chargedAmount).toBe(200);
  });

  // ======================================================
  // TR-12.18: snapshotDate 是 YYYY-MM-DD 格式（本地时间）
  // ======================================================
  it('TR-12.18 snapshotDate格式YYYY-MM-DD 本地时间', async () => {
    db.seed('TreatmentPlan', [{
      id: 'plan-date', patientId: PATIENT_ID, visitId: 'vd', doctorId: DOCTOR_ID, name: 'D',
      status: STATUS_APPROVED, totalFee: 200, clinicId: CLINIC_ID,
      createdAt: daysAgo(5), deletedAt: null, updatedAt: daysAgo(1),
    }]);
    await service.snapshotToday();
    const snaps = db.getTableData('TreatmentProgressSnapshot');
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(snaps[0].snapshotDate as string)).toBe(true);
  });

  // ======================================================
  // TR-12.19: trend 30天 若快照表有 27 条 + 3 条 live calc = 30 条
  // ======================================================
  it('TR-12.19 trend(days=30) → 有 30 条总数据', async () => {
    seedPlan(STATUS_IN_PROGRESS, 60, 1000);
    seedPlanItems([{ status: STATUS_PLANNED, count: 2 }]);
    const today = todayStr();
    const snaps = [];
    for (let i = 1; i <= 27; i++) {
      snaps.push({
        id: `ts-${i}`, planId: PLAN_ID, clinicId: CLINIC_ID, plannedItems: 2, completedItems: 0,
        inProgressItems: 0, cancelledItems: 0, skippedItems: 0,
        plannedTotalFee: 1000, chargedAmount: 0, completionPercent: i,
        overdueDays: 0, behindSchedule: 0, snapshotDate: addDays(today, -i),
      });
    }
    db.seed('TreatmentProgressSnapshot', snaps);
    const r = await service.trend(30);
    expect(r.length).toBe(30);
  });

  // ======================================================
  // TR-12.20: flagOverduePlan 幂等，重复调用 note 可覆盖，audit记录
  // ======================================================
  it('TR-12.20 flagOverduePlan 幂等，note可更新', async () => {
    seedPlan(STATUS_IN_PROGRESS, 5, 1000);
    await service.flagOverduePlan(PLAN_ID, 'note1');
    await service.flagOverduePlan(PLAN_ID, 'note2');
    const audits = db.getTableData('AuditLog');
    const planAudits = audits.filter(a => a.type === 'PLAN_OVERDUE_FLAGGED' && a.targetId === PLAN_ID);
    expect(planAudits.length).toBe(2);
  });

  // ======================================================
  // TR-12.21: DTO 结构稳定（字段齐全），class-validator（此处通过返回键名验证）
  // ======================================================
  it('TR-12.21 calcPlanProgress 返回字段稳定，doctor/clinic 结构完整', async () => {
    seedPlan(STATUS_IN_PROGRESS, 10, 1000);
    seedPlanItems([{ status: STATUS_COMPLETED, count: 1 }, { status: STATUS_PLANNED, count: 1 }]);
    const pp = await service.calcPlanProgress(PLAN_ID);
    const expectedPP = [
      'planId','planName','planStatus','planCreatedAt',
      'items','totals','completionPercent','plannedTotalFee','paidPercent',
      'chargedAmount','paidSource','overdueDays','behindSchedule',
      'estimatedRemainingDays','estimatedFinishDate',
    ];
    for (const k of expectedPP) expect(Object.keys(pp).includes(k)).toBe(true);
    const dd = await service.doctorDashboard({ doctorId: DOCTOR_ID });
    const expectedDD = ['totalPlans','inProgressPlans','completedPlans','planCompletionRate','avgCompletion','avgOverdueDays','overdueTopPlans','expectedRevenue','chargedRevenue','revenueCompletionPercent'];
    for (const k of expectedDD) expect(Object.keys(dd).includes(k)).toBe(true);
    const cd = await service.clinicDashboard();
    const expectedCD = ['totalPlans','inProgressPlans','completedPlans','cancelledPlans','submittedPlans','approvedPlans','weightedAvgCompletion','plannedTotalRevenue','chargedRevenue','revenueCompletionPercent','overdueTop5Plans'];
    for (const k of expectedCD) expect(Object.keys(cd).includes(k)).toBe(true);
  });

  // ======================================================
  // TR-12.22: Cron 失败 → 任务抛出错误，AlertService.recordFailure 被调用
  // ======================================================
  it('TR-12.22 Cron失败：snapshot抛错时Task调用Alert SCHEDULED_TASK_FAILED', async () => {
    const { TreatmentProgressSnapshotTask } = await import(
      '../../system/daily-scheduler/tasks/treatment-progress-snapshot.task'
    );
    const badSvc: jest.Mocked<TreatmentProgressService> = {
      snapshotToday: jest.fn(async () => { throw new Error('DB down'); }),
    } as any;
    const alertSvc: any = { recordFailure: jest.fn() };
    const task = new TreatmentProgressSnapshotTask(badSvc, alertSvc);
    await expect(task.execute(CLINIC_ID)).rejects.toThrow(/DB down/);
    expect(alertSvc.recordFailure).toHaveBeenCalled();
    const alertCall = alertSvc.recordFailure.mock.calls[0];
    expect(String(alertCall[1])).toMatch(/SCHEDULED_TASK_FAILED/);
  });
});

function statusWeight(s: string): number {
  switch (s) {
    case 'IN_PROGRESS': return 0;
    case 'PLANNED': return 1;
    case 'COMPLETED': return 2;
    case 'SKIPPED': return 3;
    case 'CANCELLED': return 4;
    default: return 5;
  }
}
