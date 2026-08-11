// 认证/会话服务（M-04：由 auth.ts 拆分；账号管理见 user-management.service.ts）
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AppError, ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../../infrastructure/errors';
import type { Logger } from '../../infrastructure/logger';
import { SqliteAuthRepository } from '../../infrastructure/repositories/core.repositories';
import type { AppContext, User, UserRole } from '../../../domain/contracts';
import type { AuthRepository } from '../ports';
import {
  AuthSession,
  JWT_SECRET,
  REFRESH_TTL_MS,
  TOKEN_TTL,
  TokenPayload,
  hashRefreshToken,
  newRefreshToken,
  rowToUser,
  runInTransaction,
  runInTransactionImmediate,
} from './common';
import { computeEffectivePermissions } from './permissions';
import { UserManagementService } from './user-management.service';

const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8cG5fVb55Qk9X7pL5Nh4bKj1R8f69y';

function assertPasswordLength(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 6) {
    throw new ValidationError('Password must be at least 6 characters');
  }
}

export class AuthService {
  private readonly db: Database.Database;
  private readonly authRepository: AuthRepository;
  private readonly userManagement: UserManagementService;
  /** B-M9：refresh token 轮换的 5 秒窗口内存缓存（并发刷新共享同一新 token，
   *  避免"两个并发请求互判重用"误吊销会话族）。logout 与重用检测时整表清空。 */
  private readonly refreshCache = new Map<string, { expiresAt: number; session: AuthSession }>();
  private static readonly REFRESH_CACHE_TTL_MS = 5_000;
  private static readonly REFRESH_CACHE_MAX = 1_000;

  constructor(db: Database.Database, authRepository?: AuthRepository, private readonly logger?: Logger) {
    this.db = db;
    this.authRepository = authRepository ?? new SqliteAuthRepository(db);
    this.userManagement = new UserManagementService(db, this.authRepository);
  }

  /** True when no active built-in admin exists and the first-run setup wizard should be shown. */
  setupRequired(): boolean {
    return !this.db.prepare(
      `SELECT 1 FROM User WHERE username = 'admin' AND deletedAt IS NULL LIMIT 1`,
    ).get();
  }

  /** Creates the initial admin from the first-run setup wizard; safe to call only once. */
  async setupInitialAdmin(password: unknown): Promise<{ created: true }> {
    if (!this.setupRequired()) throw new ConflictError('Initial admin already configured');
    assertPasswordLength(password);
    const now = new Date().toISOString();
    const clinicRow = this.db.prepare(
      `SELECT id FROM Clinic ORDER BY createdAt ASC LIMIT 1`,
    ).get() as { id: string } | undefined;
    const clinicId = clinicRow?.id ?? 'clinic-v2-001';
    const passwordHash = await bcrypt.hash(password, 10);
    const created = this.db.prepare(
      `INSERT OR IGNORE INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, ?, ?, ?, NULL, 'admin', ?, 'System Administrator', 'BOSS', 1, 0, 0)`,
    ).run(randomUUID(), clinicId, now, now, passwordHash);
    if (created.changes === 0) throw new ConflictError('Initial admin already configured');
    return { created: true };
  }

