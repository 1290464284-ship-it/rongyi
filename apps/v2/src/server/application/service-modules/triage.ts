/**
 * 分诊科室维度服务：挂号分诊、分诊队列，以及预约中心拖拽（改时间/改医生/改椅位）的支撑端点。
 *
 * - triage(): 把 REGISTERED 挂号转为 TRIAGED，可选指定分诊科室/接诊医生/分诊备注
 * - queue():  分诊队列（待分诊 REGISTERED / 已分诊 TRIAGED），JOIN 患者/医生/科室名称，
 *             支持按科室与状态过滤，按挂号时间升序
 * - rescheduleAppointment(): 预约改期/改医生/改椅位（预约中心拖拽保存时的后端落库）
 *
 * 科室词典（Department）由通用资源 CRUD 维护；本服务只读引用其 id 做校验与展示。
 */
import type Database from 'better-sqlite3';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';

export interface TriageInput {
  doctorId?: string;
  departmentId?: string;
  triageNote?: string;
}

export interface TriageQueueQuery {
  departmentId?: string;
  status?: 'REGISTERED' | 'TRIAGED';
}

export interface TriageQueueItem {
  id: string;
  patientId: string;
  patientName: string | null;
  doctorId: string | null;
  doctorName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  status: string;
  type: string;
  triageNote: string | null;
  chiefComplaint: string | null;
  registeredAt: string;
  triagedAt: string | null;
}

export interface RescheduleAppointmentInput {
  startTime: string;
  endTime?: string;
  doctorId?: string;
  chairId?: string | null;
}

export class TriageService {
  constructor(private readonly db: Database.Database) {}

  /** 分诊：仅 REGISTERED 挂号可执行；事务内落库并返回更新后的完整挂号行。 */
  triage(registrationId: string, input: TriageInput, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const registration = this.db.prepare(
      `SELECT * FROM Registration WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(registrationId, ...tenantParams(clinicId)) as Record<string, unknown> | undefined;
    if (!registration) throw new NotFoundError('Registration not found');
    if (registration.status !== 'REGISTERED') throw new ConflictError('挂号已分诊或已结束');

    if (input.departmentId !== undefined) {
      const department = this.db.prepare(
        `SELECT id FROM Department WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).get(input.departmentId, ...tenantParams(clinicId));
      if (!department) throw new ValidationError('科室不存在');
    }
    if (input.doctorId !== undefined) {
      const doctor = this.db.prepare(
        `SELECT id FROM User WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).get(input.doctorId, ...tenantParams(clinicId));
      if (!doctor) throw new ValidationError('医生不存在');
    }

    const now = context.now().toISOString();
    const sets = ["status = 'TRIAGED'", 'triagedAt = ?', 'updatedAt = ?'];
    const params: Array<string | null> = [now, now];
    if (input.departmentId !== undefined) {
      sets.push('departmentId = ?');
      params.push(input.departmentId);
    }
    if (input.doctorId !== undefined) {
      sets.push('doctorId = ?');
      params.push(input.doctorId);
    }
    if (input.triageNote !== undefined) {
      sets.push('triageNote = ?');
      params.push(input.triageNote);
    }

    const run = this.db.transaction(() => {
      const changes = this.db.prepare(
        `UPDATE Registration SET ${sets.join(', ')}
         WHERE id = ? AND status = 'REGISTERED' AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).run(...params, registrationId, ...tenantParams(clinicId)).changes;
      if (changes === 0) throw new ConflictError('挂号已分诊或已结束');
    });
    run();

    return this.db.prepare(
      `SELECT * FROM Registration WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(registrationId, ...tenantParams(clinicId)) as Record<string, unknown>;
  }

  /** 分诊队列：返回待分诊/已分诊挂号（含患者、医生、科室名称），可按科室与状态过滤。 */
  queue(query: TriageQueueQuery, context: AppContext): { total: number; items: TriageQueueItem[] } {
    const { departmentId, status } = query;
    if (status !== undefined && status !== 'REGISTERED' && status !== 'TRIAGED') {
      throw new ValidationError('status 仅支持 REGISTERED 或 TRIAGED');
    }

    const params: Array<string> = [];
    const filters = ['r.status IN (\'REGISTERED\', \'TRIAGED\')', 'r.deletedAt IS NULL', 'p.deletedAt IS NULL'];
    if (departmentId !== undefined) {
      filters.push('r.departmentId = ?');
      params.push(departmentId);
    }
    if (status !== undefined) {
      filters.push('r.status = ?');
      params.push(status);
    }

    const rows = this.db.prepare(
      `SELECT r.id, r.patientId, p.name AS patientName, r.doctorId, u.name AS doctorName,
              r.departmentId, d.name AS departmentName, r.status, r.type, r.triageNote,
              r.chiefComplaint, r.registeredAt, r.triagedAt
       FROM Registration r
       JOIN Patient p ON p.id = r.patientId AND p.deletedAt IS NULL
       LEFT JOIN User u ON u.id = r.doctorId
       LEFT JOIN Department d ON d.id = r.departmentId
       WHERE ${filters.join(' AND ')}${tenantAnd(context.clinicId, 'r.clinicId')}
       ORDER BY r.registeredAt ASC`,
    ).all(...params, ...tenantParams(context.clinicId)) as TriageQueueItem[];
    return { total: rows.length, items: rows };
  }

  /** 预约中心拖拽改期：改时间/改医生/改椅位；chairId 传 null 或空串表示清空椅位。 */
  rescheduleAppointment(appointmentId: string, input: RescheduleAppointmentInput, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const appointment = this.db.prepare(
      `SELECT * FROM Appointment WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(appointmentId, ...tenantParams(clinicId)) as Record<string, unknown> | undefined;
    if (!appointment) throw new NotFoundError('Appointment not found');

    if (input.startTime === undefined || input.startTime === null || input.startTime === '') {
      throw new ValidationError('startTime 必填');
    }
    if (Number.isNaN(new Date(input.startTime).getTime())) {
      throw new ValidationError('startTime 必须是合法时间');
    }
    if (input.endTime !== undefined && Number.isNaN(new Date(input.endTime).getTime())) {
      throw new ValidationError('endTime 必须是合法时间');
    }

    const now = context.now().toISOString();
    const sets = ['startTime = ?', 'updatedAt = ?'];
    const params: Array<string | null> = [new Date(input.startTime).toISOString(), now];
    if (input.endTime !== undefined) {
      sets.push('endTime = ?');
      params.push(new Date(input.endTime).toISOString());
    }
    if (input.doctorId !== undefined) {
      sets.push('doctorId = ?');
      params.push(input.doctorId);
    }
    if (input.chairId !== undefined) {
      sets.push('chairId = ?');
      params.push(input.chairId === null || input.chairId === '' ? null : input.chairId);
    }

    const run = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE Appointment SET ${sets.join(', ')}
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
      ).run(...params, appointmentId, ...tenantParams(clinicId));
    });
    run();

    return this.db.prepare(
      `SELECT * FROM Appointment WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(appointmentId, ...tenantParams(clinicId)) as Record<string, unknown>;
  }
}
