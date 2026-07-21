import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { DbService } from "../../db/db.service";
import * as crypto from "crypto";
import { UpdateBuilder } from "../../common/utils/sql-builder";
import { AppLogger } from "../../common/services/logger.service";
import { isDateInFuture } from "../../common/utils/date";

@Injectable()
export class AuthService {
  private logger = new AppLogger(AuthService.name);
  constructor(private dbService: DbService, private jwt: JwtService, private config: ConfigService) {}

  async login(dto: { username: string; password: string }) {
    const user = this.dbService.prepare("SELECT id, username, passwordHash, active, loginAttempts, lockedUntil, tokenVersion, name, role, clinicId FROM User WHERE username = ?").get(dto.username) as Record<string, unknown>;
    if (!user || !user.active) throw new UnauthorizedException("用户名或密码错误");

    const hash = user.passwordHash as string;
    if (!hash || !hash.startsWith('$2')) {
      this.logger.error(`用户 ${user.username} 的密码哈希不是 bcrypt 格式，已拒绝登录。请联系管理员重置密码。`);
      throw new UnauthorizedException("用户名或密码错误");
    }

    if (user.lockedUntil && isDateInFuture(user.lockedUntil as string)) {
      throw new UnauthorizedException("用户名或密码错误");
    }
    const ok = await bcrypt.compare(dto.password, hash);
    if (!ok) {
      const attempts = Number(user.loginAttempts) + 1;
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        this.dbService.prepare("UPDATE User SET loginAttempts = ?, lockedUntil = ? WHERE id = ?").run(attempts, lockUntil, user.id);
        throw new UnauthorizedException("用户名或密码错误");
      }
      this.dbService.prepare("UPDATE User SET loginAttempts = ? WHERE id = ?").run(attempts, user.id);
      throw new UnauthorizedException("用户名或密码错误");
    }
    if (Number(user.loginAttempts) > 0 || user.lockedUntil) {
      this.dbService.prepare("UPDATE User SET loginAttempts = 0, lockedUntil = NULL WHERE id = ?").run(user.id);
    }
    const tokenVersion = Number(user.tokenVersion) || 0;
    const payload = { sub: user.id, username: user.username, role: user.role, tv: tokenVersion, cid: user.clinicId };
    const access_token = this.jwt.sign(payload, { secret: this.config.get("JWT_SECRET"), expiresIn: '1h' });
    const refresh_token = crypto.randomBytes(48).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const refreshTokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    this.dbService.prepare("UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ?, updatedAt = ? WHERE id = ?")
      .run(refreshTokenHash, refreshExpiresAt, new Date().toISOString(), user.id);
    return { access_token, refresh_token, user: { id: user.id, username: user.username, name: user.name, role: user.role, clinicId: user.clinicId } };
  }

  async validateById(id: string, tokenVersion?: number) {
    const user = this.dbService.prepare("SELECT id, username, name, role, active, tokenVersion, clinicId FROM User WHERE id = ?").get(id) as Record<string, unknown>;
    if (!user || !user.active) return null;
    const currentTokenVersion = Number(user.tokenVersion) || 0;
    if (tokenVersion !== undefined && tokenVersion !== currentTokenVersion) return null;
    return { id: user.id, username: user.username, name: user.name, role: user.role, clinicId: user.clinicId };
  }

  async listUsers(role?: string) {
    try {
      const page = 1;
      const pageSize = 200;
      let query = "SELECT id, name, role, username, phone, createdAt FROM User WHERE active = 1";
      const countQuery = "SELECT COUNT(*) as total FROM User WHERE active = 1";
      const params: unknown[] = [];
      if (role) { query += " AND role = ?"; params.push(role); }
      query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
      params.push(pageSize, (page - 1) * pageSize);

      let countQ = countQuery;
      if (role) { countQ += " AND role = ?"; }
      const total = (this.dbService.prepare(countQ).get(...(role ? [role] : [])) as { total: number }).total;
      const items = this.dbService.prepare(query).all(...params);
      return { items, total, page, pageSize };
    } catch (err) {
      this.logger.warn('listUsers pagination query failed, falling back to simple query', err);
      return this.dbService.prepare("SELECT id, name, role, username, phone, createdAt FROM User WHERE active = 1 ORDER BY createdAt DESC").all();
    }
  }

  async createUser(dto: { username: string; password: string; name: string; role: string; phone?: string }) {
    const existing = this.dbService.prepare("SELECT id FROM User WHERE username = ?").get(dto.username);
    if (existing) throw new BadRequestException("Username already exists");
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const now = new Date().toISOString();
    this.dbService.prepare("INSERT INTO User (id, username, passwordHash, name, role, phone, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), dto.username, passwordHash, dto.name, dto.role, dto.phone || null, now, now);
    return this.dbService.prepare("SELECT id, name, role, username, phone, createdAt FROM User WHERE username = ?").get(dto.username);
  }

  async updateUser(id: string, dto: { name?: string; role?: string; phone?: string; active?: number }) {
    const user = this.dbService.prepare("SELECT id FROM User WHERE id = ?").get(id);
    if (!user) throw new NotFoundException("User not found");
    const builder = new UpdateBuilder("User");
    builder.set("name", dto.name);
    builder.set("role", dto.role);
    builder.set("phone", dto.phone);
    builder.set("active", dto.active);
    builder.setUpdatedAt();
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return this.dbService.prepare("SELECT id, name, role, username, phone, createdAt FROM User WHERE id = ?").get(id);
  }

  async deleteUser(id: string) {
    const user = this.dbService.prepare("SELECT id, role FROM User WHERE id = ?").get(id) as Record<string, unknown>;
    if (!user) throw new NotFoundException("User not found");
    if (user.role === "BOSS") throw new BadRequestException("Cannot delete boss account");
    this.dbService.prepare("UPDATE User SET active = 0, tokenVersion = COALESCE(tokenVersion, 0) + 1, updatedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  async changePassword(userId: string, dto: { oldPassword: string; newPassword: string }) {
    const user = this.dbService.prepare("SELECT id, passwordHash, active FROM User WHERE id = ?").get(userId) as Record<string, unknown>;
    if (!user || !user.active) throw new NotFoundException("User not found or disabled");
    const ok = await bcrypt.compare(dto.oldPassword, user.passwordHash as string);
    if (!ok) throw new BadRequestException("Wrong old password");
    if (dto.oldPassword === dto.newPassword) throw new BadRequestException("New password must differ");
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    this.dbService.prepare("UPDATE User SET passwordHash = ?, tokenVersion = COALESCE(tokenVersion, 0) + 1, updatedAt = ? WHERE id = ?")
      .run(passwordHash, new Date().toISOString(), userId);
    return { success: true };
  }

  async logout(userId?: string) {
    if (userId) {
      // 递增 tokenVersion + 清除 refresh token
      this.dbService.prepare(
        "UPDATE User SET tokenVersion = COALESCE(tokenVersion, 0) + 1, refreshToken = NULL, refreshTokenExpiresAt = NULL, updatedAt = ? WHERE id = ?"
      ).run(new Date().toISOString(), userId);
    }
    return { success: true };
  }

  async refreshToken(token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Step 1: Check if this exact token hash was already used (reuse detection)
    const usedRecord = this.dbService.prepare(
      "SELECT userId FROM UsedRefreshToken WHERE tokenHash = ?"
    ).get(tokenHash) as Record<string, unknown> | undefined;

    if (usedRecord) {
      // REUSE DETECTED: Invalidate ALL tokens for this user
      this.dbService.prepare(
        "UPDATE User SET tokenVersion = COALESCE(tokenVersion, 0) + 1, refreshToken = NULL, refreshTokenExpiresAt = NULL, updatedAt = ? WHERE id = ?"
      ).run(new Date().toISOString(), usedRecord.userId as string);
      throw new UnauthorizedException("Refresh token has been reused — all sessions invalidated");
    }

    // Step 2: Find the user with this as their current valid refresh token
    const user = this.dbService.prepare(
      "SELECT id, username, name, role, tokenVersion FROM User WHERE refreshToken = ? AND refreshTokenExpiresAt > ? AND active = 1"
    ).get(tokenHash, new Date().toISOString()) as Record<string, unknown> | undefined;

    if (!user) throw new UnauthorizedException("Refresh token invalid or expired");

    // Step 3: Mark current token as used BEFORE issuing new ones
    this.dbService.prepare(
      "INSERT OR IGNORE INTO UsedRefreshToken (tokenHash, userId, usedAt) VALUES (?, ?, ?)"
    ).run(tokenHash, user.id as string, new Date().toISOString());

    // Step 4: Issue new access token (1h)
    const tokenVersion = Number(user.tokenVersion) || 0;
    const payload = { sub: user.id, username: user.username, role: user.role, tv: tokenVersion };
    const access_token = this.jwt.sign(payload, { secret: this.config.get("JWT_SECRET"), expiresIn: '1h' });

    // Step 5: Issue new refresh token (rotation)
    const new_refresh_token = crypto.randomBytes(48).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const newRefreshTokenHash = crypto.createHash('sha256').update(new_refresh_token).digest('hex');
    this.dbService.prepare("UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ?, updatedAt = ? WHERE id = ?")
      .run(newRefreshTokenHash, refreshExpiresAt, new Date().toISOString(), user.id as string);

    // Periodic cleanup of old UsedRefreshToken entries (>25h)
    this.dbService.prepare("DELETE FROM UsedRefreshToken WHERE usedAt < ?")
      .run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());

    return {
      access_token,
      refresh_token: new_refresh_token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    };
  }
}
