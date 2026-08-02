import Database from 'better-sqlite3';
import * as crypto from 'node:crypto';
import { WorkScheduleService } from './work-schedule.service';
import { LeaveRequestService } from './leave-request.service';
import { SettingsService } from '../system/settings/settings.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { CacheService } from '../../common/services/cache.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import {
  createTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../db/test-helpers';
import { DbService } from '../../db/db.service';
import { HrConstants, SHIFT_TYPES, LEAVE_STATUSES, ATTENDANCE_STATUSES } from './constants';
import { ROLES } from '@dental/shared';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-only-00000000000000000000000000000000';

const TEST_CLINIC_ID = 'test-clinic-hr-001';
const TEST_USER_BOSS_ID = 'test-user-boss-001';
const TEST_USER_DOCTOR_ID = 'test-user-doctor-001';
const TEST_USER_DOCTOR2_ID = 'test-user-doctor-002';
const TEST_USER_RECEPTIONIST_ID = 'test-user-receptionist-001';
const TEST_PATIENT_ID = 'test-patient-hr-001';

function uuid(): string {
  return crypto.randomUUID();
}

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
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createSettingsService(dbService: DbService, clinicContext: ClinicContextService): SettingsService {
  const cache = new CacheService();
  const auditLog = new AuditLogService();
  return new SettingsService(dbService, cache, clinicContext, auditLog);
}

function seedClinicAndUsers(db: Database.Database) {
  db.pragma('foreign_keys = OFF');

  db.prepare(
    `INSERT OR IGNORE INTO Clinic (id, name, code, address, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(TEST_CLINIC_ID, '荣毅测试诊所', 'RY-HR-TEST', '北京市朝阳区测试路1号', '010-88888888', new Date().toISOString(), new Date().toISOString());

  db.prepare(
    `INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(TEST_USER_BOSS_ID, 'boss1', 'hash', '王老板', ROLES.BOSS, TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());

  db.prepare(
    `INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(TEST_USER_DOCTOR_ID, 'doc1', 'hash', '李医生', ROLES.DOCTOR, TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());

  db.prepare(
    `INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(TEST_USER_DOCTOR2_ID, 'doc2', 'hash', '张医生', ROLES.DOCTOR, TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());

  db.prepare(
    `INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(TEST_USER_RECEPTIONIST_ID, 'rec1', 'hash', '前台小周', ROLES.RECEPTIONIST, TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());

  db.prepare(
    `INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, 'MALE', '13800000000', ?, 1, ?, ?)`
  ).run(TEST_PATIENT_ID, 'P001', '张三', TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());
}

describe('HR 排班考勤请假系统 - WorkSchedule + LeaveRequest', () => {
  let db: Database.Database;
  let dbService: DbService;
  let clinicContext: ClinicContextService;
  let settingsService: SettingsService;
  let workScheduleService: WorkScheduleService;
  let leaveRequestService: LeaveRequestService;

  async function setupWithRole(role: string, userId: string) {
    db = createTestDb();
    dbService = createTestDbService(db);
    clinicContext = createClinicContext({ role, userId });
    settingsService = createSettingsService(dbService, clinicContext);
    workScheduleService = new WorkScheduleService(dbService, clinicContext, new AuditLogService(), settingsService);
    leaveRequestService = new LeaveRequestService(dbService, clinicContext, new AuditLogService(), settingsService);

    await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId, role }, () => {
      seedTestData(db);
      seedClinicAndUsers(db);
      const _now = new Date().toISOString();
      // 确保 Settings 的默认值已经写入（调用 ensureDefaultConfigs 通过 getClinicInfo 触发）
      try { settingsService['ensureDefaultConfigs'](); } catch { /* noop */ }
    });
  }

  beforeEach(async () => {
    await setupWithRole(ROLES.BOSS, TEST_USER_BOSS_ID);
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  // =========================================================================
  // TR-14.1 ~ TR-14.6 WorkSchedule 冲突检测
  // =========================================================================
  describe('WorkSchedule 冲突检测', () => {
    it('TR-14.1 同员工 09:00-18:00 已存在；再插入 10:00-11:00 → 抛 SCHEDULE_CONFLICT', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.CUSTOM,
          startAt: '2025-03-10T09:00:00',
          endAt: '2025-03-10T18:00:00',
          color: '#4F46E5',
        });

        await expect(workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.CUSTOM,
          startAt: '2025-03-10T10:00:00',
          endAt: '2025-03-10T11:00:00',
        })).rejects.toThrow(HrConstants.SCHEDULE_CONFLICT);
      });
    });

    it('TR-14.2 同员工 09:00-12:00 + 13:00-18:00 → 不冲突，成功', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const s1 = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.MORNING,
          startAt: '2025-03-10T09:00:00',
          endAt: '2025-03-10T12:00:00',
        });
        const s2 = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.AFTERNOON,
          startAt: '2025-03-10T13:00:00',
          endAt: '2025-03-10T18:00:00',
        });
        expect(s1.id).toBeTruthy();
        expect(s2.id).toBeTruthy();
        expect(s1.id).not.toBe(s2.id);
      });
    });

    it('TR-14.3 边界：前者 endAt=12:00，后者 startAt=12:00 → 不冲突（连续相邻可）', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.MORNING,
          startAt: '2025-03-10T08:00:00',
          endAt: '2025-03-10T12:00:00',
        });
        const s2 = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.AFTERNOON,
          startAt: '2025-03-10T12:00:00',
          endAt: '2025-03-10T17:30:00',
        });
        expect(s2.id).toBeTruthy();
      });
    });

    it('TR-14.4 同员工两班 09:00-18:00 vs 18:00-21:00 → 相邻不冲突', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-10T09:00:00',
          endAt: '2025-03-10T18:00:00',
        });
        const s2 = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.CUSTOM,
          startAt: '2025-03-10T18:00:00',
          endAt: '2025-03-10T21:00:00',
        });
        expect(s2.id).toBeTruthy();
      });
    });

    it('TR-14.5 自己更新自己时间（从 9-18 → 9-12）→ 冲突检测排除自身，允许', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const s = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-10T09:00:00',
          endAt: '2025-03-10T18:00:00',
        });
        const updated = await workScheduleService.updateSchedule(s.id, {
          startAt: '2025-03-10T09:00:00',
          endAt: '2025-03-10T12:00:00',
          shiftType: SHIFT_TYPES.MORNING,
        });
        expect(updated.endAt).toBe('2025-03-10T12:00:00');
      });
    });

    it('TR-14.6 不同员工同时间段 → 不冲突，允许', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const s1 = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-10T09:00:00',
          endAt: '2025-03-10T18:00:00',
        });
        const s2 = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR2_ID,
          shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-10T09:00:00',
          endAt: '2025-03-10T18:00:00',
        });
        expect(s1.id).toBeTruthy();
        expect(s2.id).toBeTruthy();
      });
    });
  });

  // =========================================================================
  // TR-14.7 ~ TR-14.12 LeaveRequest 状态机
  // =========================================================================
  describe('LeaveRequest 状态机', () => {
    it('TR-14.7 LeaveRequest create 默认 SAVED；submit 变 PENDING；submit 非 SAVED 抛非法状态', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        const lr = await leaveRequestService.create({
          leaveType: 'ANNUAL',
          startAt: '2025-03-10T00:00:00',
          endAt: '2025-03-10T23:59:59',
          reason: '年假休息',
        });
        expect(lr.status).toBe(LEAVE_STATUSES.SAVED);

        const submitted = await leaveRequestService.submit(lr.id);
        expect(submitted.status).toBe(LEAVE_STATUSES.PENDING);
        expect(submitted.submittedAt).toBeTruthy();

        await expect(leaveRequestService.submit(lr.id)).rejects.toThrow(HrConstants.INVALID_TRANSITION);
      });
    });

    it('TR-14.8 APPROVED 后再次 approve → 抛 INVALID_TRANSITION；终态不改变', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        const lr = await leaveRequestService.create({
          leaveType: 'ANNUAL',
          startAt: '2025-03-11T00:00:00',
          endAt: '2025-03-11T23:59:59',
        });
        await leaveRequestService.submit(lr.id);
      });

      // 切换到 BOSS 审批
      const bossCtx = createClinicContext({ role: ROLES.BOSS, userId: TEST_USER_BOSS_ID });
      const bossLrSvc = new LeaveRequestService(dbService, bossCtx, new AuditLogService(), settingsService);

      await runInClinicContext(bossCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const pending = await bossLrSvc.list({});
        const lr = pending.items[0];
        const approved = await bossLrSvc.approve(lr.id);
        expect(approved.status).toBe(LEAVE_STATUSES.APPROVED);

        await expect(bossLrSvc.approve(lr.id)).rejects.toThrow(HrConstants.INVALID_TRANSITION);
      });
    });

    it('TR-14.9 approve(PENDING) → 状态=APPROVED + WorkSchedule LEAVE 条目自动创建；考勤中该 user 当天显示 LEAVE', async () => {
      const doctorCtx = createClinicContext({ role: ROLES.DOCTOR, userId: TEST_USER_DOCTOR_ID });
      const doctorLrSvc = new LeaveRequestService(dbService, doctorCtx, new AuditLogService(), settingsService);

      let lrId: string;
      await runInClinicContext(doctorCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        const lr = await doctorLrSvc.create({
          leaveType: 'SICK',
          startAt: '2025-03-13T00:00:00',
          endAt: '2025-03-13T23:59:59',
          reason: '生病请假',
        });
        lrId = lr.id;
        const submitted = await doctorLrSvc.submit(lr.id);
        expect(submitted.userId).toBe(TEST_USER_DOCTOR_ID);
      });

      const bossCtx = createClinicContext({ role: ROLES.BOSS, userId: TEST_USER_BOSS_ID });
      const bossLrSvc = new LeaveRequestService(dbService, bossCtx, new AuditLogService(), settingsService);
      const bossWsSvc = new WorkScheduleService(dbService, bossCtx, new AuditLogService(), settingsService);

      await runInClinicContext(bossCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const approved = await bossLrSvc.approve(lrId);
        expect(approved.status).toBe(LEAVE_STATUSES.APPROVED);
        expect(approved.userId).toBe(TEST_USER_DOCTOR_ID);

        const schedules = await bossWsSvc.listSchedules({ from: '2025-03-01T00:00:00', to: '2025-03-31T23:59:59', userId: TEST_USER_DOCTOR_ID });
        const leaveSchedule = schedules.items.find(s => s.shiftType === SHIFT_TYPES.LEAVE);
        expect(leaveSchedule).toBeTruthy();
        expect(leaveSchedule?.note).toContain(lrId);

        const stats = await bossWsSvc.attendanceStats({
          from: '2025-03-13T00:00:00',
          to: '2025-03-13T23:59:59',
          userId: TEST_USER_DOCTOR_ID,
        });
        expect(stats.daysLeave).toBe(1);
        const day13 = stats.listDaily.find(d => d.date === '2025-03-13');
        expect(day13?.status).toBe(ATTENDANCE_STATUSES.LEAVE);
      });
    });

    it('TR-14.10 reject(PENDING, rejectReason=出差冲突) → 状态=REJECTED，rejectReason 可读', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        const lr = await leaveRequestService.create({
          leaveType: 'PERSONAL',
          startAt: '2025-03-14T00:00:00',
          endAt: '2025-03-14T23:59:59',
        });
        await leaveRequestService.submit(lr.id);
      });

      const bossCtx = createClinicContext({ role: ROLES.BOSS, userId: TEST_USER_BOSS_ID });
      const bossLrSvc = new LeaveRequestService(dbService, bossCtx, new AuditLogService(), settingsService);

      await runInClinicContext(bossCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const pending = await bossLrSvc.list({});
        const lr = pending.items[0];
        const rejected = await bossLrSvc.reject(lr.id, '出差冲突，请改期');
        expect(rejected.status).toBe(LEAVE_STATUSES.REJECTED);
        expect(rejected.rejectReason).toBe('出差冲突，请改期');
      });
    });

    it('TR-14.11 reject(PENDING, rejectReason=) → 抛 REJECT_REASON_REQUIRED（非空必填）', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        const lr = await leaveRequestService.create({
          leaveType: 'PERSONAL',
          startAt: '2025-03-15T00:00:00',
          endAt: '2025-03-15T23:59:59',
        });
        await leaveRequestService.submit(lr.id);
      });

      const bossCtx = createClinicContext({ role: ROLES.BOSS, userId: TEST_USER_BOSS_ID });
      const bossLrSvc = new LeaveRequestService(dbService, bossCtx, new AuditLogService(), settingsService);

      await runInClinicContext(bossCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const pending = await bossLrSvc.list({});
        const lr = pending.items[0];
        await expect(bossLrSvc.reject(lr.id, '')).rejects.toThrow(HrConstants.REJECT_REASON_REQUIRED);
      });
    });

    it('TR-14.12 用户本人 cancel PENDING → CANCELLED；BOSS 审批 不能被 cancel；终态不能被 cancel', async () => {
      // 步骤1: 用户创建 PENDING 申请，然后 cancel
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        const lr1 = await leaveRequestService.create({
          leaveType: 'ANNUAL',
          startAt: '2025-03-16T00:00:00',
          endAt: '2025-03-16T23:59:59',
        });
        await leaveRequestService.submit(lr1.id);

        const cancelled = await leaveRequestService.cancel(lr1.id);
        expect(cancelled.status).toBe(LEAVE_STATUSES.CANCELLED);

        // 终态不能再次 cancel
        await expect(leaveRequestService.cancel(lr1.id)).rejects.toThrow(HrConstants.INVALID_TRANSITION);
      });

      // 步骤2: BOSS 审批通过后，用户不能 cancel
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        const lr2 = await leaveRequestService.create({
          leaveType: 'ANNUAL',
          startAt: '2025-03-17T00:00:00',
          endAt: '2025-03-17T23:59:59',
        });
        await leaveRequestService.submit(lr2.id);

        const bossCtx = createClinicContext({ role: ROLES.BOSS, userId: TEST_USER_BOSS_ID });
        const bossLrSvc = new LeaveRequestService(dbService, bossCtx, new AuditLogService(), settingsService);
        await runInClinicContext(bossCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
          await bossLrSvc.approve(lr2.id);
        });

        await expect(leaveRequestService.cancel(lr2.id)).rejects.toThrow(HrConstants.INVALID_TRANSITION);
      });
    });
  });

  // =========================================================================
  // TR-14.13 list 可见性
  // =========================================================================
  describe('可见性 / 权限', () => {
    it('TR-14.13 普通角色 USER_DOCTOR 调用 list(leaves)：仅返回自己 userId 的；BOSS 看到全部', async () => {
      // BOSS 先插入两个医生的请假
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        // 通过直接插入 SQL 模拟两条不同用户的 leave
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO LeaveRequest (id, userId, leaveType, startAt, endAt, totalDays, status, clinicId, createdAt, updatedAt) VALUES (?, ?, 'ANNUAL', ?, ?, 1, 'SAVED', ?, ?, ?)`)
          .run(uuid(), TEST_USER_DOCTOR_ID, '2025-03-20T00:00:00', '2025-03-20T23:59:59', TEST_CLINIC_ID, now, now);
        db.prepare(`INSERT INTO LeaveRequest (id, userId, leaveType, startAt, endAt, totalDays, status, clinicId, createdAt, updatedAt) VALUES (?, ?, 'SICK', ?, ?, 1, 'SAVED', ?, ?, ?)`)
          .run(uuid(), TEST_USER_DOCTOR2_ID, '2025-03-21T00:00:00', '2025-03-21T23:59:59', TEST_CLINIC_ID, now, now);
      });

      // DOCTOR 视角
      const doctorCtx = createClinicContext({ role: ROLES.DOCTOR, userId: TEST_USER_DOCTOR_ID });
      const doctorLrSvc = new LeaveRequestService(dbService, doctorCtx, new AuditLogService(), settingsService);
      const doctorList = await runInClinicContext(doctorCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, () => doctorLrSvc.list({}));
      for (const item of doctorList.items) {
        expect(item.userId).toBe(TEST_USER_DOCTOR_ID);
      }

      // BOSS 视角
      const bossList = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, () => leaveRequestService.list({}));
      const userIds = new Set(bossList.items.map(i => i.userId));
      expect(userIds.has(TEST_USER_DOCTOR_ID)).toBe(true);
      expect(userIds.has(TEST_USER_DOCTOR2_ID)).toBe(true);
    });
  });

  // =========================================================================
  // TR-14.14 ~ TR-14.15 Calendar + Attendance
  // =========================================================================
  describe('月视图 + 考勤统计', () => {
    it('TR-14.14 monthCalendar(2025, 3, userIdX)：3 月 1-31 日共 31 天；周末也返回；每人颜色稳定', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID,
          shiftType: SHIFT_TYPES.MORNING,
          startAt: '2025-03-10T08:00:00',
          endAt: '2025-03-10T12:00:00',
        });

        const cal = await workScheduleService.monthCalendar({ year: 2025, month: 3, userId: TEST_USER_DOCTOR_ID });
        expect(cal.length).toBe(31);

        const day10 = cal.find(d => d.date === '2025-03-10');
        expect(day10).toBeTruthy();
        expect(day10!.schedules.length).toBeGreaterThanOrEqual(1);

        const sat = cal.find(d => d.date === '2025-03-01'); // 2025-03-01 是周六
        const sun = cal.find(d => d.date === '2025-03-02'); // 2025-03-02 是周日
        expect(sat).toBeTruthy();
        expect(sun).toBeTruthy();

        // 颜色稳定：同一 userId 每次哈希色一致
        const cal2 = await workScheduleService.monthCalendar({ year: 2025, month: 3, userId: TEST_USER_DOCTOR_ID });
        const day10v2 = cal2.find(d => d.date === '2025-03-10');
        expect(day10v2?.schedules[0].color).toBe(day10?.schedules[0].color);
      });
    });

    it('TR-14.15 attendanceStats：3/10 有排班 + 有 Visit(endTime 当日) → PRESENT；3/11 排班但无 Visit + 无 Appointment → ABSENT；3/12 OFF → OFF；3/13 LEAVE APPROVED → LEAVE', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        // 3/10：排班 + Visit
        await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-10T08:00:00', endAt: '2025-03-10T17:30:00',
        });
        const vId = uuid();
        db.prepare(`INSERT INTO Visit (id, patientId, doctorId, startTime, endTime, status, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`)
          .run(vId, TEST_PATIENT_ID, TEST_USER_DOCTOR_ID, '2025-03-10T09:00:00', '2025-03-10T10:30:00', TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());

        // 3/11：排班但无接诊
        await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-11T08:00:00', endAt: '2025-03-11T17:30:00',
        });

        // 3/12：OFF
        await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.OFF,
          startAt: '2025-03-12T00:00:00', endAt: '2025-03-12T23:59:59',
        });

        // 3/13：LEAVE APPROVED
        const lr = await leaveRequestService.create({
          leaveType: 'ANNUAL',
          startAt: '2025-03-13T00:00:00', endAt: '2025-03-13T23:59:59',
          reason: '年假',
        });
        // 用 SQL 直接标记状态 APPROVED 以避免权限问题
        db.prepare(`UPDATE LeaveRequest SET status = ? WHERE id = ?`)
          .run('APPROVED', lr.id);
        // 创建 WorkSchedule LEAVE 记录
        db.prepare(`INSERT INTO WorkSchedule (id, userId, shiftType, startAt, endAt, note, color, clinicId, createdAt, updatedAt) VALUES (?, ?, 'LEAVE', ?, ?, ?, '#F97316', ?, ?, ?)`)
          .run(uuid(), TEST_USER_DOCTOR_ID, '2025-03-13T00:00:00', '2025-03-13T23:59:59', 'LeaveRequest', TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());

        const stats = await workScheduleService.attendanceStats({
          from: '2025-03-10T00:00:00', to: '2025-03-13T23:59:59',
          userId: TEST_USER_DOCTOR_ID,
        });

        const d10 = stats.listDaily.find(d => d.date === '2025-03-10');
        const d11 = stats.listDaily.find(d => d.date === '2025-03-11');
        const d12 = stats.listDaily.find(d => d.date === '2025-03-12');
        const d13 = stats.listDaily.find(d => d.date === '2025-03-13');

        expect(d10?.status).toBe(ATTENDANCE_STATUSES.PRESENT);
        expect(d11?.status).toBe(ATTENDANCE_STATUSES.ABSENT);
        expect(d12?.status).toBe(ATTENDANCE_STATUSES.OFF);
        expect(d13?.status).toBe(ATTENDANCE_STATUSES.LEAVE);
        expect(stats.daysPresent).toBe(1);
        expect(stats.daysAbsent).toBe(1);
        expect(stats.daysOff).toBe(1);
        expect(stats.daysLeave).toBe(1);
      });
    });
  });

  // =========================================================================
  // TR-14.16 ~ TR-14.18 其他核心功能
  // =========================================================================
  describe('其他核心功能', () => {
    it('TR-14.16 创建 shiftType CUSTOM：startAt=09:30, endAt=14:00；不传时间用默认 MORNING/FULL', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const custom = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.CUSTOM,
          startAt: '2025-03-20T09:30:00', endAt: '2025-03-20T14:00:00',
        });
        expect(custom.startAt).toBe('2025-03-20T09:30:00');
        expect(custom.endAt).toBe('2025-03-20T14:00:00');

        const morning = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.MORNING,
          startAt: '2025-03-21T00:00:00', endAt: '2025-03-21T00:00:00',
        });
        expect(morning.startAt.slice(11, 16)).toBe('08:00');
        expect(morning.endAt.slice(11, 16)).toBe('12:00');

        const full = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR2_ID, shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-21T00:00:00', endAt: '2025-03-21T00:00:00',
        });
        expect(full.startAt.slice(11, 16)).toBe('08:00');
        expect(full.endAt.slice(11, 16)).toBe('17:30');
      });
    });

    it('TR-14.17 leave 时间跨天 3/10-3/12；totalDays = 3（自动计算向上取整或按天差+1）', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        const lr = await leaveRequestService.create({
          leaveType: 'ANNUAL',
          startAt: '2025-03-10T00:00:00', endAt: '2025-03-12T23:59:59',
          reason: '跨天假',
        });
        expect(lr.totalDays).toBeGreaterThanOrEqual(3);
      });
    });

    it('TR-14.18 aiHrEnabled=false → 所有写接口抛 DISABLED；读接口允许但返回空', async () => {
      // 直接 SQL 设置 aiHrEnabled='false'
      db.prepare(`INSERT OR IGNORE INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, ?, ?)`)
        .run(uuid(), 'aiHrEnabled', 'false', null, new Date().toISOString());
      db.prepare(`UPDATE ClinicInfo SET value = 'false' WHERE key = 'aiHrEnabled' AND (clinicId IS NULL OR clinicId = ?)`).run(TEST_CLINIC_ID);

      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        // 新实例（新的 settingsService）读新配置
        const cc = createClinicContext({ role: ROLES.BOSS, userId: TEST_USER_BOSS_ID });
        const ss = createSettingsService(dbService, cc);
        const wss = new WorkScheduleService(dbService, cc, new AuditLogService(), ss);
        const lrs = new LeaveRequestService(dbService, cc, new AuditLogService(), ss);

        await expect(wss.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.MORNING,
          startAt: '2025-03-20T08:00:00', endAt: '2025-03-20T12:00:00',
        })).rejects.toThrow(HrConstants.DISABLED);

        const listResult = await wss.listSchedules({});
        expect(listResult.items).toEqual([]);
        expect(listResult.total).toBe(0);

        const leaves = await lrs.list({});
        expect(leaves.items).toEqual([]);
        expect(leaves.total).toBe(0);
      });
    });
  });

  // =========================================================================
  // TR-14.19 ~ TR-14.23
  // =========================================================================
  describe('进阶测试', () => {
    it('TR-14.19 软删除 WorkSchedule 后再 create 同时段 → 不冲突（冲突只看未删除）', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const s = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-25T09:00:00', endAt: '2025-03-25T18:00:00',
        });
        await workScheduleService.deleteSchedule(s.id);

        const s2 = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.FULL,
          startAt: '2025-03-25T09:00:00', endAt: '2025-03-25T18:00:00',
        });
        expect(s2.id).toBeTruthy();
      });
    });

    it('TR-14.20 WorkSchedule.note 和 color 自定义：color=#FF0000 月视图显示红色', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const s = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.CUSTOM,
          startAt: '2025-03-25T09:00:00', endAt: '2025-03-25T14:00:00',
          note: '自定义班次',
          color: '#FF0000',
        });
        expect(s.note).toBe('自定义班次');
        expect(s.color).toBe('#FF0000');

        const cal = await workScheduleService.monthCalendar({ year: 2025, month: 3, userId: TEST_USER_DOCTOR_ID });
        const day = cal.find(d => d.date === '2025-03-25');
        const redSchedule = day?.schedules.find(sch => sch.id === s.id);
        expect(redSchedule?.color).toBe('#FF0000');
      });
    });

    it('TR-14.21 分页 listSchedules from=2025-03, to=2025-04；pageSize=5；总计数', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        // 创建 7 条记录（3 月）
        for (let d = 10; d <= 16; d++) {
          const day = String(d).padStart(2, '0');
          await workScheduleService.createSchedule({
            userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.FULL,
            startAt: `2025-03-${day}T08:00:00`, endAt: `2025-03-${day}T17:30:00`,
          });
        }

        const page1 = await workScheduleService.listSchedules({
          from: '2025-03-01T00:00:00', to: '2025-04-30T23:59:59',
          page: 1, pageSize: 5,
        });
        expect(page1.items.length).toBe(5);
        expect(page1.total).toBe(7);
        expect(page1.pageSize).toBe(5);
        expect(page1.page).toBe(1);

        const page2 = await workScheduleService.listSchedules({
          from: '2025-03-01T00:00:00', to: '2025-04-30T23:59:59',
          page: 2, pageSize: 5,
        });
        expect(page2.items.length).toBe(2);
        expect(page2.total).toBe(7);
      });
    });

    it('TR-14.22 审批权限：非 BOSS 非 admin 的 DOCTOR 调 approve → 抛 PERMISSION_DENIED', async () => {
      const doctorCtx = createClinicContext({ role: ROLES.DOCTOR, userId: TEST_USER_DOCTOR_ID });
      const doctorLrSvc = new LeaveRequestService(dbService, doctorCtx, new AuditLogService(), settingsService);

      // 另一个医生创建并提交请假
      const otherCtx = createClinicContext({ role: ROLES.DOCTOR, userId: TEST_USER_DOCTOR2_ID });
      const otherLrSvc = new LeaveRequestService(dbService, otherCtx, new AuditLogService(), settingsService);
      const lr = await runInClinicContext(otherCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR2_ID, role: ROLES.DOCTOR }, async () => {
        const l = await otherLrSvc.create({
          leaveType: 'SICK',
          startAt: '2025-03-28T00:00:00', endAt: '2025-03-28T23:59:59',
        });
        return await otherLrSvc.submit(l.id);
      });

      // 普通医生无权 approve
      await runInClinicContext(doctorCtx, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_DOCTOR_ID, role: ROLES.DOCTOR }, async () => {
        await expect(doctorLrSvc.approve(lr.id)).rejects.toThrow(HrConstants.PERMISSION_DENIED);
        await expect(doctorLrSvc.reject(lr.id, '不批')).rejects.toThrow(HrConstants.PERMISSION_DENIED);
      });
    });

    it('TR-14.23 重复生成 repeatRule 字段仅存储：值 WEEKLY:2;DAYS=1,3,5 可写入；list 返回原字符串；本任务不自动生成', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_BOSS_ID, role: ROLES.BOSS }, async () => {
        const repeatRule = 'WEEKLY:2;DAYS=1,3,5';
        const s = await workScheduleService.createSchedule({
          userId: TEST_USER_DOCTOR_ID, shiftType: SHIFT_TYPES.MORNING,
          startAt: '2025-03-31T08:00:00', endAt: '2025-03-31T12:00:00',
          repeatRule,
        });
        expect(s.repeatRule).toBe(repeatRule);

        const list = await workScheduleService.listSchedules({
          from: '2025-03-01T00:00:00', to: '2025-03-31T23:59:59',
        });
        const target = list.items.find(i => i.id === s.id);
        expect(target?.repeatRule).toBe(repeatRule);

        // 不自动生成后续日期的排班：3 月份只有 1 条
        const marchTotal = list.items.filter(i => i.repeatRule === repeatRule).length;
        expect(marchTotal).toBe(1);
      });
    });
  });
});
