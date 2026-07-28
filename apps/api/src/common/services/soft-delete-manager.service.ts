import { Injectable } from '@nestjs/common';
import { BusinessNotFoundException } from '@common/errors';
import * as crypto from 'node:crypto';
import { DbService } from '../../db/db.service';
import { validateColumnName } from '../utils/db/validate-name';

/**
 * 软删除敏感唯一字段列表 - 删除时替换为随机字符串避免信息残留
 */
const SENSITIVE_UNIQUE_FIELDS = ['phone', 'idCard', 'idCardNumber', 'idCardEncrypted'];

/**
 * SoftDeleteManager 需要的上下文信息
 * 由 BaseService 在调用时构造，包含执行软删除所需的全部表元数据
 */
export interface SoftDeleteContext {
  /** 主表名 */
  tableName: string;
  /** 级联软删除的关联表 */
  cascadeTables: { table: string; foreignKey: string }[];
  /** 唯一约束字段列表（软删除时加后缀以避免冲突） */
  uniqueFields: string[];
  /** 表是否支持软删除（有 deletedAt 列） */
  hasSoftDelete: boolean;
  /** SELECT 字段列表字符串（已校验） */
  selectColumns: string;
  /** 诊所过滤子句 */
  clinicClause: { clause: string; params: unknown[] };
  /** 当前诊所 ID */
  clinicId: string | null;
}

/**
 * 软删除管理器 - 从 BaseService 拆分而来
 *
 * 职责：
 *  - 软删除主表记录（标记 deletedAt）
 *  - 级联软删除关联表数据
 *  - 唯一字段加后缀避免冲突（敏感字段替换为随机字符串）
 *  - 写入 SOFT_DELETE 审计日志
 *
 * 设计说明：
 *  - 标记为 @Injectable 以便未来可通过 Nest DI 使用
 *  - 同时支持通过构造函数直接实例化（BaseService 内部使用，避免破坏 28 个子类的 super() 调用）
 *  - 不持有可变状态，所有上下文通过 SoftDeleteContext 显式传入
 *  - 数据后处理（parseJsonFields / parseMoneyFields）由调用方在读取后调用，本类不负责
 */
@Injectable()
export class SoftDeleteManager {
  /**
   * 软删除记录
   *
   * @param dbService 数据库服务（用于事务）
   * @param id 待删除记录 ID
   * @param ctx 软删除上下文（表元数据 + 诊所过滤）
   * @returns beforeData（已读取但未做 JSON/金额解析的原始记录），供调用方做后续处理
   * @throws BusinessNotFoundException 记录不存在或已删除时抛出
   */
  softDelete(
    dbService: DbService,
    id: string,
    ctx: SoftDeleteContext,
  ): Record<string, unknown> {
    const now = new Date().toISOString();

    return dbService.transaction((db) => {
      const { clause: clinicClause, params: clinicParams } = ctx.clinicClause;
      const conditions: string[] = ['id = ?'];
      const queryParams: unknown[] = [id];

      if (clinicClause) {
        conditions.push(clinicClause.replace(/^\s*AND\s+/i, ''));
        queryParams.push(...clinicParams);
      }

      if (ctx.hasSoftDelete) {
        conditions.push('deletedAt IS NULL');
      }

      const existing = db.prepare(
        `SELECT ${ctx.selectColumns} FROM ${ctx.tableName} WHERE ${conditions.join(' AND ')}`,
      ).get(...queryParams) as Record<string, unknown> | undefined;

      if (!existing) {
        throw new BusinessNotFoundException(`${ctx.tableName}不存在`);
      }

      const updates: string[] = ['deletedAt = ?', 'updatedAt = ?'];
      const params: unknown[] = [now, now];

      // 唯一字段处理：软删除时不保留原始值，避免唯一约束冲突或信息残留
      for (const field of ctx.uniqueFields) {
        if (!validateColumnName(field)) continue;
        const currentValue = existing[field];
        if (currentValue !== null && currentValue !== undefined) {
          if (SENSITIVE_UNIQUE_FIELDS.includes(field)) {
            // 敏感字段：替换为随机字符串，原始值不可见（参数化查询）
            updates.push(`${field} = ?`);
            params.push(`DELETED_${crypto.randomBytes(8).toString('hex')}`);
          } else {
            // 普通唯一字段：追加后缀避免唯一约束冲突
            const suffix = `_deleted_${id.slice(0, 8)}_${Date.now()}`;
            const newValue = String(currentValue) + suffix;
            updates.push(`${field} = ?`);
            params.push(newValue);
          }
        }
      }

      params.push(id);
      db.prepare(
        `UPDATE ${ctx.tableName} SET ${updates.join(', ')} WHERE id = ?${clinicClause}`,
      ).run(...params, ...clinicParams);

      // 级联软删除关联表
      const cascadeStmts = ctx.cascadeTables.map(({ table, foreignKey }) =>
        db.prepare(
          `UPDATE ${table} SET deletedAt = ?, updatedAt = ? WHERE ${foreignKey} = ?${clinicClause} AND deletedAt IS NULL`,
        ),
      );
      for (const stmt of cascadeStmts) {
        stmt.run(now, now, id, ...clinicParams);
      }

      // 写入审计日志（保持与原实现一致，使用与 softDelete 相同的字段集）
      db.prepare(
        'INSERT INTO AuditLog (id, type, targetId, targetType, beforeData, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        crypto.randomUUID(),
        'SOFT_DELETE',
        id,
        ctx.tableName,
        JSON.stringify(existing),
        ctx.clinicId,
        now,
      );

      return existing;
    });
  }
}
