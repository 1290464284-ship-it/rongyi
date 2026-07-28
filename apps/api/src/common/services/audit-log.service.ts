import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { IDatabase } from '../../db/db.interface';
import { isSensitiveField } from '../utils/security/sensitive-fields';

/**
 * 审计日志服务 - 从 BaseService 拆分而来
 *
 * 职责：
 *  - 统一审计日志写入（支持事务内 / 事务外）
 *  - 自动生成 UUID / createdAt / clinicId
 *  - 自动 JSON 序列化 beforeData / afterData
 *  - 对敏感字段进行脱敏
 *
 * 设计说明：
 *  - 标记为 @Injectable 以便未来可通过 Nest DI 使用
 *  - 同时支持通过构造函数直接实例化（BaseService 内部使用，避免破坏 28 个子类的 super() 调用）
 *  - 不持有可变状态，方法签名与 BaseService.logAudit 完全一致（额外显式传入 clinicId）
 */
@Injectable()
export class AuditLogService {
  /**
   * 统一审计日志方法
   * 支持事务内（传 db）和事务外（传 dbService）两种使用方式
   * 自动生成 UUID、createdAt，自动 JSON 序列化 beforeData/afterData
   *
   * @param db 数据库接口（可以是 DbService 或事务内的 IDatabase）
   * @param type 审计类型（如 AuditLogType.XXX）
   * @param targetId 目标记录 ID
   * @param targetType 目标表名
   * @param clinicId 当前诊所 ID（由调用方注入）
   * @param options.beforeData 变更前数据
   * @param options.afterData 变更后数据
   * @param options.remark 备注
   * @param options.operatorId 操作人 ID
   */
  logAudit(
    db: IDatabase,
    type: string,
    targetId: string,
    targetType: string,
    clinicId: string | null,
    options?: {
      beforeData?: unknown;
      afterData?: unknown;
      remark?: string;
      operatorId?: string;
      operatorName?: string;
      amount?: number;
      ip?: string;
    },
  ): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const beforeData = options?.beforeData !== undefined
      ? JSON.stringify(this.sanitizeAuditData(options.beforeData))
      : null;
    const afterData = options?.afterData !== undefined
      ? JSON.stringify(this.sanitizeAuditData(options.afterData))
      : null;
    const remark = options?.remark ?? null;
    const operatorId = options?.operatorId ?? null;
    const operatorName = options?.operatorName ?? null;
    const amount = options?.amount ?? null;
    const ip = options?.ip ?? null;

    db.prepare(
      `INSERT INTO AuditLog (id, type, targetId, targetType, beforeData, afterData, remark, clinicId, createdAt, operatorId, operatorName, amount, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, type, targetId, targetType, beforeData, afterData, remark, clinicId, now, operatorId, operatorName, amount, ip);
  }

  /**
   * 审计日志敏感数据脱敏：对 beforeData/afterData 中的敏感字段进行遮蔽
   * 防止密码、身份证号、令牌、手机号、邮箱、地址等敏感信息写入审计日志
   *
   * P0 修复：原先使用本地维护的 AUDIT_SENSITIVE_FIELDS 列表（仅 6 个字段），
   * 缺失 phone/email/address/emergencyPhone/emergencyContact/refreshToken/
   * passwordHash/openId/cardNo 等关键敏感字段，导致审计日志可能明文记录 PII。
   * 现统一复用 common/utils/security/sensitive-fields.ts 的 isSensitiveField()，
   * 与日志脱敏、操作日志脱敏保持一致。
   */
  sanitizeAuditData(data: unknown): unknown {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map((item) => this.sanitizeAuditData(item));
    const sanitized = { ...(data as Record<string, unknown>) };
    for (const key of Object.keys(sanitized)) {
      const value = sanitized[key];
      if (isSensitiveField(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        // 递归脱敏嵌套对象，避免深层 PII 泄露
        sanitized[key] = this.sanitizeAuditData(value);
      }
    }
    return sanitized;
  }
}
