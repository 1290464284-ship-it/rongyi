import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantParams } from '../../infrastructure/tenant';
import type { AppContext, User, UserRole } from '../../../domain/contracts';
import type { AuthRepository, AuthUserRecord } from '../ports';
import {
  assertCanManageUser,
  canManageUser,
  countBossUsersInClinic,
  isUserRole,
  rowToUser,
  runInTransaction,
  userBelongsToClinic,
} from './common';

function assertPasswordLength(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 6) {
    throw new ValidationError('Password must be at least 6 characters');
  }
}

/**
 * 员工账号管理（BOSS/ADMIN 层级约束），与登录/会话逻辑分离。
 */
export class UserManagementService {
  constructor(
    private readonly db: Database.Database,
    private readonly authRepository: AuthRepository,
  ) {}

  async getUserById(userId: string): Promise<Omit<User, 'passwordHash'>> {
    const row = this.authRepository.findById(userId);
    if (!row) throw new NotFoundError('User not found');
    const user = rowToUser(row);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }

  async createUser(
    input: { username: string; password: string; name: string; role: string; phone?: string; active?: boolean; clinicIds?: string[] },
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    const username = String(input.username ?? '').trim();
    const name = String(input.name ?? '').trim();
    const role = String(input.role ?? '');
    if (!username || !name) throw new ValidationError('Username and name are required');
    assertPasswordLength(input.password);
    if (!isUserRole(role)) throw new ValidationError(`Invalid user role: ${role}`);
    if (!canManageUser(context.role, role)) {
      throw new AppError(
        'FORBIDDEN',
        context.role === 'DOCTOR' ? '医生不能管理员工账号' : '管理员不能创建老板账号',
        403,
      );
    }
    if (input.clinicIds !== undefined && (!Array.isArray(input.clinicIds) || input.clinicIds.some((id) => typeof id !== 'string'))) {
      throw new ValidationError('clinicIds must be an array of strings');
    }
    if (this.authRepository.findByUsername(username)) throw new ConflictError('Username already exists');
    const creatorClinics = new Set(
      this.authRepository.clinicMemberships(context.userId).map((membership) => membership.clinicId),
    );
    let clinicIds: string[];
    if (['BOSS', 'ADMIN'].includes(context.role)) {
      const requested = [...new Set(input.clinicIds ?? [])];
      // BOSS/ADMIN 也只能把新账号挂到自身实际所属的诊所，禁止跨诊所建号提权。
      if (!requested.every((clinicId) => creatorClinics.has(clinicId))) {
        throw new AppError('FORBIDDEN', 'Cannot create users outside your clinic scope', 403);
      }
      clinicIds = [...new Set([...(tenantParams(context.clinicId) as string[]), ...requested])];
    } else {
      /* v8 ignore start -- only BOSS/ADMIN/DOCTOR roles exist and DOCTOR is rejected by canManageUser above. */
      clinicIds = [...tenantParams(context.clinicId)] as string[];
      if (!clinicIds.every((clinicId) => creatorClinics.has(clinicId))) {
        throw new AppError('FORBIDDEN', 'Cannot create users outside your clinic scope', 403);
      }
      /* v8 ignore stop */
    }
    if (clinicIds.length > 0) {
      const placeholders = clinicIds.map(() => '?').join(',');
      const clinics = this.db.prepare(
        `SELECT id FROM Clinic WHERE id IN (${placeholders}) AND active = 1 AND deletedAt IS NULL`,
      ).all(...clinicIds) as Array<{ id: string }>;
      if (clinics.length !== clinicIds.length) {
        throw new ValidationError('clinicIds must reference existing clinics');
      }
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const now = new Date().toISOString();
    const record: AuthUserRecord = {
      id: randomUUID(),
      clinicId: context.clinicId,
      currentClinicId: context.clinicId,
      username,
      passwordHash,
      name,
      role,
      phone: input.phone ?? null,
      active: input.active ?? true,
      loginAttempts: 0,
      lockedUntil: null,
      tokenVersion: 0,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    runInTransaction(this.db, () => {
      try {
        this.authRepository.insertUser(record);
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
          throw new ConflictError('Username already exists');
        }
        throw error;
      }
      for (const clinicId of clinicIds as string[]) {
        this.authRepository.addClinicMembership(record.id, clinicId, role, now, now);
      }
    });
    const { passwordHash: _passwordHash, ...safeUser } = rowToUser(record);
    return safeUser;
  }

  async updateUser(
    id: string,
    input: { name?: string; phone?: string; role?: string; active?: boolean },
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    const row = this.authRepository.findById(id);
    if (!row || !userBelongsToClinic(this.db, id, context.clinicId)) throw new NotFoundError('User not found');
    if (input.role !== undefined && !isUserRole(input.role)) throw new ValidationError(`Invalid user role: ${input.role}`);
    assertCanManageUser(context.role, row.role as UserRole);
    if (input.role !== undefined) assertCanManageUser(context.role, input.role as UserRole);
    if (['BOSS', 'ADMIN'].includes(row.role) && (input.active === false || (input.role !== undefined && !['BOSS', 'ADMIN'].includes(input.role)))) {
      if (countBossUsersInClinic(this.db, context.clinicId) <= 1) {
        throw new ValidationError('不能禁用或降级最后一个管理员(BOSS)账号');
      }
    }
    const now = new Date().toISOString();
    const bumpToken = input.active === false;
    runInTransaction(this.db, () => {
      const changes = this.authRepository.updateUser(id, {
        name: input.name,
        phone: input.phone,
        role: input.role,
        active: input.active,
      }, now, context.clinicId);
      if (changes === 0) throw new NotFoundError('User not found');
      if (bumpToken) {
        this.db.prepare?.('UPDATE User SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')?.run(now, id);
      }
    });
    return this.getUserById(id);
  }

  async resetPassword(id: string, newPassword: string, context: AppContext): Promise<{ id: string }> {
    const row = this.authRepository.findById(id);
    if (!row || !userBelongsToClinic(this.db, id, context.clinicId)) throw new NotFoundError('User not found');
    assertCanManageUser(context.role, row.role as UserRole);
    assertPasswordLength(newPassword);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const now = new Date().toISOString();
    runInTransaction(this.db, () => {
      const changes = this.authRepository.resetPassword(id, passwordHash, now, context.clinicId);
      if (changes === 0) throw new NotFoundError('User not found');
      this.db.prepare?.('UPDATE User SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')?.run(now, id);
    });
    return { id };
  }

  async deleteUser(id: string, context: AppContext): Promise<{ id: string }> {
    if (id === context.userId) throw new ValidationError('不能删除当前登录账号');
    const row = this.authRepository.findById(id);
    if (!row || !userBelongsToClinic(this.db, id, context.clinicId)) throw new NotFoundError('User not found');
    assertCanManageUser(context.role, row.role as UserRole);
    if (['BOSS', 'ADMIN'].includes(row.role)) {
      if (countBossUsersInClinic(this.db, context.clinicId) <= 1) {
        throw new ValidationError('不能删除最后一个管理员(BOSS)账号');
      }
    }
    const now = new Date().toISOString();
    runInTransaction(this.db, () => {
      const changes = this.db.prepare(
        `UPDATE User SET deletedAt = ?, updatedAt = ?, tokenVersion = tokenVersion + 1, refreshToken = NULL, refreshTokenExpiresAt = NULL
         WHERE id = ? AND deletedAt IS NULL
           ${context.clinicId
             ? `AND (EXISTS (
                   SELECT 1 FROM UserClinic uc
                   WHERE uc.userId = User.id AND uc.clinicId = ? AND uc.deletedAt IS NULL
                 ) OR User.clinicId = ?)`
             : ''}`,
      ).run(...(context.clinicId ? [now, now, id, context.clinicId, context.clinicId] : [now, now, id]));
      if (changes.changes === 0) throw new NotFoundError('User not found');
    });
    return { id };
  }
}
