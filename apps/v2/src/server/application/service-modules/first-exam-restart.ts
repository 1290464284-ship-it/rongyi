/**
 * 首诊重启与牙列/主诉标记服务。
 *
 * - restart：把原首诊的临床内容复制成一份新的 IN_PROGRESS 首诊（previousExamId
 *   指向原记录，restartedAt 记录重启时间，remark='重启检查'），不复制牙齿明细——
 *   新检查从口腔检查重新开始，旧记录原样保留作为历史。
 * - setDentition：切换乳牙/恒牙/混合牙列。
 * - setChiefMark：在牙齿图上给主诉牙打横向标记（待横向/已横向）。
 * - history：某患者的全部首诊记录（含重启链）按创建时间倒序。
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { assertDoctorExists } from './common';

export type Dentition = 'DECIDUOUS' | 'PERMANENT' | 'MIXED';
export type ChiefMark = 'NONE' | 'HORIZONTAL_SHOULD' | 'HORIZONTAL_DONE';

const DENTITIONS: readonly string[] = ['DECIDUOUS', 'PERMANENT', 'MIXED'];
const CHIEF_MARKS: readonly string[] = ['NONE', 'HORIZONTAL_SHOULD', 'HORIZONTAL_DONE'];

export interface RestartInput {
  doctorId?: string;
  dentition?: Dentition;
}

export interface SetDentitionInput {
  dentition: Dentition;
}

export interface SetChiefMarkInput {
  chiefMark: ChiefMark;
}

export interface FirstExamHistoryItem {
  id: string;
  patientId: string;
  doctorId: string | null;
  status: string;
  followUpStatus: string | null;
  dentition: string | null;
  previousExamId: string | null;
  restartedAt: string | null;
  chiefComplaint: string | null;
  createdAt: string;
}

export class FirstExamRestartService {
  constructor(private readonly db: Database.Database) {}

  restart(examId: string, input: RestartInput, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const original = this.db.prepare(
      `SELECT * FROM FirstExam WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(examId, ...tenantParams(clinicId)) as Record<string, unknown> | undefined;
    if (!original) throw new NotFoundError('First exam not found');

    if (input.dentition !== undefined && !DENTITIONS.includes(input.dentition)) {
      throw new ValidationError('Invalid dentition');
    }
    if (input.doctorId !== undefined) {
      assertDoctorExists(this.db, input.doctorId, clinicId);
    }

    const now = context.now().toISOString();
    const newId = randomUUID();
    this.db.prepare(
      `INSERT INTO FirstExam (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, consultantId,
         chiefComplaint, presentIllness, pastHistory, oralExam, auxiliaryExam,
         diagnosis, treatmentSuggestion, status, remark,
         followUpStatus, dentition, previousExamId, restartedAt
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', '重启检查', 'NONE', ?, ?, ?)`,
    ).run(
      newId,
      clinicId,
      now,
      now,
      original.patientId,
      input.doctorId ?? original.doctorId ?? null,
      original.consultantId ?? null,
      original.chiefComplaint ?? null,
      original.presentIllness ?? null,
      original.pastHistory ?? null,
      original.oralExam ?? null,
      original.auxiliaryExam ?? null,
      original.diagnosis ?? null,
      original.treatmentSuggestion ?? null,
      input.dentition ?? original.dentition ?? null,
      examId,
      now,
    );

    return this.db.prepare(
      `SELECT * FROM FirstExam WHERE id = ?${tenantAnd(clinicId)}`,
    ).get(newId, ...tenantParams(clinicId)) as Record<string, unknown>;
  }

  setDentition(examId: string, input: SetDentitionInput, context: AppContext): { examId: string; dentition: Dentition } {
    const clinicId = context.clinicId;
    const existing = this.db.prepare(
      `SELECT id FROM FirstExam WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(examId, ...tenantParams(clinicId));
    if (!existing) throw new NotFoundError('First exam not found');

    const dentition = String(input?.dentition ?? '');
    if (!DENTITIONS.includes(dentition)) throw new ValidationError('Invalid dentition');

    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE FirstExam SET dentition = ?, updatedAt = ? WHERE id = ?${tenantAnd(clinicId)}`,
    ).run(dentition, now, examId, ...tenantParams(clinicId));
    return { examId, dentition: dentition as Dentition };
  }

  setChiefMark(examId: string, toothId: string, input: SetChiefMarkInput, context: AppContext): { toothId: string; chiefMark: ChiefMark } {
    const clinicId = context.clinicId;
    const exam = this.db.prepare(
      `SELECT id FROM FirstExam WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(examId, ...tenantParams(clinicId));
    if (!exam) throw new NotFoundError('First exam not found');

    const tooth = this.db.prepare(
      `SELECT id FROM FirstExamTooth WHERE id = ? AND examId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(toothId, examId, ...tenantParams(clinicId));
    if (!tooth) throw new NotFoundError('First exam tooth not found');

    const chiefMark = String(input?.chiefMark ?? '');
    if (!CHIEF_MARKS.includes(chiefMark)) throw new ValidationError('Invalid chiefMark');

    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE FirstExamTooth SET chiefMark = ?, updatedAt = ? WHERE id = ?${tenantAnd(clinicId)}`,
    ).run(chiefMark, now, toothId, ...tenantParams(clinicId));
    return { toothId, chiefMark: chiefMark as ChiefMark };
  }

  history(patientId: string, context: AppContext): FirstExamHistoryItem[] {
    const clinicId = context.clinicId;
    const patient = this.db.prepare(
      `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(patientId, ...tenantParams(clinicId));
    if (!patient) throw new NotFoundError('Patient not found');

    return this.db.prepare(
      `SELECT id, patientId, doctorId, status, followUpStatus, dentition, previousExamId, restartedAt, chiefComplaint, createdAt
       FROM FirstExam
       WHERE patientId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}
       ORDER BY createdAt DESC`,
    ).all(patientId, ...tenantParams(clinicId)) as FirstExamHistoryItem[];
  }
}
