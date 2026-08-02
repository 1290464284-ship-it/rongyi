import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../db/db.service';
import { IDatabase } from '../../db/db.interface';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { SettingsService } from '../system/settings/settings.service';
import {
  HrConstants,
  SHIFT_TYPES,
  DEFAULT_SHIFT_TIMES,
  SETTINGS_KEYS,
  ShiftType,
  AttendanceStatus,
} from './constants';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';
import { ListScheduleDto } from './dto/list-schedule.dto';
import { MonthCalendarDto } from './dto/month-calendar.dto';
import { AttendanceStatsDto } from './dto/attendance-stats.dto';
import { AuditLogType } from '../../common/constants/audit-log-types';
import { TableNames as TN } from '../../common/constants/table-names';

function hashColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const r = (hash & 0xff0000) >> 16;
  const g = (hash & 0x00ff00) >> 8;
  const b = hash & 0x0000ff;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function applyDefaultShiftTime(
  shiftType: ShiftType,
  startAt: string,
  endAt: string,
  shiftTimesFromSettings: Record<string, [string, string]>,
): { startAt: string; endAt: string } {
  if (shiftType === SHIFT_TYPES.CUSTOM || shiftType === SHIFT_TYPES.LEAVE || shiftType === SHIFT_TYPES.OFF) {
    return { startAt, endAt };
  }
  const times = shiftTimesFromSettings[shiftType];
  if (!times) {
    return { startAt, endAt };
  }
  const [startHm, endHm] = times;
  const startDate = startAt.slice(0, 10);
  const endDate = endAt.slice(0, 10);
  return {
    startAt: `${startDate}T${startHm}:00`,
    endAt: `${endDate}T${endHm}:00`,
  };
}

export interface WorkScheduleEntity {
  id: string;
  userId: string;
  shiftType: ShiftType;
  startAt: string;
  endAt: string;
  note?: string;
  repeatRule?: string;
  color?: string;
  clinicId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface DailyAttendance {
  date: string;
  status: AttendanceStatus;
  reason?: string;
}

export interface AttendanceStatsResult {
  daysPresent: number;
  daysAbsent: number;
  daysLeave: number;
  daysOff: number;
  listDaily: DailyAttendance[];
}

export interface MonthCalendarDay {
  date: string;
  schedules: Array<{
    id: string;
    userId: string;
    shiftType: ShiftType;
    startAt: string;
    endAt: string;
    color: string;
    note?: string;
  }>;
  leaveMarks: Array<{
    userId: string;
    leaveType: string;
  }>;
}

@Injectable()
export class WorkScheduleService {
  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private auditLogService: AuditLogService,
    private settingsService: SettingsService,
  ) {}

  private logAudit(db: IDatabase, type: string, targetId: string, targetType: string, afterData?: unknown, beforeData?: unknown) {
    const clinicId = this.clinicContext.getClinicId();
    const userId = this.clinicContext.getUserId();
    this.auditLogService.logAudit(db, type, targetId, targetType, clinicId, {
      beforeData,
      afterData,
      operatorId: userId || undefined,
    });
  }

  private async checkHrEnabled(writeOp: boolean): Promise<{ enabled: boolean; defaultShiftTimes: Record<string, [string, string]> }> {
    const enabled = await this.settingsService.getBoolean(SETTINGS_KEYS.AI_HR_ENABLED, true);
    const defTimesStr = await this.settingsService.get(SETTINGS_KEYS.AI_HR_DEFAULT_SHIFT_TIMES);
    let defaultShiftTimes = { ...DEFAULT_SHIFT_TIMES };
    if (defTimesStr) {
      try {
        const parsed = JSON.parse(defTimesStr);
        defaultShiftTimes = { ...defaultShiftTimes, ...parsed };
      } catch {
        // ignore parse error, use default
      }
    }
    if (!enabled && writeOp) {
      throw new ForbiddenException(HrConstants.DISABLED);
    }
    return { enabled, defaultShiftTimes };
  }

  private hasOverlap(
    aStart: string, aEnd: string, bStart: string, bEnd: string,
  ): boolean {
    return aStart < bEnd && aEnd > bStart;
  }

