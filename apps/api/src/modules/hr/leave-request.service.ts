import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../db/db.service';
import { IDatabase } from '../../db/db.interface';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { SettingsService } from '../system/settings/settings.service';
import {
  HrConstants,
  LEAVE_STATUSES,
  SHIFT_TYPES,
  SETTINGS_KEYS,
  LeaveType,
  LeaveStatus,
} from './constants';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ListLeaveRequestDto } from './dto/list-leave-request.dto';
import { TableNames as TN } from '../../common/constants/table-names';
import { AuditLogType } from '../../common/constants/audit-log-types';
import { ROLES } from '@dental/shared';

export interface LeaveRequestEntity {
  id: string;
  userId: string;
  leaveType: LeaveType;
  startAt: string;
  endAt: string;
  totalDays: number;
  reason?: string;
  status: LeaveStatus;
  submittedAt?: string;
  approverId?: string;
  approvedAt?: string;
  rejectReason?: string;
  clinicId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

const ALLOWED_TRANSITIONS: Record<LeaveStatus, LeaveStatus[]> = {
  SAVED: [LEAVE_STATUSES.PENDING, LEAVE_STATUSES.CANCELLED],
  PENDING: [LEAVE_STATUSES.APPROVED, LEAVE_STATUSES.REJECTED, LEAVE_STATUSES.CANCELLED],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

function ceilDaysBetween(startAt: string, endAt: string): number {
  const s = new Date(startAt);
  const e = new Date(endAt);
  const msPerDay = 24 * 60 * 60 * 1000;
  const sDay = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime();
  const eDay = new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime();
  const diffDays = (eDay - sDay) / msPerDay + 1;
  return Math.max(1, Math.ceil(diffDays));
}

@Injectable()
export class LeaveRequestService {
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

  private async checkHrEnabled(writeOp: boolean): Promise<{ enabled: boolean }> {
    const enabled = await this.settingsService.getBoolean(SETTINGS_KEYS.AI_HR_ENABLED, true);
    if (!enabled && writeOp) {
      throw new ForbiddenException(HrConstants.DISABLED);
    }
    return { enabled };
  }

  private canApprove(): boolean {
    const role = this.clinicContext.getRole();
    return role === ROLES.BOSS || role === ROLES.ADMIN;
  }

  private checkTransition(current: LeaveStatus, next: LeaveStatus): boolean {
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  async create(data: CreateLeaveRequestDto): Promise<LeaveRequestEntity> {
    await this.checkHrEnabled(true);

    if (data.startAt > data.endAt) {
      throw new BadRequestException('startAt must be before or equal to endAt');
    }

    const clinicId = this.clinicContext.getClinicId() || '';
    const currentUserId = this.clinicContext.getUserId() || undefined;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const totalDays = ceilDaysBetween(data.startAt, data.endAt);
    const status: LeaveStatus = LEAVE_STATUSES.SAVED;
    const applicantUserId = this.clinicContext.getUserId() || undefined;

    this.dbService.prepare(`
      INSERT INTO ${TN.LEAVE_REQUEST} (id, userId, leaveType, startAt, endAt, totalDays, reason, status, submittedAt, approverId, approvedAt, rejectReason, clinicId, createdBy, createdAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      applicantUserId,
      data.leaveType,
      data.startAt,
      data.endAt,
      totalDays,
      data.reason || null,
      status,
      null,
      null,
      null,
      null,
      clinicId,
      currentUserId || null,
      now,
      now,
    );

    return this.findOne(id) as Promise<LeaveRequestEntity>;
  }

  async submit(id: string): Promise<LeaveRequestEntity> {
    await this.checkHrEnabled(true);
    const clinicId = this.clinicContext.getClinicId() || '';
    const existing = await this.findOne(id);
    if (!existing) {
      throw new BadRequestException('Leave request not found');
    }

    const currentUserId = this.clinicContext.getUserId();
    if (existing.userId !== currentUserId) {
      throw new ForbiddenException(HrConstants.PERMISSION_DENIED);
    }

    if (!this.checkTransition(existing.status, LEAVE_STATUSES.PENDING)) {
      throw new BadRequestException(HrConstants.INVALID_TRANSITION);
    }

    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      db.prepare(`
        UPDATE ${TN.LEAVE_REQUEST}
        SET status = ?, submittedAt = ?, updatedAt = ?
        WHERE id = ? AND clinicId = ?
      `).run(LEAVE_STATUSES.PENDING, now, now, id, clinicId);
      this.logAudit(db, AuditLogType.LEAVE_REQUEST_SUBMITTED, id, TN.LEAVE_REQUEST, {
        status: LEAVE_STATUSES.PENDING,
        submittedAt: now,
      }, existing);
    });

    return this.findOne(id) as Promise<LeaveRequestEntity>;
  }

  async approve(id: string): Promise<LeaveRequestEntity> {
    await this.checkHrEnabled(true);
    const clinicId = this.clinicContext.getClinicId() || '';

    if (!this.canApprove()) {
      throw new ForbiddenException(HrConstants.PERMISSION_DENIED);
    }

    const existing = await this.findOne(id);
    if (!existing) {
      throw new BadRequestException('Leave request not found');
    }

    if (!this.checkTransition(existing.status, LEAVE_STATUSES.APPROVED)) {
      throw new BadRequestException(HrConstants.INVALID_TRANSITION);
    }

    const approverId = this.clinicContext.getUserId() || undefined;
    const now = new Date().toISOString();

    this.dbService.transaction((db) => {
      db.prepare(`
        UPDATE ${TN.LEAVE_REQUEST}
        SET status = ?, approverId = ?, approvedAt = ?, updatedAt = ?
        WHERE id = ? AND clinicId = ?
      `).run(LEAVE_STATUSES.APPROVED, approverId || null, now, now, id, clinicId);

      const wsId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO ${TN.WORK_SCHEDULE} (id, userId, shiftType, startAt, endAt, note, repeatRule, color, clinicId, createdBy, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        wsId,
        existing.userId,
        SHIFT_TYPES.LEAVE,
        existing.startAt,
        existing.endAt,
        `LeaveRequest:${id}`,
        null,
        '#F97316',
        clinicId,
        approverId || null,
        now,
        now,
      );

      this.logAudit(db, AuditLogType.LEAVE_REQUEST_APPROVED, id, TN.LEAVE_REQUEST, {
        status: LEAVE_STATUSES.APPROVED,
        approverId,
        approvedAt: now,
        workScheduleId: wsId,
      }, existing);
    });

    return this.findOne(id) as Promise<LeaveRequestEntity>;
  }

  async reject(id: string, rejectReason: string): Promise<LeaveRequestEntity> {
    await this.checkHrEnabled(true);
    const clinicId = this.clinicContext.getClinicId() || '';

    if (!this.canApprove()) {
      throw new ForbiddenException(HrConstants.PERMISSION_DENIED);
    }

    if (!rejectReason || rejectReason.trim().length === 0) {
      throw new BadRequestException(HrConstants.REJECT_REASON_REQUIRED);
    }

    const existing = await this.findOne(id);
    if (!existing) {
      throw new BadRequestException('Leave request not found');
    }

    if (!this.checkTransition(existing.status, LEAVE_STATUSES.REJECTED)) {
      throw new BadRequestException(HrConstants.INVALID_TRANSITION);
    }

    const approverId = this.clinicContext.getUserId() || undefined;
    const now = new Date().toISOString();

    this.dbService.transaction((db) => {
      db.prepare(`
        UPDATE ${TN.LEAVE_REQUEST}
        SET status = ?, approverId = ?, approvedAt = ?, rejectReason = ?, updatedAt = ?
        WHERE id = ? AND clinicId = ?
      `).run(LEAVE_STATUSES.REJECTED, approverId || null, now, rejectReason, now, id, clinicId);
      this.logAudit(db, AuditLogType.LEAVE_REQUEST_REJECTED, id, TN.LEAVE_REQUEST, {
        status: LEAVE_STATUSES.REJECTED,
        approverId,
        rejectReason,
      }, existing);
    });

    return this.findOne(id) as Promise<LeaveRequestEntity>;
  }

  async cancel(id: string): Promise<LeaveRequestEntity> {
    await this.checkHrEnabled(true);
    const clinicId = this.clinicContext.getClinicId() || '';
    const currentUserId = this.clinicContext.getUserId();

    const existing = await this.findOne(id);
    if (!existing) {
      throw new BadRequestException('Leave request not found');
    }

    if (existing.userId !== currentUserId) {
      throw new ForbiddenException(HrConstants.PERMISSION_DENIED);
    }

    if (!this.checkTransition(existing.status, LEAVE_STATUSES.CANCELLED)) {
      throw new BadRequestException(HrConstants.INVALID_TRANSITION);
    }

    const now = new Date().toISOString();
    this.dbService.prepare(`
      UPDATE ${TN.LEAVE_REQUEST}
      SET status = ?, updatedAt = ?
      WHERE id = ? AND clinicId = ?
    `).run(LEAVE_STATUSES.CANCELLED, now, id, clinicId);

    return this.findOne(id) as Promise<LeaveRequestEntity>;
  }

  async list(query: ListLeaveRequestDto) {
    const { enabled } = await this.checkHrEnabled(false);
    const clinicId = this.clinicContext.getClinicId() || '';
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    if (!enabled) {
      return { items: [], total: 0, page, pageSize };
    }

    const role = this.clinicContext.getRole();
    const currentUserId = this.clinicContext.getUserId();
    const isBossOrAdmin = role === ROLES.BOSS || role === ROLES.ADMIN;

    const wheres: string[] = ['lr.deletedAt IS NULL', 'lr.clinicId = ?'];
    const params: unknown[] = [clinicId];

    if (!isBossOrAdmin) {
      wheres.push('lr.userId = ?');
      params.push(currentUserId || '');
    } else if (query.userId) {
      wheres.push('lr.userId = ?');
      params.push(query.userId);
    }

    if (query.status) {
      wheres.push('lr.status = ?');
      params.push(query.status);
    }
    if (query.from) {
      wheres.push('lr.endAt >= ?');
      params.push(query.from);
    }
    if (query.to) {
      wheres.push('lr.startAt <= ?');
      params.push(query.to);
    }

    const whereSql = `WHERE ${wheres.join(' AND ')}`;
    const items = this.dbService.prepare(`
      SELECT lr.id, lr.userId, lr.leaveType, lr.startAt, lr.endAt, lr.totalDays, lr.reason,
             lr.status, lr.submittedAt, lr.approverId, lr.approvedAt, lr.rejectReason,
             lr.createdAt, lr.updatedAt
      FROM ${TN.LEAVE_REQUEST} lr
      ${whereSql}
      ORDER BY lr.createdAt DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize) as LeaveRequestEntity[];

    const total = (this.dbService.prepare(`SELECT COUNT(*) as count FROM ${TN.LEAVE_REQUEST} lr ${whereSql}`).get(...params) as { count: number }).count;

    return { items, total, page, pageSize };
  }

  async findOne(id: string): Promise<LeaveRequestEntity | undefined> {
    const clinicId = this.clinicContext.getClinicId() || '';
    return this.dbService.prepare(`
      SELECT lr.id, lr.userId, lr.leaveType, lr.startAt, lr.endAt, lr.totalDays, lr.reason,
             lr.status, lr.submittedAt, lr.approverId, lr.approvedAt, lr.rejectReason,
             lr.clinicId, lr.createdBy, lr.createdAt, lr.updatedAt, lr.deletedAt
      FROM ${TN.LEAVE_REQUEST} lr
      WHERE id = ? AND clinicId = ? AND deletedAt IS NULL
    `).get(id, clinicId) as LeaveRequestEntity | undefined;
  }
}
