import type Database from 'better-sqlite3';
import { AppError } from '../../infrastructure/errors';

export function assertActiveClinic(db: Database.Database | undefined, clinicId: string): string {
  if (typeof db?.prepare !== 'function') return clinicId;
  const row = db.prepare(
    'SELECT active FROM Clinic WHERE id = ? AND deletedAt IS NULL',
  ).get(clinicId) as { active?: number } | undefined;
  if (!row || Number(row.active) !== 1) {
    throw new AppError('FORBIDDEN', 'Clinic is disabled or deleted', 403);
  }
  return clinicId;
}
