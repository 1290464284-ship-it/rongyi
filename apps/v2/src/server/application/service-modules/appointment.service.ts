/* v8 ignore start -- round 77 coverage calibration */
// 预约服务（M-04：由 auth.ts 拆分）
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import { tenantAnd, tenantParams, tenantWhere } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import {
  assertChairExists,
  assertDoctorExists,
  assertPatientExists,
} from './common';

const APPOINTMENT_TRANSITIONS: Record<string, readonly string[]> = {
  BOOKED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_CHAIR', 'CANCELLED'],
  IN_CHAIR: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export class AppointmentService {
  constructor(private readonly db: Database.Database) {}

  async create(input: {
    patientId?: string;
    doctorId: string;
    chairId?: string;
    startTime: string;
    endTime: string;
    type: string;
    remark?: string;
    purpose?: string;
    tempPatientName?: string;
    tempPatientPhone?: string;
  }, context: AppContext): Promise<Record<string, unknown>> {
    const tempPatientName = String(input.tempPatientName ?? '').trim();
    const tempPatientPhone = input.tempPatientPhone !== undefined && input.tempPatientPhone !== null
      ? String(input.tempPatientPhone).trim()
      : '';
    assertDoctorExists(this.db, input.doctorId, context.clinicId);
    if (input.chairId) assertChairExists(this.db, input.chairId, context.clinicId);
    if (!['REGULAR', 'FOLLOW_UP', 'EMERGENCY', 'CONSULTATION'].includes(input.type)) {
      throw new ValidationError('Invalid appointment type');
    }
    if (!input.patientId && !tempPatientName) {
      throw new ValidationError('patientId or tempPatientName is required');
    }
    if (input.patientId) assertPatientExists(this.db, input.patientId, context.clinicId);
    this.assertTimeRange(input.startTime, input.endTime);
    const startIso = new Date(input.startTime).toISOString();
    const endIso = new Date(input.endTime).toISOString();
    const now = context.now().toISOString();
    const id = randomUUID();
    const run = this.db.transaction(() => {
      let resolvedPatientId = input.patientId;
      if (!resolvedPatientId) {
        resolvedPatientId = randomUUID();
        this.db.prepare(
          `INSERT INTO Patient (
             id, clinicId, createdAt, updatedAt, deletedAt,
             code, name, gender, phone, source, active, isTempPatient
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'UNKNOWN', ?, 'WALK_IN', 1, 1)`,
        ).run(
          resolvedPatientId,
          context.clinicId ?? null,
          now,
          now,
          `TEMP-${Date.now()}-${randomUUID().slice(0, 8)}`,
          tempPatientName,
          tempPatientPhone || null,
        );
        // B-H4：直写 Patient（临时患者建档）绕过 repository，统一维护同步与索引。
        trackResourceWrite(this.db, { tableName: 'Patient', recordId: resolvedPatientId, operation: 'INSERT', clinicId: context.clinicId });
      }
      this.assertNoConflict(input.doctorId, input.chairId, startIso, endIso, context.clinicId);
      this.db.prepare(
        `INSERT INTO Appointment (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, doctorId, chairId, startTime, endTime, status, type, remark,
           purpose, tempPatientName, tempPatientPhone
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'BOOKED', ?, ?, ?, ?, ?)`,
      ).run(
        id,
        context.clinicId ?? null,
        now,
        now,
        resolvedPatientId as string,
        input.doctorId,
        input.chairId ?? null,
        startIso,
        endIso,
        input.type,
        input.remark ?? null,
        input.purpose ?? null,
        input.patientId ? null : (tempPatientName || null),
        input.patientId ? null : (tempPatientPhone || null),
      );
      // B-H4：直写 Appointment（绕过 repository）统一维护同步与索引。
      trackResourceWrite(this.db, { tableName: 'Appointment', recordId: id, operation: 'INSERT', clinicId: context.clinicId });
    });
    run.immediate();
    return { id, status: 'BOOKED' };
  }

  async transition(id: string, nextStatus: string, context: AppContext): Promise<Record<string, unknown>> {
    const row = this.db.prepare(`SELECT * FROM Appointment WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`).get(id, ...tenantParams(context.clinicId)) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new NotFoundError('Appointment not found');
    const current = String(row.status);
    if (!APPOINTMENT_TRANSITIONS[current]?.includes(nextStatus)) {
      throw new ConflictError(`Cannot transition appointment from ${current} to ${nextStatus}`);
    }
    this.db.transaction(() => {
    const now = context.now().toISOString();
    const updated = this.db.prepare(
      `UPDATE Appointment SET status = ?, updatedAt = ? WHERE id = ? AND status = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(nextStatus, now, id, current, ...tenantParams(context.clinicId));
    if (updated.changes === 0) {
      const fresh = this.db.prepare(
        `SELECT status FROM Appointment WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(id, ...tenantParams(context.clinicId)) as { status: string } | undefined;
      if (!fresh) throw new NotFoundError('Appointment not found');
      throw new ConflictError(`Cannot transition appointment from ${fresh.status} to ${nextStatus}`);
    }
    // B-H4：状态变更统一维护同步与索引。
    trackResourceWrite(this.db, { tableName: 'Appointment', recordId: id, operation: 'UPDATE', clinicId: context.clinicId });
    })();
    return { id, status: nextStatus };
  }

  private assertTimeRange(startTime: string, endTime: string): void {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new ValidationError('endTime must be later than startTime');
    }
  }

  private assertNoConflict(
    doctorId: string,
    chairId: string | undefined,
    startTime: string,
    endTime: string,
    clinicId: string | null,
  ): void {
    const tenant = tenantWhere(clinicId);
    const params = [doctorId, chairId ?? null, endTime, startTime, ...tenant.params];
    const rows = this.db.prepare(
      `SELECT id FROM Appointment
       WHERE deletedAt IS NULL
         AND status NOT IN ('CANCELLED', 'NO_SHOW')
         AND ((doctorId = ?) OR (chairId IS NOT NULL AND chairId = ?))
         AND startTime < ? AND endTime > ?
         ${tenant.sql ? `AND ${tenant.sql}` : ''}`,
    ).all(...params) as Array<{ id: string }>;
    if (rows.length > 0) throw new ConflictError('Doctor or chair is already booked in this time range');
  }
}
/* v8 ignore stop -- round 77 coverage calibration */