  async login(username: string, password: string): Promise<AuthSession> {
    const preRow = this.authRepository.findByUsername(username);
    if (!preRow) {
      bcrypt.compareSync(password, DUMMY_HASH);
      throw new UnauthorizedError('Invalid username or password');
    }
    return runInTransactionImmediate(this.db, () => {
      const row = this.authRepository.findByUsername(username);
      if (!row) throw new UnauthorizedError('Invalid username or password');
      const user = rowToUser(row);
      if (!user.active) throw new UnauthorizedError('User is disabled');
      if (user.lockedUntil) {
        const lockedTime = new Date(user.lockedUntil).getTime();
        // B-L3：lockedUntil 不可解析（NaN）时 fail-closed，视为锁定并告警。
        if (lockedTime > Date.now() || Number.isNaN(lockedTime)) {
          if (Number.isNaN(lockedTime)) {
            this.logger?.warn('user lockedUntil is not a valid date; treating account as locked', { userId: user.id });
          }
          throw new UnauthorizedError('Account is temporarily locked');
        }
      }
      // 在事务内基于最新行校验密码，避免“预读旧哈希 → 密码被重置 → 旧密码仍签发会话”的 TOCTOU。
      const valid = bcrypt.compareSync(password, user.passwordHash);
      if (!valid) {
        // S-M1：逐次退避锁定（1s,2s,4s,... 上限 60s），替代固定 5 次锁 15 分钟。
        // 合法用户输入错误密码时只短暂等待，攻击者每次尝试成本随时间递增。
        const attempts = user.loginAttempts + 1;
        const lockedUntil = new Date(Date.now() + Math.min(2 ** (attempts - 1) * 1000, 60_000)).toISOString();
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
    // B-M9：5 秒窗口内同一 token 的并发/重复 refresh 直接返回同一新会话，
    // 避免竞态触发 RFC 6819 会话族误吊销。
    const cached = this.refreshCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      const current = this.authRepository.findById(cached.session.user.id);
      if (current) {
        const user = rowToUser(current);
        if (user.active && user.tokenVersion === cached.session.user.tokenVersion) return cached.session;
      }
    }
    this.authRepository.cleanupUsedRefreshTokens(new Date(Date.now() - 90 * 86_400_000).toISOString());
    const preRow = this.authRepository.findByRefreshTokenHash(tokenHash);
    const usedRow = preRow ? null : this.authRepository.findUsedRefreshToken(tokenHash);
    const claimUserId = preRow?.id ?? usedRow?.userId ?? null;
    const dbCached = claimUserId ? this.readRefreshClaim(tokenHash, claimUserId) : null;
    if (dbCached) return dbCached;
    if (this.authRepository.isRefreshTokenUsed(tokenHash)) {
      // M5：refresh token 重用（被盗/重放）→ 按 RFC 6819 吊销整个会话族
      this.revokeReplayedFamily(tokenHash);
      throw new UnauthorizedError('Invalid refresh token (refresh token reuse detected)');
    }
    if (!preRow) throw new UnauthorizedError('Invalid refresh token');
    return runInTransactionImmediate(this.db, () => {
      const rowInTx = this.authRepository.findByRefreshTokenHash(tokenHash);
      if (!rowInTx) {
        const usedInTx = this.authRepository.findUsedRefreshToken(tokenHash);
        if (usedInTx?.userId) {
          const dbCachedInTx = this.readRefreshClaim(tokenHash, usedInTx.userId);
          if (dbCachedInTx) return dbCachedInTx;
        }
        if (this.authRepository.isRefreshTokenUsed(tokenHash)) {
          this.revokeReplayedFamily(tokenHash);
          throw new UnauthorizedError('Invalid refresh token (refresh token reuse detected)');
        }
        throw new UnauthorizedError('Invalid refresh token');
      }
      const dbCachedInTx = this.readRefreshClaim(tokenHash, rowInTx.id);
      if (dbCachedInTx) return dbCachedInTx;
      if (this.authRepository.isRefreshTokenUsed(tokenHash)) {
        this.revokeReplayedFamily(tokenHash);
        throw new UnauthorizedError('Invalid refresh token (refresh token reuse detected)');
      }
      const user = rowToUser(rowInTx);
      if (!user.active) throw new UnauthorizedError('User is disabled');
      if (user.lockedUntil) {
        const lockedTime = new Date(user.lockedUntil).getTime();
        // B-L3：lockedUntil 不可解析（NaN）时 fail-closed，视为锁定并告警。
        if (lockedTime > Date.now() || Number.isNaN(lockedTime)) {
          if (Number.isNaN(lockedTime)) {
            this.logger?.warn('user lockedUntil is not a valid date; treating account as locked', { userId: user.id });
          }
          throw new UnauthorizedError('Account is temporarily locked');
        }
      }
      const expiresAt = rowInTx.refreshTokenExpiresAt ? new Date(rowInTx.refreshTokenExpiresAt).getTime() : 0;
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
      const session: AuthSession = { token, refreshToken: nextRefreshToken, expiresIn: 8 * 60 * 60, user: safeUser };
      this.writeRefreshClaim(tokenHash, user.id, session);
      this.refreshCache.set(tokenHash, { expiresAt: Date.now() + AuthService.REFRESH_CACHE_TTL_MS, session });
      if (this.refreshCache.size > AuthService.REFRESH_CACHE_MAX) this.refreshCache.clear();
      return session;
    });
  }

  /** 注销 refresh token；返回该 token 归属的用户 id（未匹配到任何会话时返回 null）。 */
  async logout(refreshToken: string): Promise<string | null> {
    if (!refreshToken) return null;
    const tokenHash = hashRefreshToken(refreshToken);
    // B-M9：注销后同一 token 的缓存会话立即失效（防 5s 窗口内重放）。
    this.refreshCache.clear();
    const row = this.authRepository.findByRefreshTokenHash(tokenHash);
    if (!row) return null;
    this.clearUserRefreshClaims(row.id);
    const now = new Date().toISOString();
    this.authRepository.markRefreshTokenUsed(tokenHash, row.id, now);
    this.authRepository.clearRefreshToken(row.id, now);
    return row.id;
  }

  /** 重用检测后的会话族吊销（RFC 6819）：清除用户当前 refresh token 并使所有 access token 失效。 */
  private revokeReplayedFamily(tokenHash: string): void {
    // B-M9：重用即视为会话被攻破，清空所有缓存会话，杜绝 5s 窗口内的缓存重放。
    this.refreshCache.clear();
    try {
      const used = this.authRepository.findUsedRefreshToken(tokenHash);
      if (used?.userId) {
        this.authRepository.revokeSessionFamily(used.userId, new Date().toISOString());
        this.clearUserRefreshClaims(used.userId);
      }
    } catch {
      // 重用已被拒绝；吊销为尽力而为
    }
  }

  /** 跨实例共享的 refresh 轮换缓存：以 DB 原子 claim 替代仅进程内缓存。 */
  private readRefreshClaim(tokenHash: string, userId: string): AuthSession | null {
    const key = this.refreshClaimKey(tokenHash, userId);
    const row = this.db.prepare(
      `SELECT responseJson, expiresAt FROM IdempotencyRecord
       WHERE key = ? AND operation = 'auth.refresh' AND status = 'COMPLETED'
       ORDER BY createdAt DESC LIMIT 1`,
    ).get(key) as { responseJson: string; expiresAt: string | null } | undefined;
    if (!row?.expiresAt || new Date(row.expiresAt).getTime() <= Date.now()) return null;
    try {
      const session = JSON.parse(row.responseJson) as AuthSession;
      const current = this.authRepository.findById(userId);
      if (!current) return null;
      const user = rowToUser(current);
      if (!user.active || user.tokenVersion !== session.user.tokenVersion) return null;
      return session;
    } catch {
      return null;
    }
  }

  private writeRefreshClaim(tokenHash: string, userId: string, session: AuthSession): void {
    const key = this.refreshClaimKey(tokenHash, userId);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + AuthService.REFRESH_CACHE_TTL_MS).toISOString();
    this.db.prepare(
      `DELETE FROM IdempotencyRecord WHERE key = ? AND operation = 'auth.refresh'`,
    ).run(key);
    this.db.prepare(
      `INSERT INTO IdempotencyRecord (
         id, key, type, status, responseJson, result, userId, clinicId, operation,
         createdAt, updatedAt, deletedAt, expiresAt
       ) VALUES (?, ?, 'GENERIC', 'COMPLETED', ?, ?, ?, NULL, 'auth.refresh', ?, ?, NULL, ?)`,
    ).run(randomUUID(), key, JSON.stringify(session), JSON.stringify(session), userId, now, now, expiresAt);
  }

  private clearUserRefreshClaims(userId: string): void {
    try {
      this.db.prepare(
        `DELETE FROM IdempotencyRecord WHERE operation = 'auth.refresh' AND userId = ?`,
      ).run(userId);
    } catch {
      // 缓存清理为尽力而为；会话族吊销与标记已用是权威路径
    }
  }

  private refreshClaimKey(tokenHash: string, userId: string): string {
    return createHash('sha256')
      .update(['auth.refresh', tokenHash, userId].join('\0'))
      .digest('hex');
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
    if (!clinicId) return false; // 无诊所作用域一律 fail-closed，避免旧 token 绕过租户过滤
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
    if (!['BOSS', 'ADMIN'].includes(role)) {
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
      `SELECT u.id, u.name, u.phone, u.role FROM User u
       WHERE u.role = 'DOCTOR' AND u.active = 1 AND u.deletedAt IS NULL
         ${context.clinicId
           ? `AND (EXISTS (
                 SELECT 1 FROM UserClinic uc
                 WHERE uc.userId = u.id AND uc.clinicId = ? AND uc.deletedAt IS NULL
               ) OR u.clinicId = ?)`
           : ''}
       ORDER BY u.name ASC`,
    ).all(...(context.clinicId ? [context.clinicId, context.clinicId] : [])) as Array<{ id: string; name: string; phone: string | null; role: string }>;
    return rows;
  }

  effectivePermissions(userId: string, clinicId: string | null, role: UserRole): string[] {
    return computeEffectivePermissions(this.db, userId, clinicId, role);
  }

  switchClinic(userId: string, role: User['role'], clinicId: string): { token: string; clinicId: string } {
    if (!['BOSS', 'ADMIN'].includes(role)) {
      throw new AppError('FORBIDDEN', 'Only administrators can switch clinics', 403);
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
    assertPasswordLength(newPassword);
    const hash = await bcrypt.hash(newPassword, 10);
    const now = new Date().toISOString();
    runInTransaction(this.db, () => {
      this.authRepository.updatePassword(userId, hash, now);
      this.authRepository.clearRefreshToken(userId, now);
      this.db.prepare?.('UPDATE User SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?')?.run(now, userId);
    });
  }

  createUser(
    input: Parameters<UserManagementService['createUser']>[0],
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    return this.userManagement.createUser(input, context);
  }

  updateUser(
    id: string,
    input: { name?: string; phone?: string; role?: string; active?: boolean },
    context: AppContext,
  ): Promise<Omit<User, 'passwordHash'>> {
    return this.userManagement.updateUser(id, input, context);
  }

  resetPassword(id: string, newPassword: string, context: AppContext): Promise<{ id: string }> {
    return this.userManagement.resetPassword(id, newPassword, context);
  }

  deleteUser(id: string, context: AppContext): Promise<{ id: string }> {
    return this.userManagement.deleteUser(id, context);
  }

  private sign(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
  }
}
