// 患者风险评估仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import type { PatientRiskRepository } from '../../application/ports';

export class SqlitePatientRiskRepository implements PatientRiskRepository {
  constructor(private readonly db: Database.Database) {}

  treatmentCount(patientId: string, clinicId?: string | null): number {
    const params = clinicId ? [patientId, clinicId] : [patientId];
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM Treatment WHERE patientId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as { c: number }).c;
  }

  periodontalCount(patientId: string, clinicId?: string | null): number {
    const params = clinicId ? [patientId, clinicId] : [patientId];
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM PeriodontalRecord WHERE patientId = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as { c: number }).c;
  }

  insert(input: Record<string, unknown>): void {
    this.db.prepare(
      `INSERT INTO PatientRiskScore (
         id, clinicId, createdAt, updatedAt, deletedAt, patientId,
         cariesScore, periodontalScore, implantScore,
         cariesLevel, periodontalLevel, implantLevel,
         factorSnapshotJson, assessedById
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.clinicId ?? null,
      input.createdAt,
      input.updatedAt,
      input.patientId,
      input.cariesScore,
      input.periodontalScore,
      input.implantScore,
      input.cariesLevel,
      input.periodontalLevel,
      input.implantLevel,
      input.factorSnapshotJson,
      input.assessedById ?? null,
    );
  }
}
