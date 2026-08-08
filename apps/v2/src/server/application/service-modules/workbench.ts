import type Database from 'better-sqlite3';
import { SystemClock } from '../../infrastructure/clock';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

interface WorkbenchRegistration {
  id: string;
  patientId: string;
  patientName: string | null;
  doctorId: string | null;
  doctorName: string | null;
  status: string | null;
  registeredAt: string | null;
  chiefComplaint: string | null;
  visitId: string | null;
}

interface WorkbenchAppointment {
  id: string;
  patientId: string;
  patientName: string | null;
  doctorId: string | null;
  doctorName: string | null;
  startTime: string | null;
  endTime: string | null;
  status: string | null;
  type: string | null;
}

/**
 * 就诊工作台服务：提供某一天的挂号/预约/进行中就诊概览。
 * 所有行按 clinicId 租户过滤，且只返回未删除（deletedAt IS NULL）的行。
 */
export class ClinicalWorkbenchService {
  constructor(private readonly db: Database.Database) {}

  today(context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const date = new SystemClock().clinicDate(context.now());
    const clinicParams = tenantParams(clinicId);

    const registrations = this.db.prepare(
      `SELECT r.id, r.patientId, p.name AS patientName, r.doctorId, u.name AS doctorName,
              r.status, r.registeredAt, r.chiefComplaint, r.visitId
       FROM Registration r
       LEFT JOIN Patient p ON p.id = r.patientId AND p.deletedAt IS NULL
       LEFT JOIN User u ON u.id = r.doctorId AND u.deletedAt IS NULL
       WHERE r.deletedAt IS NULL AND r.registeredAt LIKE ? AND r.status != 'CANCELLED'${tenantAnd(clinicId, 'r.clinicId')}
       ORDER BY r.registeredAt DESC
       LIMIT 100`,
    ).all(`${date}%`, ...clinicParams) as WorkbenchRegistration[];

    const appointments = this.db.prepare(
      `SELECT a.id, a.patientId, p.name AS patientName, a.doctorId, u.name AS doctorName,
              a.startTime, a.endTime, a.status, a.type
       FROM Appointment a
       LEFT JOIN Patient p ON p.id = a.patientId AND p.deletedAt IS NULL
       LEFT JOIN User u ON u.id = a.doctorId AND u.deletedAt IS NULL
       WHERE a.deletedAt IS NULL AND a.startTime LIKE ?${tenantAnd(clinicId, 'a.clinicId')}
       ORDER BY a.startTime ASC
       LIMIT 100`,
    ).all(`${date}%`, ...clinicParams) as WorkbenchAppointment[];

    const registrationTotal = this.db.prepare(
      `SELECT COUNT(*) AS count FROM Registration r
       WHERE r.deletedAt IS NULL AND r.registeredAt LIKE ? AND r.status != 'CANCELLED'${tenantAnd(clinicId, 'r.clinicId')}`,
    ).get(`${date}%`, ...clinicParams) as { count: number } | undefined;

    const appointmentTotal = this.db.prepare(
      `SELECT COUNT(*) AS count FROM Appointment a
       WHERE a.deletedAt IS NULL AND a.startTime LIKE ?${tenantAnd(clinicId, 'a.clinicId')}`,
    ).get(`${date}%`, ...clinicParams) as { count: number } | undefined;

    const inProgressVisits = this.db.prepare(
      `SELECT COUNT(*) AS count FROM Visit v
       WHERE v.deletedAt IS NULL AND v.status = 'IN_PROGRESS' AND v.startTime LIKE ?${tenantAnd(clinicId, 'v.clinicId')}`,
    ).get(`${date}%`, ...clinicParams) as { count: number } | undefined;

    return {
      date,
      registrations,
      appointments,
      totals: {
        registrations: Number(registrationTotal?.count ?? 0),
        appointments: Number(appointmentTotal?.count ?? 0),
        inProgressVisits: Number(inProgressVisits?.count ?? 0),
      },
      truncated: {
        registrations: registrations.length < Number(registrationTotal?.count ?? 0),
        appointments: appointments.length < Number(appointmentTotal?.count ?? 0),
      },
    };
  }
}
