import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../db/db.service';
import { UpdateBuilder } from '../../common/utils/db/sql-builder';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { CacheService } from '../../common/services/cache.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CACHE_PREFIXES, buildCacheKey } from '../../common/constants/cache-keys';
import { PAGINATION } from '../../common/constants/pagination';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { PasswordPolicyService } from './password-policy.service';

export interface ListUsersResult {
  items: UserSummaryRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserSummaryRow {
  id: string;
  name: string;
  role: string;
  username: string;
  phone: string | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  username: string;
  passwordHash?: string;
  active?: number;
  name?: string;
  role?: string;
  clinicId?: string;
  phone?: string;
}

/**
 * 用户管理服务 - 负责用户 CRUD 和密码修改
 */
@Injectable()
export class UserManagementService {
  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
    private cache: CacheService,
    private auditLogService: AuditLogService,
    private passwordPolicy: PasswordPolicyService,
  ) {}

  async listUsers(role?: string): Promise<ListUsersResult | UserSummaryRow[]> {
    try {
      const clinicId = this.clinicContext.getClinicId();
      const page = 1;
      const pageSize = PAGINATION.DEFAULT_PAGE_SIZE_LARGE;
      let query = "SELECT id, name, role, username, phone, createdAt FROM User WHERE active = 1 AND clinicId = ?";
      const countQuery = "SELECT COUNT(*) as total FROM User WHERE active = 1 AND clinicId = ?";
      const params: unknown[] = [clinicId];
      if (role) { query += " AND role = ?"; params.push(role); }
      query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
      params.push(pageSize, (page - 1) * pageSize);

      let countQ = countQuery;
      const countParams: unknown[] = [clinicId];
      if (role) { countQ += " AND role = ?"; countParams.push(role); }
      const total = (this.dbService.prepare(countQ).get(...countParams) as { total: number }).total;
      const items = this.dbService.prepare(query).all(...params) as UserSummaryRow[];
      return { items, total, page, pageSize };
    } catch {
      const clinicId = this.clinicContext.getClinicId();
      return this.dbService.prepare("SELECT id, name, role, username, phone, createdAt FROM User WHERE active = 1 AND clinicId = ? ORDER BY createdAt DESC LIMIT 100 OFFSET 0").all(clinicId) as UserSummaryRow[];
    }
  }

  async createUser(dto: { username: string; password: string; name: string; role: string; phone?: string }): Promise<UserSummaryRow> {
    const clinicId = this.clinicContext.getClinicId();
    const existing = this.dbService.prepare("SELECT id FROM User WHERE username = ? AND clinicId = ?").get(dto.username, clinicId);
    if (existing) throw new BusinessValidationException("用户名已存在");
    const passwordHash = await this.passwordPolicy.hashPassword(dto.password);
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const isTempPassword = this.passwordPolicy.isTempPasswordFormat(dto.password) ? 1 : 0;
    this.dbService.prepare("INSERT INTO User (id, username, passwordHash, name, role, phone, clinicId, createdAt, updatedAt, passwordChangedAt, isTempPassword) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(userId, dto.username, passwordHash, dto.name, dto.role, dto.phone || null, clinicId, now, now, now, isTempPassword);
    this.auditLogService.logAudit(this.dbService, "USER_CREATE", userId, "User", clinicId, {
      afterData: { username: dto.username, name: dto.name, role: dto.role },
    });
    return this.dbService.prepare("SELECT id, name, role, username, phone, createdAt FROM User WHERE username = ? AND clinicId = ?").get(dto.username, clinicId) as UserSummaryRow;
  }

  async updateUser(id: string, dto: { name?: string; role?: string; phone?: string; active?: number }): Promise<UserSummaryRow> {
    const clinicId = this.clinicContext.getClinicId();
    const user = this.dbService.prepare("SELECT id, name, role, phone FROM User WHERE id = ? AND clinicId = ?").get(id, clinicId) as UserRow | undefined;
    if (!user) throw new BusinessNotFoundException("用户不存在");
    const beforeData = JSON.stringify({ name: user.name, role: user.role, phone: user.phone });
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
    // P4-1: name/role/active 变更后，UserInfo 缓存可能脏，主动失效
    this.cache.del(buildCacheKey(CACHE_PREFIXES.USER, id));
    const afterData = JSON.stringify({ name: dto.name ?? user.name, role: dto.role ?? user.role, phone: dto.phone ?? user.phone, active: dto.active });
    this.auditLogService.logAudit(this.dbService, "USER_UPDATE", id, "User", clinicId, {
      beforeData,
      afterData,
    });
    return this.dbService.prepare("SELECT id, name, role, username, phone, createdAt FROM User WHERE id = ?").get(id) as UserSummaryRow;
  }

  async deleteUser(id: string) {
    const clinicId = this.clinicContext.getClinicId();
    const user = this.dbService.prepare("SELECT id, role FROM User WHERE id = ? AND clinicId = ?").get(id, clinicId) as UserRow;
    if (!user) throw new BusinessNotFoundException("用户不存在");
    if (user.role === "BOSS") throw new BusinessValidationException("不能删除老板账号");
    this.dbService.prepare("UPDATE User SET active = 0, tokenVersion = COALESCE(tokenVersion, 0) + 1, updatedAt = ? WHERE id = ? AND clinicId = ?")
      .run(new Date().toISOString(), id, clinicId);
    // P4-1: 删除用户（软删 + tokenVersion+1）后失效 UserInfo 缓存
    this.cache.del(buildCacheKey(CACHE_PREFIXES.USER, id));
    this.auditLogService.logAudit(this.dbService, "USER_DELETE", id, "User", clinicId, {
      beforeData: { active: 1, role: user.role },
      afterData: { active: 0 },
    });
  }

  async changePassword(userId: string, dto: { oldPassword: string; newPassword: string }) {
    const clinicId = this.clinicContext.getClinicId();
    const user = this.dbService.prepare("SELECT id, passwordHash, active FROM User WHERE id = ? AND clinicId = ?").get(userId, clinicId) as UserRow | undefined;
    if (!user?.active) throw new BusinessNotFoundException("用户不存在或已禁用");
    const ok = await this.passwordPolicy.comparePassword(dto.oldPassword, user.passwordHash ?? '');
    if (!ok) throw new BusinessValidationException("原密码错误");
    if (dto.oldPassword === dto.newPassword) throw new BusinessValidationException("新密码不能与原密码相同");
    const passwordHash = await this.passwordPolicy.hashPassword(dto.newPassword);
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE User SET passwordHash = ?, passwordChangedAt = ?, isTempPassword = 0, tokenVersion = COALESCE(tokenVersion, 0) + 1, updatedAt = ? WHERE id = ? AND clinicId = ?")
      .run(passwordHash, now, now, userId, clinicId);
    // P4-1: 改密后 tokenVersion+1，旧 token 全部失效；UserInfo 缓存也需同步失效
    this.cache.del(buildCacheKey(CACHE_PREFIXES.USER, userId));
    this.auditLogService.logAudit(this.dbService, "PASSWORD_CHANGE", userId, "User", clinicId);
    return { success: true };
  }
}
