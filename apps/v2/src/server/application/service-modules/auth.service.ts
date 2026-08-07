// 认证/用户服务（M-04：由 auth.ts 拆分）
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../infrastructure/errors';
import { SqliteAuthRepository } from '../../infrastructure/repositories/core.repositories';
import { tenantAnd, tenantMatches, tenantParams } from '../../infrastructure/tenant';
import type { AppContext, User } from '../../../domain/contracts';
import type { AuthRepository, AuthUserRecord } from '../ports';
import {
  AuthSession,
  JWT_SECRET,
  REFRESH_TTL_MS,
  TOKEN_TTL,
  TokenPayload,
  hashRefreshToken,
  isUserRole,
  newRefreshToken,
  rowToUser,
} from './common';

const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8cG5fVb55Qk9X7pL5Nh4bKj1R8f69y';

export class AuthService {
  private readonly db: Database.Database;
  private readonly authRepository: AuthRepository;

  constructor(db: Database.Database, authRepository?: AuthRepository) {
    this.db = db;
    this.authRepository = authRepository ?? new SqliteAuthRepository(db);
  }

  private runTx<T>(fn: () => T): T {
    const tx = (this.db as unknown as { transaction?: <U>(cb: () => U) => () => U }).transaction;
    if (typeof tx === 'function') {
      return tx.call(this.db, fn)() as T;
    }
    return fn();
  }

