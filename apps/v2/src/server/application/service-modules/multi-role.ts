/**
 * 多岗位（一人多角色）+ 角色权限配置基础服务。
 *
 * - UserRole 表无 id 列（PRIMARY KEY(userId, role)），无法走通用资源 CRUD，
 *   因此提供专用服务与路由；
 * - UserRole 虽带 deletedAt 列，但主键无法承载软删重复行，故按硬删处理：
 *   insert 时 deletedAt 为 NULL，移除时直接 DELETE 行；listAll 过滤 deletedAt IS NULL；
 * - 附加角色不包含用户主角色（User.role），setRoles 会自动跳过主角色值。
 */
import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams, tenantWhere } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import { UserRole as USER_ROLES } from '../../../domain/contracts';

export interface UserRoleRow {
  userId: string;
  role: string;
  clinicId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

const VALID_ROLES = new Set<string>(Object.values(USER_ROLES));

export class UserRoleService {
  constructor(private readonly db: Database.Database) {}

  /** 本诊所全部非软删 UserRole 行，供页面一次加载后按 userId 过滤。 */
  listAll(context: AppContext): UserRoleRow[] {
    const tenant = tenantWhere(context.clinicId, 'clinicId');
    return this.db.prepare(
      `SELECT userId, role, clinicId, createdAt, updatedAt, deletedAt
       FROM UserRole
       WHERE deletedAt IS NULL${tenant.sql ? ` AND ${tenant.sql}` : ''}
       ORDER BY createdAt ASC`,
    ).all(...tenant.params) as UserRoleRow[];
  }

  /**
   * 事务内 diff 替换用户的附加角色：
   * - 等于用户主角色（User.role）的值自动跳过；
   * - 非法 role 值抛 ValidationError；用户不存在（租户过滤）抛 NotFoundError；
   * - 新增 INSERT UserRole（主键冲突时恢复/保留已存在行），移除直接 DELETE；
   * - 返回最终附加角色数组。
   */
  setRoles(userId: string, roles: string[], context: AppContext): string[] {
    if (!Array.isArray(roles) || roles.some((role) => typeof role !== 'string')) {
      throw new ValidationError('roles 必须是字符串数组');
    }
    for (const role of roles) {
      if (!VALID_ROLES.has(role)) {
        throw new ValidationError(`非法的角色值: ${role}`);
      }
    }
    const user = this.db.prepare(
      `SELECT id, role FROM User WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(userId, ...tenantParams(context.clinicId)) as { id: string; role: string } | undefined;
    if (!user) throw new NotFoundError('User not found');

    const desired = Array.from(new Set(roles)).filter((role) => role !== user.role);
    const existingRows = this.db.prepare(
      `SELECT role FROM UserRole WHERE userId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).all(userId, ...tenantParams(context.clinicId)) as Array<{ role: string }>;
    const existing = new Set(existingRows.map((row) => row.role));
    const toAdd = desired.filter((role) => !existing.has(role));
    const toRemove = [...existing].filter((role) => !desired.includes(role));

    if (toAdd.length > 0 || toRemove.length > 0) {
      const now = context.now().toISOString();
      const run = this.db.transaction(() => {
        for (const role of toAdd) {
          // PRIMARY KEY(userId, role) 冲突即已存在（含历史软删残留行），按已存在跳过
          this.db.prepare(
            `INSERT OR IGNORE INTO UserRole (userId, role, clinicId, createdAt, updatedAt, deletedAt)
             VALUES (?, ?, ?, ?, ?, NULL)`,
          ).run(userId, role, context.clinicId ?? null, now, now);
        }
        for (const role of toRemove) {
          this.db.prepare(
            `DELETE FROM UserRole WHERE userId = ? AND role = ?${tenantAnd(context.clinicId)}`,
          ).run(userId, role, ...tenantParams(context.clinicId));
        }
      });
      run();
    }
    return desired;
  }
}
