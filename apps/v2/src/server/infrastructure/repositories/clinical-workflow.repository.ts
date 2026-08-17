// 临床工作流仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import { trackResourceWrite } from '../write-tracking';
import type { ClinicalWorkflowRepository } from '../../application/ports';

/** getRow/updateStatus 仅允许操作这些临床表；表名来自调用方字面量，白名单防未来误传用户输入。 */
const WORKFLOW_TABLES = new Set(['Registration', 'Visit', 'FirstExam', 'Treatment', 'MedicalRecord']);

export class SqliteClinicalWorkflowRepository implements ClinicalWorkflowRepository {
  constructor(private readonly db: Database.Database) {}

  private assertTable(table: string): void {
    if (!WORKFLOW_TABLES.has(table)) throw new Error(`Clinical workflow table not allowed: ${table}`);
  }

  getRow(table: string, id: string, clinicId?: string | null): Record<string, unknown> | null {
    this.assertTable(table);
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as Record<string, unknown> | undefined) ?? null;
  }

  updateStatus(table: string, id: string, status: string, now: string, extra: Record<string, unknown> = {}, clinicId?: string | null, fromStatus?: string): number {
    this.assertTable(table);
    const setClause = Object.keys(extra).map((key) => `${key} = ?`).join(', ');
    const params = Object.values(extra).map((value) => value ?? null);
    const fromClause = fromStatus !== undefined ? ' AND status = ?' : '';
    const sql = `UPDATE ${table} SET status = ?, updatedAt = ?${setClause ? `, ${setClause}` : ''} WHERE id = ? AND deletedAt IS NULL${fromClause}${tenantAnd(clinicId)}`;
    const result = this.db.prepare(sql).run(
      status,
      now,
      ...params,
      id,
      ...(fromStatus !== undefined ? [fromStatus] : []),
      ...(clinicId ? [clinicId] : []),
    );
/* v8 ignore next */
    if (result.changes > 0) {
      trackResourceWrite(this.db, { tableName: table, recordId: id, operation: 'UPDATE', clinicId: clinicId ?? null });
    }
    return result.changes;
  }

  createVisit(input: Record<string, unknown>): string {
    this.db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'IN_PROGRESS')`,
    ).run(input.id, input.clinicId ?? null, input.createdAt, input.updatedAt, input.patientId, input.doctorId ?? input.userId, input.createdAt);
    return String(input.id);
  }

  lockMedicalRecord(id: string, locked: boolean, userId: string, now: string, clinicId?: string | null): void {
    const params = clinicId ? [locked ? 1 : 0, locked ? now : null, locked ? userId : null, now, id, clinicId] : [locked ? 1 : 0, locked ? now : null, locked ? userId : null, now, id];
    this.db.prepare(
      `UPDATE MedicalRecord SET isLocked = ?, lockedAt = ?, lockedBy = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params);
  }
}