  async createSchedule(data: CreateWorkScheduleDto): Promise<WorkScheduleEntity> {
    const { defaultShiftTimes } = await this.checkHrEnabled(true);

    const { startAt, endAt } = applyDefaultShiftTime(data.shiftType, data.startAt, data.endAt, defaultShiftTimes);

    if (startAt >= endAt) {
      throw new BadRequestException('startAt must be before endAt');
    }

    const clinicId = this.clinicContext.getClinicId() || '';
    const userId = this.clinicContext.getUserId() || undefined;

    const conflict = this.dbService.prepare(`
      SELECT id FROM ${TN.WORK_SCHEDULE}
      WHERE userId = ? AND clinicId = ? AND deletedAt IS NULL
        AND startAt < ? AND endAt > ?
      LIMIT 1
    `).get(data.userId, clinicId, endAt, startAt);

    if (conflict) {
      throw new BadRequestException(HrConstants.SCHEDULE_CONFLICT);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const color = data.color || '#4F46E5';

    this.dbService.transaction((db) => {
      db.prepare(`
        INSERT INTO ${TN.WORK_SCHEDULE} (id, userId, shiftType, startAt, endAt, note, repeatRule, color, clinicId, createdBy, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id,
        data.userId,
        data.shiftType,
        startAt,
        endAt,
        data.note || null,
        data.repeatRule || null,
        color,
        clinicId,
        userId || null,
        now,
        now,
      );
      this.logAudit(db, AuditLogType.WORK_SCHEDULE_CREATED, id, TN.WORK_SCHEDULE, {
        userId: data.userId,
        shiftType: data.shiftType,
        startAt,
        endAt,
      });
    });

    return this.findOne(id) as Promise<WorkScheduleEntity>;
  }

  async updateSchedule(id: string, data: UpdateWorkScheduleDto): Promise<WorkScheduleEntity> {
    const { defaultShiftTimes } = await this.checkHrEnabled(true);
    const clinicId = this.clinicContext.getClinicId() || '';

    const existing = await this.findOne(id);
    if (!existing) {
      throw new BadRequestException('Schedule not found');
    }

    const newStartAt = data.startAt ?? existing.startAt;
    const newEndAt = data.endAt ?? existing.endAt;
    const newShiftType = data.shiftType ?? existing.shiftType;
    const { startAt, endAt } = applyDefaultShiftTime(newShiftType, newStartAt, newEndAt, defaultShiftTimes);

    if (startAt >= endAt) {
      throw new BadRequestException('startAt must be before endAt');
    }

    const newUserId = data.userId ?? existing.userId;
    const conflict = this.dbService.prepare(`
      SELECT id FROM ${TN.WORK_SCHEDULE}
      WHERE userId = ? AND clinicId = ? AND deletedAt IS NULL AND id != ?
        AND startAt < ? AND endAt > ?
      LIMIT 1
    `).get(newUserId, clinicId, id, endAt, startAt);

    if (conflict) {
      throw new BadRequestException(HrConstants.SCHEDULE_CONFLICT);
    }

    const now = new Date().toISOString();
    const _userId = this.clinicContext.getUserId() || undefined;
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.userId !== undefined) { updates.push('userId = ?'); params.push(data.userId); }
    if (data.shiftType !== undefined) { updates.push('shiftType = ?'); params.push(data.shiftType); }
    if (data.startAt !== undefined || data.endAt !== undefined || data.shiftType !== undefined) {
      updates.push('startAt = ?'); params.push(startAt);
      updates.push('endAt = ?'); params.push(endAt);
    }
    if (data.note !== undefined) { updates.push('note = ?'); params.push(data.note || null); }
    if (data.repeatRule !== undefined) { updates.push('repeatRule = ?'); params.push(data.repeatRule || null); }
    if (data.color !== undefined) { updates.push('color = ?'); params.push(data.color || '#4F46E5'); }

    updates.push('updatedAt = ?');
    params.push(now, id, clinicId);

    if (updates.length > 0) {
      this.dbService.transaction((db) => {
        db.prepare(`UPDATE ${TN.WORK_SCHEDULE} SET ${updates.join(', ')} WHERE id = ? AND clinicId = ?`).run(...params);
        this.logAudit(db, AuditLogType.WORK_SCHEDULE_UPDATED, id, TN.WORK_SCHEDULE, {
          userId: data.userId,
          shiftType: data.shiftType,
          startAt,
          endAt,
          note: data.note,
          repeatRule: data.repeatRule,
          color: data.color,
        }, existing);
      });
    }

    return this.findOne(id) as Promise<WorkScheduleEntity>;
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.checkHrEnabled(true);
    const clinicId = this.clinicContext.getClinicId() || '';
    const existing = await this.findOne(id);
    if (!existing) {
      throw new BadRequestException('Schedule not found');
    }
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      db.prepare(`UPDATE ${TN.WORK_SCHEDULE} SET deletedAt = ?, updatedAt = ? WHERE id = ? AND clinicId = ?`).run(now, now, id, clinicId);
      this.logAudit(db, AuditLogType.WORK_SCHEDULE_DELETED, id, TN.WORK_SCHEDULE, undefined, existing);
    });
  }

  async listSchedules(query: ListScheduleDto) {
    const { enabled } = await this.checkHrEnabled(false);
    const clinicId = this.clinicContext.getClinicId() || '';
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    if (!enabled) {
      return { items: [], total: 0, page, pageSize };
    }

    const wheres: string[] = ['deletedAt IS NULL', 'clinicId = ?'];
    const params: unknown[] = [clinicId];

    if (query.userId) {
      wheres.push('userId = ?');
      params.push(query.userId);
    }
    if (query.from) {
      wheres.push('endAt >= ?');
      params.push(query.from);
    }
    if (query.to) {
      wheres.push('startAt <= ?');
      params.push(query.to);
    }

    const whereSql = `WHERE ${wheres.join(' AND ')}`;
    const items = this.dbService.prepare(`
      SELECT id, userId, shiftType, startAt, endAt, note, repeatRule, color, createdAt, updatedAt
      FROM ${TN.WORK_SCHEDULE}
      ${whereSql}
      ORDER BY startAt ASC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize) as WorkScheduleEntity[];

    const total = (this.dbService.prepare(`SELECT COUNT(*) as count FROM ${TN.WORK_SCHEDULE} ${whereSql}`).get(...params) as { count: number }).count;

    return { items, total, page, pageSize };
  }

  async findOne(id: string): Promise<WorkScheduleEntity | undefined> {
    const clinicId = this.clinicContext.getClinicId() || '';
    return this.dbService.prepare(`
      SELECT id, userId, shiftType, startAt, endAt, note, repeatRule, color, clinicId, createdBy, createdAt, updatedAt, deletedAt
      FROM ${TN.WORK_SCHEDULE}
      WHERE id = ? AND clinicId = ? AND deletedAt IS NULL
    `).get(id, clinicId) as WorkScheduleEntity | undefined;
  }

  async monthCalendar(query: MonthCalendarDto): Promise<MonthCalendarDay[]> {
    const { year, month, userId } = query;
    const clinicId = this.clinicContext.getClinicId() || '';

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getDate();
    const endDate = new Date(Date.UTC(year, month - 1, daysInMonth, 23, 59, 59, 999));

    const startAt = startDate.toISOString();
    const endAt = endDate.toISOString();

    const whereParts: string[] = ['ws.clinicId = ?', 'ws.deletedAt IS NULL', 'ws.startAt <= ?', 'ws.endAt >= ?'];
    const params: unknown[] = [clinicId, endAt, startAt];

    if (userId) {
      whereParts.push('ws.userId = ?');
      params.push(userId);
    }

    const schedules = this.dbService.prepare(`
      SELECT ws.id, ws.userId, ws.shiftType, ws.startAt, ws.endAt, ws.color, ws.note
      FROM ${TN.WORK_SCHEDULE} ws
      WHERE ${whereParts.join(' AND ')}
      ORDER BY ws.startAt ASC
    `).all(...params) as WorkScheduleEntity[];

    const leaveWhereParts: string[] = ['lr.clinicId = ?', 'lr.deletedAt IS NULL', 'lr.status = ?', 'lr.startAt <= ?', 'lr.endAt >= ?'];
    const leaveParams: unknown[] = [clinicId, 'APPROVED', endAt, startAt];
    if (userId) {
      leaveWhereParts.push('lr.userId = ?');
      leaveParams.push(userId);
    }
    const leaves = this.dbService.prepare(`
      SELECT lr.id, lr.userId, lr.leaveType, lr.startAt, lr.endAt
      FROM ${TN.LEAVE_REQUEST} lr
      WHERE ${leaveWhereParts.join(' AND ')}
    `).all(...leaveParams) as Array<{ id: string; userId: string; leaveType: string; startAt: string; endAt: string }>;

    const result: MonthCalendarDay[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayStart = `${dateStr}T00:00:00`;
      const dayEnd = `${dateStr}T23:59:59`;

      const daySchedules: MonthCalendarDay['schedules'] = [];
      for (const s of schedules) {
        if (this.hasOverlap(s.startAt, s.endAt, dayStart, dayEnd)) {
          const scheduleColor = (s.color && s.color !== '#4F46E5') ? s.color : hashColor(s.userId);
          daySchedules.push({
            id: s.id,
            userId: s.userId,
            shiftType: s.shiftType,
            startAt: s.startAt,
            endAt: s.endAt,
            color: s.color || scheduleColor,
            note: s.note,
          });
        }
      }

      const dayLeaves: MonthCalendarDay['leaveMarks'] = [];
      for (const l of leaves) {
        if (this.hasOverlap(l.startAt, l.endAt, dayStart, dayEnd)) {
          dayLeaves.push({ userId: l.userId, leaveType: l.leaveType });
        }
      }

      result.push({ date: dateStr, schedules: daySchedules, leaveMarks: dayLeaves });
    }

    return result;
  }

  async attendanceStats(query: AttendanceStatsDto): Promise<AttendanceStatsResult & { userId?: string }> {
    const { from, to, userId } = query;
    const clinicId = this.clinicContext.getClinicId() || '';
    const listDaily: DailyAttendance[] = [];

    const startDate = new Date(from);
    const endDate = new Date(to);
    const msPerDay = 24 * 60 * 60 * 1000;
    const sDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
    const eDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
    const totalDays = Math.max(1, Math.round((eDay - sDay) / msPerDay) + 1);

    const userIds: string[] = [];
    if (userId) {
      userIds.push(userId);
    } else {
      const users = this.dbService.prepare(`
        SELECT DISTINCT u.id FROM User u
        WHERE u.clinicId = ? AND u.deletedAt IS NULL AND u.active = 1
      `).all(clinicId) as Array<{ id: string }>;
      for (const u of users) userIds.push(u.id);
    }

    let daysPresent = 0;
    let daysAbsent = 0;
    let daysLeave = 0;
    let daysOff = 0;

    for (let i = 0; i < totalDays; i++) {
      const cur = new Date(sDay + i * msPerDay);
      const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const dayStart = `${dateStr}T00:00:00`;
      const dayEnd = `${dateStr}T23:59:59`;
      const nextDay = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate() + 1).padStart(2, '0')}T00:00:00`;

      for (const uid of userIds) {
        const approvedLeave = this.dbService.prepare(`
          SELECT id FROM ${TN.LEAVE_REQUEST}
          WHERE userId = ? AND clinicId = ? AND deletedAt IS NULL AND status = 'APPROVED'
            AND startAt <= ? AND endAt >= ?
          LIMIT 1
        `).get(uid, clinicId, dayEnd, dayStart);

        if (approvedLeave) {
          daysLeave++;
          listDaily.push({ date: dateStr, status: 'LEAVE', reason: 'LeaveRequest approved' });
          continue;
        }

        const schedule = this.dbService.prepare(`
          SELECT id, shiftType FROM ${TN.WORK_SCHEDULE}
          WHERE userId = ? AND clinicId = ? AND deletedAt IS NULL
            AND startAt < ? AND endAt > ?
          LIMIT 1
        `).get(uid, clinicId, nextDay, dayStart) as WorkScheduleEntity | undefined;

        if (!schedule || schedule.shiftType === SHIFT_TYPES.OFF) {
          daysOff++;
          listDaily.push({ date: dateStr, status: 'OFF', reason: schedule ? 'Schedule OFF' : 'No schedule' });
          continue;
        }

        if (schedule.shiftType === SHIFT_TYPES.LEAVE) {
          daysLeave++;
          listDaily.push({ date: dateStr, status: 'LEAVE', reason: 'WorkSchedule LEAVE' });
          continue;
        }

        const hasVisit = this.dbService.prepare(`
          SELECT id FROM ${TN.VISIT}
          WHERE doctorId = ? AND clinicId = ? AND deletedAt IS NULL
            AND endTime IS NOT NULL AND endTime >= ? AND endTime < ?
          LIMIT 1
        `).get(uid, clinicId, dayStart, nextDay);

        const hasAppointment = this.dbService.prepare(`
          SELECT id FROM ${TN.APPOINTMENT}
          WHERE doctorId = ? AND clinicId = ? AND deletedAt IS NULL
            AND status IN ('COMPLETED','CHECKED_IN','RESCHEDULED','ARRIVED','IN_CHAIR','BOOKED')
            AND startTime >= ? AND startTime < ?
          LIMIT 1
        `).get(uid, clinicId, dayStart, nextDay);

        if (hasVisit || hasAppointment) {
          daysPresent++;
          listDaily.push({ date: dateStr, status: 'PRESENT', reason: hasVisit ? 'Visit completed' : 'Appointment present' });
        } else {
          daysAbsent++;
          listDaily.push({ date: dateStr, status: 'ABSENT', reason: 'Scheduled but no visit/appointment' });
        }
      }
    }

    return {
      daysPresent,
      daysAbsent,
      daysLeave,
      daysOff,
      listDaily,
      userId: userId || undefined,
    };
  }
}
