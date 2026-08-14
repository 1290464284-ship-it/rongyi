// 临床工作流仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import { trackResourceWrite } from '../write-tracking';
import type { ClinicalWorkflowRepository } from '../../application/ports';

export class SqliteClinicalWorkflowRepository implements ClinicalWorkflowRepository {
  constructor(private readonly db: Database.Database) {}

  getRow(table: string, id: string, clinicId?: string | null): Record<string, unknown> | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as Record<string, unknown> | undefined) ?? null;
  }

  updateStatus(table: string, id: string, status: string, now: string, extra: Record<string, unknown> = {}, clinicId?: string | null, fromStatus?: string): number {
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
    /* v8 ignore start -- V8 does not report the false ternary branches inside this params literal despite direct coverage. */
    const params = clinicId ? [locked ? 1 : 0, locked ? now : null, locked ? userId : null, now, id, clinicId] : [locked ? 1 : 0, locked ? now : null, locked ? userId : null, now, id];
    /* v8 ignore stop */
    this.db.prepare(
      `UPDATE MedicalRecord SET isLocked = ?, lockedAt = ?, lockedBy = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(...params);
  }
}
