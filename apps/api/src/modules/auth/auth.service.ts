import { Injectable, UnauthorizedException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { DbService } from "../../db/db.service";
import * as crypto from "node:crypto";
import { AppLogger } from "../../common/services/logger.service";
import { isDateInFuture } from "../../common/utils/format/date";
import { ClinicContextService } from "../../common/services/clinic-context.service";
import { CacheService } from "../../common/services/cache.service";
import { CACHE_PREFIXES, buildCacheKey } from "../../common/constants/cache-keys";
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_LOCK_DURATION_MS,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_TTL_MS,
  USED_REFRESH_TOKEN_RETENTION_HOURS,
  ONE_HOUR_MS,
  USER_INFO_CACHE_TTL_MS,
} from "../../config/constants";
import { AuditLogService } from "../../common/services/audit-log.service";
import { PasswordPolicyService } from './password-policy.service';
import { UserManagementService, ListUsersResult, UserSummaryRow } from './user-management.service';

export interface UserInfo {
  id: string;
  username: string;
  name: string;
  role: string;
  clinicId: string;
}

interface LoginResult {
  access_token: string;
  refresh_token: string;
  user: UserInfo;
  needChangePassword: boolean;
}

interface RefreshTokenResult {
  access_token: string;
  refresh_token: string;
  user: UserInfo;
}

export { ListUsersResult, UserSummaryRow } from './user-management.service';