  async login(username: string, password: string): Promise<AuthSession> {
    const preRow = this.authRepository.findByUsername(username);
    if (!preRow) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedError('Invalid username or password');
    }
    const preUser = rowToUser(preRow);
    const valid = await bcrypt.compare(password, preUser.passwordHash);
    return this.runTx(() => {
      const row = this.authRepository.findByUsername(username);
      if (!row) throw new UnauthorizedError('Invalid username or password');
      const user = rowToUser(row);
      if (!user.active) throw new UnauthorizedError('User is disabled');
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
        throw new UnauthorizedError('Account is temporarily locked');
      }
      if (!valid) {
        const attempts = user.loginAttempts + 1;
        const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
        this.authRepository.updateLoginAttempts(user.id, attempts, lockedUntil, new Date().toISOString());
        throw new UnauthorizedError('Invalid username or password');
      }
      this.authRepository.resetLoginAttempts(user.id, new Date().toISOString());
      const token = this.sign({ sub: user.id, clinicId: this.resolveClinicId(user), role: user.role, tokenVersion: user.tokenVersion });
      const refreshToken = newRefreshToken();
      const now = new Date().toISOString();
      this.authRepository.updateRefreshToken(
        user.id,
        hashRefreshToken(refreshToken),
        new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
        now,
      );
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return { token, refreshToken, expiresIn: 8 * 60 * 60, user: safeUser };
    });
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    if (!refreshToken) throw new UnauthorizedError('Refresh token is required');
    const tokenHash = hashRefreshToken(refreshToken);
    this.authRepository.cleanupUsedRefreshTokens(new Date(Date.now() - 90 * 86_400_000).toISOString());
    if (this.authRepository.isRefreshTokenUsed(tokenHash)) {
      // M5：refresh token 重用（被盗/重放）→ 按 RFC 6819 吊销整个会话族
      this.revokeReplayedFamily(tokenHash);
      throw new UnauthorizedError('Invalid refresh token (refresh token reuse detected)');
    }
    const preRow = this.authRepository.findByRefreshTokenHash(tokenHash);
    if (!preRow) throw new UnauthorizedError('Invalid refresh token');
    return this.runTx(() => {
      if (this.authRepository.isRefreshTokenUsed(tokenHash)) {
        this.revokeReplayedFamily(tokenHash);
        throw new UnauthorizedError('Invalid refresh token (refresh token reuse detected)');
      }
      const row = this.authRepository.findByRefreshTokenHash(tokenHash);
      if (!row) throw new UnauthorizedError('Invalid refresh token');
      const user = rowToUser(row);
      if (!user.active) throw new UnauthorizedError('User is disabled');
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
        throw new UnauthorizedError('Account is temporarily locked');
      }
      const expiresAt = row.refreshTokenExpiresAt ? new Date(row.refreshTokenExpiresAt).getTime() : 0;
      if (!expiresAt || expiresAt <= Date.now()) {
        this.authRepository.clearRefreshToken(user.id, new Date().toISOString());
        throw new UnauthorizedError('Refresh token has expired');
      }
      const now = new Date().toISOString();
      this.authRepository.markRefreshTokenUsed(tokenHash, user.id, now);
      const nextRefreshToken = newRefreshToken();
      this.authRepository.updateRefreshToken(
        user.id,
        hashRefreshToken(nextRefreshToken),
        new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
        now,
      );
      const token = this.sign({ sub: user.id, clinicId: this.resolveClinicId(user), role: user.role, tokenVersion: user.tokenVersion });
      const { passwordHash: _passwordHash, ...safeUser } = user;
      return { token, refreshToken: nextRefreshToken, expiresIn: 8 * 60 * 60, user: safeUser };
    });
  }

  /** 注销 refresh token；返回该 token 归属的用户 id（未匹配到任何会话时返回 null）。 */
  async logout(refreshToken: string): Promise<string | null> {
    if (!refreshToken) return null;
    const tokenHash = hashRefreshToken(refreshToken);
    const row = this.authRepository.findByRefreshTokenHash(tokenHash);
    if (!row) return null;
    const now = new Date().toISOString();
    this.authRepository.markRefreshTokenUsed(tokenHash, row.id, now);
    this.authRepository.clearRefreshToken(row.id, now);
    return row.id;
  }

  /** 重用检测后的会话族吊销（RFC 6819）：清除用户当前 refresh token 并使所有 access token 失效。 */
  private revokeReplayedFamily(tokenHash: string): void {
    try {
      const used = this.authRepository.findUsedRefreshToken(tokenHash);
      if (used?.userId) {
        this.authRepository.revokeSessionFamily(used.userId, new Date().toISOString());
      }
    } catch {
      // 重用已被拒绝；吊销为尽力而为
    }
  }

  verifyToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as TokenPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  private resolveClinicId(user: User): string {
    if (user.currentClinicId) return user.currentClinicId;
    if (user.clinicId) return user.clinicId;
    const membershipClinicId = this.authRepository.clinicMemberships(user.id)[0]?.clinicId ?? null;
    if (!membershipClinicId) {
      throw new AppError('FORBIDDEN', 'No clinic scope assigned to this account', 403);
    }
    return membershipClinicId;
  }

  async me(payload: TokenPayload): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.getUserById(payload.sub);
    if (user.tokenVersion !== payload.tokenVersion) throw new UnauthorizedError('Token is no longer valid');
    return user;
  }

  /**
   * 校验 clinicId 对当前用户是否仍有效（UserClinic 成员关系未删除且诊所未删除）。
   * 用于 JWT 中 clinicId 的运行时校验（P2-1：用户被移出诊所后旧 token 应立即失效）。
   * 历史数据兜底：无 UserClinic 行时回退到 User.clinicId/currentClinicId。
   */
  isClinicAccessible(userId: string, clinicId: string | null | undefined): boolean {
    if (!clinicId) return true; // 无诊所作用域（legacy 路径）不做成员校验
    const row = this.authRepository.findById(userId);
    if (!row) return false;
    const memberships = this.authRepository.clinicMemberships(userId);
    if (memberships.some((membership) => membership.clinicId === clinicId)) return true;
    // 老库可能没有 UserClinic 行（迁移 123 之前的数据），回退到 User 行字段
    return (row.currentClinicId ?? row.clinicId ?? null) === clinicId;
  }

  async getUserById(userId: string): Promise<Omit<User, 'passwordHash'>> {
    const row = this.authRepository.findById(userId);
    if (!row) throw new UnauthorizedError('User not found');
    const user = rowToUser(row);
    const { passwordHash: _passwordHash, ...safeUser } = user;
    return safeUser;
  }

  listAccessibleClinics(userId: string, role: User['role']): {
    currentClinicId: string | null;
    clinics: Array<{ clinicId: string; name: string; role: string }>;
  } {
    const row = this.authRepository.findById(userId);
    if (!row) throw new NotFoundError('User not found');
    if (role !== 'BOSS') {
      const clinicId = row.currentClinicId ?? row.clinicId ?? null;
      return {
        currentClinicId: clinicId,
        clinics: clinicId ? [{ clinicId, name: clinicId, role }] : [],
      };
    }
    let memberships = this.authRepository.clinicMemberships(userId);
    if (memberships.length === 0 && row.clinicId) {
      memberships = [{ clinicId: row.clinicId, name: row.clinicId, role }];
    }
    return {
      currentClinicId: row.currentClinicId ?? row.clinicId ?? null,
      clinics: memberships.map((membership) => ({
        clinicId: membership.clinicId,
        name: membership.name || membership.clinicId,
        role: membership.role,
      })),
    };
  }

  listDoctors(context: AppContext): Array<{ id: string; name: string; phone: string | null; role: string }> {
    const rows = this.db.prepare(
      `SELECT id, name, phone, role FROM User
       WHERE role = 'DOCTOR' AND active = 1 AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY name ASC`,
    ).all(...tenantParams(context.clinicId)) as Array<{ id: string; name: string; phone: string | null; role: string }>;
    return rows;
  }

  switchClinic(userId: string, role: User['role'], clinicId: string): { token: string; clinicId: string } {
    if (role !== 'BOSS') {
      throw new AppError('FORBIDDEN', 'Only BOSS can switch clinics', 403);
    }
    const row = this.authRepository.findById(userId);
    if (!row) throw new NotFoundError('User not found');
    const memberships = this.authRepository.clinicMemberships(userId);
    if (!memberships.some((membership) => membership.clinicId === clinicId)) {
      throw new NotFoundError('Clinic not found');
    }
    const clinic = this.db.prepare('SELECT id FROM Clinic WHERE id = ? AND active = 1 AND deletedAt IS NULL').get(clinicId) as
      | { id: string }
      | undefined;
    if (!clinic) throw new NotFoundError('Clinic not found');
    const now = new Date().toISOString();
    this.authRepository.setCurrentClinic(userId, clinicId, now);
    const token = this.sign({ sub: userId, clinicId, role: row.role, tokenVersion: row.tokenVersion });
    return { token, clinicId };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const row = this.authRepository.findById(userId);
    if (!row) throw new NotFoundError('User not found');
    const user = rowToUser(row);
    if (!(await bcrypt.compare(oldPassword, user.passwordHash))) {
      throw new UnauthorizedError('Old password is incorrect');
    }
    if (newPassword.length < 6) throw new ValidationError('New password must be at least 6 characters');
    const hash = await bcrypt.hash(newPassword, 10);
    const now = new Date().toISOString();
    this.runTx(() => {
      this.authRepository.updatePassword(userId, hash, now);
      this.authRepository.clearRefreshToken(userId, now);
      this.db.prepare?.('UPDATE User SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')?.run(now, userId);
    });
  }

  async createUser(
    input: { username: string; password: string; name: string; role: string; phone?: string; active?: boolean; clinicIds?: string[] },
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    const username = String(input.username ?? '').trim();
    const name = String(input.name ?? '').trim();
    const role = String(input.role ?? '');
    if (!username || !name) throw new ValidationError('Username and name are required');
    if (input.password.length < 6) throw new ValidationError('Password must be at least 6 characters');
    if (!isUserRole(role)) throw new ValidationError(`Invalid user role: ${role}`);
    if (input.clinicIds !== undefined && (!Array.isArray(input.clinicIds) || input.clinicIds.some((id) => typeof id !== 'string'))) {
      throw new ValidationError('clinicIds must be an array of strings');
    }
    if (this.authRepository.findByUsername(username)) throw new ConflictError('Username already exists');
    const clinicIds = role === 'BOSS'
      ? [...new Set([...tenantParams(context.clinicId), ...(input.clinicIds ?? [])])]
      : [...tenantParams(context.clinicId)];
    if (clinicIds.length > 0) {
      const placeholders = clinicIds.map(() => '?').join(',');
      const clinics = this.db.prepare(
        `SELECT id FROM Clinic WHERE id IN (${placeholders}) AND active = 1 AND deletedAt IS NULL`,
      ).all(...clinicIds) as Array<{ id: string }>;
      if (clinics.length !== clinicIds.length) {
        throw new ValidationError('clinicIds must reference existing clinics');
      }
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
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
    const { passwordHash: _passwordHash, ...safeUser } = rowToUser(record);
    return safeUser;
  }

  async updateUser(
    id: string,
    input: { name?: string; phone?: string; role?: string; active?: boolean },
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    const row = this.authRepository.findById(id);
    if (!row || !tenantMatches(row.clinicId, context.clinicId)) throw new NotFoundError('User not found');
    if (input.role !== undefined && !isUserRole(input.role)) throw new ValidationError(`Invalid user role: ${input.role}`);
    if (row.role === 'BOSS' && (input.active === false || (input.role !== undefined && input.role !== 'BOSS'))) {
      const boss = this.db.prepare(
        `SELECT COUNT(*) AS count FROM User WHERE role = 'BOSS' AND active = 1 AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(...tenantParams(context.clinicId)) as { count: number };
      if (Number(boss.count) <= 1) throw new ValidationError('不能禁用或降级最后一个管理员(BOSS)账号');
    }
    const now = new Date().toISOString();
    const bumpToken = input.active === false;
    this.runTx(() => {
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
    if (!row || !tenantMatches(row.clinicId, context.clinicId)) throw new NotFoundError('User not found');
    if (newPassword.length < 6) throw new ValidationError('Password must be at least 6 characters');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const now = new Date().toISOString();
    this.runTx(() => {
      const changes = this.authRepository.resetPassword(id, passwordHash, now, context.clinicId);
      if (changes === 0) throw new NotFoundError('User not found');
      this.db.prepare?.('UPDATE User SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')?.run(now, id);
    });
    return { id };
  }

  async deleteUser(id: string, context: AppContext): Promise<{ id: string }> {
    if (id === context.userId) throw new ValidationError('不能删除当前登录账号');
    const row = this.authRepository.findById(id);
    if (!row || !tenantMatches(row.clinicId, context.clinicId)) throw new NotFoundError('User not found');
    if (row.role === 'BOSS') {
      const boss = this.db.prepare(
        `SELECT COUNT(*) AS count FROM User WHERE role = 'BOSS' AND active = 1 AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).get(...tenantParams(context.clinicId)) as { count: number };
      if (Number(boss.count) <= 1) throw new ValidationError('不能删除最后一个管理员(BOSS)账号');
    }
    const now = new Date().toISOString();
    this.runTx(() => {
      const changes = this.db.prepare(
        'UPDATE User SET deletedAt = ?, updatedAt = ?, tokenVersion = tokenVersion + 1, refreshToken = NULL, refreshTokenExpiresAt = NULL WHERE id = ? AND deletedAt IS NULL',
      ).run(now, now, id);
      if (changes.changes === 0) throw new NotFoundError('User not found');
    });
    return { id };
  }

  private sign(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
  }
}
