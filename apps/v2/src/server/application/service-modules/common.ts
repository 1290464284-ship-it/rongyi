import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { User, UserRole } from '../../../domain/contracts';
import { AppError, NotFoundError } from '../../infrastructure/errors';
import { secretFileValue } from '../../infrastructure/secret-file';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AuthUserRecord } from '../ports';

function _resolveJwtSecret(): string {
  // S-L2：Electron 场景优先读 V2_SECRET_FILE（主进程注入的 0o600 临时文件），
  // 其次兼容直跑环境（pnpm dev:api / 测试）的 V2_JWT_SECRET env。
  const fileSecret = secretFileValue('jwt');
  if (fileSecret) return fileSecret;
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

/**
 * Generates a human-readable document number: `${prefix}-<base36 timestamp>-<8 hex chars>`.
 *
 * Single shared implementation of the charge/dispense/purchase/inventory document
 * number format (prefix, base-36 timestamp, truncated UUID, uppercase). All
 * business modules must use this function so format changes (clinic prefix,
 * length, collision retry) apply in one place.
 */
export function generateDocumentNumber(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

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

/** Parses a stored JSON object defensively; corrupt/array payloads become {}. */
export function safeJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function backupEncryptionKey(): Buffer {
  // S-L2：优先 V2_SECRET_FILE（Electron），其次兼容直跑的 V2_BACKUP_KEY env。
  const key = process.env.V2_BACKUP_KEY ?? secretFileValue('backupKey');
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
  return ['BOSS', 'ADMIN', 'DOCTOR'].includes(role);
}

/**
 * 角色管理层级（数值越大权限越高）：
 * 老板 3 > 管理员 2 > 医生 1。
 */
export const ROLE_MANAGEMENT_LEVEL: Record<UserRole, number> = {
  BOSS: 3,
  ADMIN: 2,
  DOCTOR: 1,
};

/**
 * 管理层级：同层可互相管理（老板/管理员），医生不能管理任何账号；
 * 低层不能管理高层，管理员不能管理老板。
 */
export function canManageUser(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'DOCTOR') return false;
  return (ROLE_MANAGEMENT_LEVEL[actorRole] ?? 0) >= (ROLE_MANAGEMENT_LEVEL[targetRole] ?? 0);
}

/**
 * 统一的管理层级失败提示：医生不能管理任何员工账号，管理员不能管理老板。
 * 各业务模块不要再重复拼写同一组 403 文案。
 */
export function assertCanManageUser(actorRole: UserRole, targetRole: UserRole): void {
  if (canManageUser(actorRole, targetRole)) return;
  const message = actorRole === 'DOCTOR' ? '医生不能管理员工账号' : '管理员不能管理老板账号';
  throw new AppError('FORBIDDEN', message, 403);
}

/**
 * 统一事务执行封装：优先使用 better-sqlite3 的 transaction（保持 this 绑定），
 * 非真实 Database（如测试替身）时退化为直接执行。
 */
export function runInTransaction<T>(db: Database.Database, fn: () => T): T {
  const tx = (db as unknown as { transaction?: <U>(cb: () => U) => () => U }).transaction;
  if (typeof tx === 'function') {
    return tx.call(db, fn)() as T;
  }
  return fn();
}

/** 与 runInTransaction 相同的回退语义，但使用 BEGIN IMMEDIATE 提前获取写锁。 */
export function runInTransactionImmediate<T>(db: Database.Database, fn: () => T): T {
  const tx = (db as unknown as { transaction?: <U>(cb: () => U) => () => U }).transaction;
  if (typeof tx === 'function') {
    const runner = tx.call(db, fn);
    if (typeof (runner as { immediate?: () => T }).immediate === 'function') {
      return (runner as unknown as { immediate: () => T }).immediate();
    }
    return runner() as T;
  }
  return fn();
}

export function assertPatientExists(db: Database.Database, patientId: string, clinicId: string | null): void {
  const row = db.prepare(
    `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
  ).get(patientId, ...tenantParams(clinicId)) as { id: string } | undefined;
  if (!row) throw new NotFoundError('Patient not found');
}

export function assertDoctorExists(db: Database.Database, doctorId: string, clinicId: string | null): void {
  const row = db.prepare(
    `SELECT u.id FROM User u
     WHERE u.id = ? AND u.role IN ('DOCTOR', 'BOSS') AND u.active = 1 AND u.deletedAt IS NULL
       ${clinicId
         ? `AND (EXISTS (
               SELECT 1 FROM UserClinic uc
               WHERE uc.userId = u.id AND uc.clinicId = ? AND uc.deletedAt IS NULL
             ) OR u.clinicId = ?)`
         : ''}`,
  ).get(...(clinicId ? [doctorId, clinicId, clinicId] : [doctorId])) as { id: string } | undefined;
  if (!row) throw new NotFoundError('Doctor not found');
}

/** 用户是否属于某诊所：优先 UserClinic 成员关系，老库回退 User.clinicId。 */
export function userBelongsToClinic(
  db: Database.Database,
  userId: string,
  clinicId: string | null | undefined,
): boolean {
  if (!clinicId) return true;
  const membership = db.prepare(
    `SELECT 1 FROM UserClinic uc
     WHERE uc.userId = ? AND uc.clinicId = ? AND uc.deletedAt IS NULL
     LIMIT 1`,
  ).get(userId, clinicId);
  if (membership) return true;
  const row = db.prepare(
    'SELECT clinicId FROM User WHERE id = ? AND deletedAt IS NULL',
  ).get(userId) as { clinicId?: string | null } | undefined;
  return Boolean(row?.clinicId && String(row.clinicId) === clinicId);
}

/** 诊所内启用中的 BOSS 数量（UserClinic 优先，老库回退 User.clinicId）。 */
export function countBossUsersInClinic(db: Database.Database, clinicId: string | null | undefined): number {
  const row = db.prepare(
    `SELECT COUNT(DISTINCT u.id) AS count FROM User u
     WHERE u.role IN ('BOSS', 'ADMIN') AND u.active = 1 AND u.deletedAt IS NULL
       ${clinicId
         ? `AND (EXISTS (
               SELECT 1 FROM UserClinic uc
               WHERE uc.userId = u.id AND uc.clinicId = ? AND uc.deletedAt IS NULL
             ) OR u.clinicId = ?)`
         : ''}`,
  ).get(...(clinicId ? [clinicId, clinicId] : [])) as { count: number };
  return Number(row.count);
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
