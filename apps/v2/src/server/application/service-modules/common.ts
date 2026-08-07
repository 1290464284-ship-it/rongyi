import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { User, UserRole } from '../../../domain/contracts';
import { NotFoundError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AuthUserRecord } from '../ports';

function _resolveJwtSecret(): string {
  const envSecret = process.env.V2_JWT_SECRET;
  if (envSecret) return envSecret;
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production') {
    throw new Error('V2_JWT_SECRET must be set to a random secret of at least 32 characters in production');
  }
  return randomBytes(32).toString('hex');
}
export const JWT_SECRET = _resolveJwtSecret();
export const TOKEN_TTL = '8h';
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const BACKUP_MAGIC = Buffer.from('DENTALV2ENC1');

export interface TokenPayload {
  sub: string;
  clinicId: string | null;
  role: string;
  tokenVersion: number;
}

export interface AuthSession {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: Omit<User, 'passwordHash'>;
}

export const FORBIDDEN_BULK_IMPORT_RESOURCES = new Set([
  'users',
  'charges',
  'chargeItems',
  'refunds',
  'memberCards',
  'memberCardLogs',
  'memberPointLogs',
  'inventoryItems',
  'inventoryTransactions',
  'debtRecords',
  'purchaseOrders',
  'processingOrders',
]);

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

export function backupEncryptionKey(): Buffer {
  const key = process.env.V2_BACKUP_KEY;
  if (!key) {
    throw new Error('V2_BACKUP_KEY is required for encrypted backups');
  }
  return createHash('sha256').update(key).digest();
}

export function rowToUser(row: AuthUserRecord | Record<string, unknown>): User {
  return {
    id: String(row.id),
    clinicId: row.clinicId ? String(row.clinicId) : null,
    currentClinicId: row.currentClinicId ? String(row.currentClinicId) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    username: String(row.username),
    passwordHash: String(row.passwordHash),
    name: String(row.name),
    role: String(row.role) as User['role'],
    active: Number(row.active) === 1,
    loginAttempts: Number(row.loginAttempts ?? 0),
    lockedUntil: row.lockedUntil ? String(row.lockedUntil) : null,
    tokenVersion: Number(row.tokenVersion ?? 0),
  };
}

export function isUserRole(role: string): role is UserRole {
  return ['BOSS', 'DOCTOR'].includes(role);
}

export function assertPatientExists(db: Database.Database, patientId: string, clinicId: string | null): void {
  const row = db.prepare(
    `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).get(patientId, ...tenantParams(clinicId)) as { id: string } | undefined;
  if (!row) throw new NotFoundError('Patient not found');
}

export function assertDoctorExists(db: Database.Database, doctorId: string, clinicId: string | null): void {
  const row = db.prepare(
    `SELECT id FROM User
     WHERE id = ? AND role IN ('DOCTOR', 'BOSS') AND active = 1 AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).get(doctorId, ...tenantParams(clinicId)) as { id: string } | undefined;
  if (!row) throw new NotFoundError('Doctor not found');
}

export function assertChairExists(db: Database.Database, chairId: string, clinicId: string | null): void {
  const row = db.prepare(
    `SELECT id FROM Chair WHERE id = ? AND active = 1 AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).get(chairId, ...tenantParams(clinicId)) as { id: string } | undefined;
  if (!row) throw new NotFoundError('Chair not found');
}

export function assertVisitExists(
  db: Database.Database,
  visitId: string,
  patientId: string,
  clinicId: string | null,
): void {
  const row = db.prepare(
    `SELECT id, patientId FROM Visit WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).get(visitId, ...tenantParams(clinicId)) as { id: string; patientId?: string | null } | undefined;
  if (!row) throw new NotFoundError('Visit not found');
  if (row.patientId && String(row.patientId) !== patientId) {
    throw new NotFoundError('Visit does not belong to the patient');
  }
}
