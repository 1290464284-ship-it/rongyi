import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { User, UserRole } from '../../../domain/contracts';
import { NotFoundError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AuthUserRecord } from '../ports';

export const JWT_SECRET = process.env.V2_JWT_SECRET ?? 'v2-local-secret-change-me';
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
  return ['BOSS', 'ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'TECHNICIAN'].includes(role);
}

export function assertPatientExists(db: Database.Database, patientId: string, clinicId: string | null): void {
  const row = db.prepare(
    `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).get(patientId, ...tenantParams(clinicId)) as { id: string } | undefined;
  if (!row) throw new NotFoundError('Patient not found');
}