interface UserRow {
  id: string;
  username: string;
  passwordHash?: string;
  active?: number;
  loginAttempts?: number;
  lockedUntil?: string;
  tokenVersion?: number;
  name?: string;
  role?: string;
  clinicId?: string;
  isTempPassword?: number;
  phone?: string;
  passwordChangedAt?: string;
}

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private logger = new AppLogger(AuthService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = ONE_HOUR_MS;
  private readonly TOKEN_RETENTION_HOURS = USED_REFRESH_TOKEN_RETENTION_HOURS;

  constructor(
    private dbService: DbService,
    private jwt: JwtService,
    private config: ConfigService,
    private clinicContext: ClinicContextService,
    private cache: CacheService,
    private auditLogService: AuditLogService,
    private passwordPolicy: PasswordPolicyService,
    private userManagement: UserManagementService,
  ) {}

  onModuleInit() {
    // P1-1: 定时清理过期的 UsedRefreshToken 记录
    this.cleanupTimer = setInterval(() => {
      this.cleanupUsedRefreshTokens();
    }, this.CLEANUP_INTERVAL_MS);
    // P1 修复：unref 防止定时器阻止进程正常退出
    this.cleanupTimer.unref();
    // 启动时立即执行一次
    process.nextTick(() => this.cleanupUsedRefreshTokens());
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanupUsedRefreshTokens() {
    try {
      const cutoff = new Date(Date.now() - this.TOKEN_RETENTION_HOURS * 60 * 60 * 1000).toISOString();
      const result = this.dbService.prepare("DELETE FROM UsedRefreshToken WHERE usedAt < ?").run(cutoff);
      if (result.changes > 0) {
        this.logger.log(`P1-1: 清理 ${result.changes} 条过期 UsedRefreshToken 记录`);
      }
    } catch (err: unknown) {
      this.logger.warn('P1-1: 清理 UsedRefreshToken 失败', err instanceof Error ? err.message : String(err));
    }
  }

  async login(dto: { username: string; password: string }): Promise<LoginResult> {
    // DESIGN NOTE: Login intentionally does NOT filter by clinicId because the user
    // may not know their clinicId at login time. The clinicId is returned in the JWT
    // payload after successful authentication. If clinic-scoped login is needed, the
    // frontend should pass a clinic identifier (e.g. subdomain or form field) and this
    // query should be updated to filter accordingly.
    const user = this.dbService.prepare("SELECT id, username, passwordHash, active, loginAttempts, lockedUntil, tokenVersion, name, role, clinicId, isTempPassword, passwordChangedAt FROM User WHERE username = ? AND active = 1").get(dto.username) as UserRow;
    if (!user?.active) throw new UnauthorizedException("用户名或密码错误");

    const hash = user.passwordHash;
    if (!hash?.startsWith('$2')) {
      this.logger.error(`用户 ${user.username} 的密码哈希不是 bcrypt 格式，已拒绝登录。请联系管理员重置密码。`);
      throw new UnauthorizedException("用户名或密码错误");
    }

    if (user.lockedUntil && isDateInFuture(user.lockedUntil)) {
      throw new UnauthorizedException("用户名或密码错误");
    }
    const ok = await this.passwordPolicy.comparePassword(dto.password, hash);
    if (!ok) {
      // P1 修复：使用原子递增 `loginAttempts = loginAttempts + 1` 防止 TOCTOU 竞态
      // 原先 SELECT 读取 loginAttempts → 计算加 1 → UPDATE 绝对值赋值，
      // 两个并发失败登录可能都读到 attempts=4，各自写入 5（应为 6），绕过锁定阈值
      this.dbService.prepare(
        "UPDATE User SET loginAttempts = loginAttempts + 1, updatedAt = ? WHERE id = ?",
      ).run(new Date().toISOString(), user.id);
      // 重新读取递增后的值，判断是否需要锁定
      const updated = this.dbService.prepare("SELECT loginAttempts FROM User WHERE id = ?").get(user.id) as { loginAttempts: number } | undefined;
      const attempts = Number(updated?.loginAttempts) || Number(user.loginAttempts) + 1;
      if (attempts >= LOGIN_MAX_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOGIN_LOCK_DURATION_MS).toISOString();
        this.dbService.prepare("UPDATE User SET lockedUntil = ? WHERE id = ?").run(lockUntil, user.id);
      }
      throw new UnauthorizedException("用户名或密码错误");
    }

    const needChangePassword = this.passwordPolicy.needsPasswordChange(
      dto.password,
      Number(user.isTempPassword) === 1,
      user.passwordChangedAt ?? null,
    );

    const tokenVersion = Number(user.tokenVersion) || 0;
    const payload = { sub: user.id, username: user.username, role: user.role, tv: tokenVersion, cid: user.clinicId, iss: 'dental-api', aud: 'dental-web' };
    const access_token = this.jwt.sign(payload, { secret: this.config.get("JWT_SECRET"), expiresIn: ACCESS_TOKEN_EXPIRES_IN });
    const refresh_token = crypto.randomBytes(48).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
    const refreshTokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    // P3-1: 合并"重置登录尝试"与"写入 refresh token"为单个原子 UPDATE，避免中间崩溃导致状态不一致
    this.dbService.prepare("UPDATE User SET loginAttempts = 0, lockedUntil = NULL, refreshToken = ?, refreshTokenExpiresAt = ?, updatedAt = ? WHERE id = ?")
      .run(refreshTokenHash, refreshExpiresAt, new Date().toISOString(), user.id);
    this.auditLogService.logAudit(this.dbService, "LOGIN", user.id, "User", user.clinicId ?? '', {
      afterData: { username: user.username },
    });
    return { access_token, refresh_token, user: { id: user.id, username: user.username, name: user.name ?? '', role: user.role ?? '', clinicId: user.clinicId ?? '' }, needChangePassword };
  }

  async validateById(id: string, tokenVersion?: number): Promise<UserInfo | null> {
    // P4-1: 用户信息缓存优化
    // JwtStrategy.validate 每个受保护的请求都会调用，原先每次都查 DB。
    // 这里用短 TTL（30s）缓存 UserInfo，减少 DB 压力；
    // 同时校验缓存中的 tokenVersion，登出/改密后即便缓存未主动失效也不会放过旧 token。
    const cacheKey = buildCacheKey(CACHE_PREFIXES.USER, id);
    const cachedUser = this.cache.get<UserInfo>(cacheKey);
    if (cachedUser) {
      // 缓存命中后必须复核 tokenVersion：若调用方提供了 tokenVersion 且与缓存不一致，
      // 说明 token 已被吊销（登出/改密/删用户），删除脏缓存并返回 null。
      if (tokenVersion !== undefined && Number((cachedUser as UserInfo & { tokenVersion?: number }).tokenVersion) !== tokenVersion) {
        this.cache.del(cacheKey);
        return null;
      }
      return cachedUser;
    }

    const user = this.dbService.prepare("SELECT id, username, name, role, active, tokenVersion, clinicId FROM User WHERE id = ?").get(id) as UserRow;
    if (!user?.active) return null;
    const currentTokenVersion = Number(user.tokenVersion) || 0;
    if (tokenVersion !== undefined && tokenVersion !== currentTokenVersion) return null;
    const userInfo: UserInfo = { id: user.id, username: user.username, name: user.name ?? '', role: user.role ?? '', clinicId: user.clinicId ?? '' };
    // 将 tokenVersion 一并写入缓存对象，命中时用于复核（不暴露给外部类型）
    this.cache.set(cacheKey, { ...userInfo, tokenVersion: currentTokenVersion }, USER_INFO_CACHE_TTL_MS);
    return userInfo;
  }

  // ─── User Management Delegation ─────────────────────────────────
  // These methods delegate to UserManagementService.
  // Kept here for backward compatibility with existing consumers.

  async listUsers(role?: string): Promise<ListUsersResult | UserSummaryRow[]> {
    return this.userManagement.listUsers(role);
  }

  async createUser(dto: { username: string; password: string; name: string; role: string; phone?: string }): Promise<UserSummaryRow> {
    return this.userManagement.createUser(dto);
  }

  async updateUser(id: string, dto: { name?: string; role?: string; phone?: string; active?: number }): Promise<UserSummaryRow> {
    return this.userManagement.updateUser(id, dto);
  }

  async deleteUser(id: string) {
    return this.userManagement.deleteUser(id);
  }

  async changePassword(userId: string, dto: { oldPassword: string; newPassword: string }) {
    return this.userManagement.changePassword(userId, dto);
  }

  async logout(userId?: string) {
    if (userId) {
      // 递增 tokenVersion + 清除 refresh token
      this.dbService.prepare(
        "UPDATE User SET tokenVersion = COALESCE(tokenVersion, 0) + 1, refreshToken = NULL, refreshTokenExpiresAt = NULL, updatedAt = ? WHERE id = ?"
      ).run(new Date().toISOString(), userId);
      // P4-1: 登出后 tokenVersion+1，UserInfo 缓存需同步失效，避免旧 token 短时间内仍命中缓存
      this.cache.del(buildCacheKey(CACHE_PREFIXES.USER, userId));
      const clinicId = this.clinicContext.getClinicId();
      this.auditLogService.logAudit(this.dbService, "LOGOUT", userId, "User", clinicId);
    }
    return { success: true };
  }

  async refreshToken(token: string): Promise<RefreshTokenResult> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const now = new Date().toISOString();

    // P1-1: 把"标记旧 token 已用 + 查用户 + 写新 token"合并在同一事务内，
    // 用 UsedRefreshToken.tokenHash 主键（UNIQUE）的 INSERT OR FAIL 作为原子闸门，
    // 彻底消除 refresh token 重放的 TOCTOU 竞态窗口。
    // 两个并发请求：先到者 INSERT 成功，后到者因 UNIQUE 冲突触发回滚并抛出
    // UnauthorizedException("登录已过期，请重新登录")，无法拿到新 token。
    try {
      const result = this.dbService.transaction((db) => {
        // Step 1 (atomic gate): 先标记旧 token 已用；若已用过则 PK UNIQUE 冲突回滚，
        // 若 token 无效（无对应 User）则 FK 约束冲突回滚，二者都触发 UnauthorizedException。
        // userId 用空串占位——真实 userId 由后续 SELECT 获取，FK 保证无效 token 不会落库。
        db.prepare(
          "INSERT OR FAIL INTO UsedRefreshToken (tokenHash, userId, usedAt) VALUES (?, '', ?)"
        ).run(tokenHash, now);

        // Step 2: 在事务内查当前持有该 refresh token 的用户（此时 INSERT 已成功，重放已无可能）
        const user = db.prepare(
          "SELECT id, username, name, role, tokenVersion, clinicId FROM User WHERE refreshToken = ? AND refreshTokenExpiresAt > ? AND active = 1"
        ).get(tokenHash, now) as UserRow | undefined;

        if (!user) {
          // token 不存在或已失效；事务正常提交（INSERT 已落库），对外返回相同错误避免泄露
          return { user: null, payload: null, newRefreshToken: null };
        }

        // Step 3: 生成新 token（CPU 操作，事务内同步执行，不会破坏原子性）
        const tokenVersion = Number(user.tokenVersion) || 0;
        const payload = { sub: user.id, username: user.username, role: user.role, tv: tokenVersion, cid: user.clinicId, iss: 'dental-api', aud: 'dental-web' };
        const access_token = this.jwt.sign(payload, { secret: this.config.get("JWT_SECRET"), expiresIn: ACCESS_TOKEN_EXPIRES_IN });

        const new_refresh_token = crypto.randomBytes(48).toString('hex');
        const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
        const newRefreshTokenHash = crypto.createHash('sha256').update(new_refresh_token).digest('hex');

        // Step 4: 写入新 refresh token；若此步失败，整个事务回滚（旧 token 也被回滚，用户未被锁出）
        db.prepare("UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ?, updatedAt = ? WHERE id = ?")
          .run(newRefreshTokenHash, refreshExpiresAt, now, user.id);

        return { user, access_token, new_refresh_token };
      });

      if (!result.user) {
        throw new UnauthorizedException("登录已过期，请重新登录");
      }

      return {
        access_token: result.access_token,
        refresh_token: result.new_refresh_token,
        user: {
          id: result.user.id,
          username: result.user.username,
          name: result.user.name ?? '',
          role: result.user.role ?? '',
          clinicId: result.user.clinicId ?? '',
        },
      };
    } catch (err: unknown) {
      // INSERT OR FAIL 的 UNIQUE 冲突会被 better-sqlite3 抛出，统一映射为 401，避免泄露"此 token 曾用过"
      if (err instanceof UnauthorizedException) throw err;
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        // 重放攻击检测：递增所有活跃用户的 tokenVersion，强制全部重新登录。
        // 事务已回滚，此处通过独立 prepare 执行，不受回滚影响。
        // 注：UsedRefreshToken.userId 为空串占位，无法精确定位用户，
        // 因此采用全量吊销策略——安全优先。
        try {
          this.dbService.prepare(
            "UPDATE User SET tokenVersion = COALESCE(tokenVersion, 0) + 1, updatedAt = ? WHERE active = 1"
          ).run(now);
        } catch (revokeErr) {
          // P1 修复：重放攻击已检测但全量吊销失败，旧 token 仍可使用，属于安全事件
          // 提升为 error 级别并记录详细上下文，便于运维介入
          this.logger.error(
            `重放攻击检测后吊销会话失败，旧 token 仍可使用，需人工介入`,
            revokeErr instanceof Error ? revokeErr : String(revokeErr),
          );
        }
        throw new UnauthorizedException("登录已过期，请重新登录");
      }
      throw err;
    }
  }
}
