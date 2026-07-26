import { Injectable, BadRequestException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { IDatabase } from '../../db/db.interface';
import * as crypto from 'node:crypto';
import { IDEMPOTENCY_DEFAULT_TTL_MS } from '../../config/constants';

/**
 * 幂等操作配置选项
 */
export interface IdempotentOptions {
  /** 幂等键，唯一标识一次操作，相同 key 的重复请求会被去重 */
  key: string;
  /** 操作类型，用于分类统计和排查问题 */
  type: string;
  /** 幂等记录过期时间（毫秒），默认使用 IDEMPOTENCY_DEFAULT_TTL_MS */
  ttlMs?: number;
  /** 当检测到同一 key 正在处理中时抛出的提示消息 */
  processingMessage?: string;
}

/**
 * 幂等记录实体
 */
export interface IdempotencyRecord {
  /** 记录 ID */
  id: string;
  /** 幂等键 */
  key: string;
  /** 操作类型 */
  type: string;
  /** 处理状态：PROCESSING-处理中，COMPLETED-已完成，FAILED-失败 */
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  /** 执行结果（JSON 序列化字符串），仅 COMPLETED 状态有值 */
  result?: string;
  /** 创建时间 */
  createdAt: string;
  /** 过期时间，过期后自动失效可重新执行 */
  expiresAt: string;
}

@Injectable()
export class IdempotencyService {
  constructor(private dbService: DbService) {}

  /**
   * 在事务中执行幂等操作
   * @param options 幂等配置
   * @param options.key 幂等键，相同 key 的重复请求会返回首次执行结果
   * @param options.type 操作类型标识
   * @param options.ttlMs 幂等记录过期时间（毫秒），默认使用系统配置
   * @param options.processingMessage 处理中时的错误提示消息
   * @param handler 实际业务处理函数，接收数据库连接对象，支持事务
   * @returns 业务处理函数的返回值（首次执行）或缓存的成功结果（重复请求）
   * @throws BadRequestException 同一 key 正在处理中时抛出
   * @throws Error 业务处理函数抛出的任何异常都会被原样抛出，并记录为 FAILED 状态
   * @description
   * 幂等状态流转：
   * 1. 检查是否存在未过期的记录
   * 2. COMPLETED → 直接返回缓存结果
   * 3. PROCESSING → 若超时则清理后重试，否则抛出处理中异常
   * 4. FAILED → 清理后重新执行
   * 5. 插入 PROCESSING 记录（处理并发：UNIQUE 冲突时再次检查状态）
   * 6. 执行业务逻辑
   * 7. 成功 → 更新为 COMPLETED 并保存结果；失败 → 更新为 FAILED 并保存错误
   * 注意：整个过程在一个数据库事务内执行，保证原子性
   */
  executeInTransaction<T>(
    options: IdempotentOptions,
    handler: (db: IDatabase) => T,
  ): T {
    const { key, type, ttlMs = IDEMPOTENCY_DEFAULT_TTL_MS } = options;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const recordId = crypto.randomUUID();

    return this.dbService.transaction((db) => {
      const existing = db.prepare(
        'SELECT id, key, type, status, result, createdAt, expiresAt FROM IdempotencyRecord WHERE key = ? AND expiresAt > ?',
      ).get(key, now) as IdempotencyRecord | undefined;

      const PROCESSING_TIMEOUT_MS = 120000;

      if (existing) {
        if (existing.status === 'COMPLETED' && existing.result) {
          return JSON.parse(existing.result) as T;
        }
        if (existing.status === 'PROCESSING') {
          const processingTime = Date.now() - new Date(existing.createdAt).getTime();
          if (processingTime > PROCESSING_TIMEOUT_MS) {
            db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(existing.id);
          } else {
            throw new BadRequestException(options.processingMessage || '处理中，请稍后再试');
          }
        }
        if (existing.status === 'FAILED') {
          db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(existing.id);
        }
      }

      try {
        db.prepare(
          'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(recordId, key, type, 'PROCESSING', now, expiresAt);
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
          const retryExisting = db.prepare(
            'SELECT id, key, type, status, result, createdAt, expiresAt FROM IdempotencyRecord WHERE key = ?',
          ).get(key) as IdempotencyRecord | undefined;

          if (retryExisting && new Date(retryExisting.expiresAt).getTime() <= Date.now()) {
            db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(retryExisting.id);
            db.prepare(
              'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
            ).run(recordId, key, type, 'PROCESSING', now, expiresAt);
          } else if (retryExisting?.status === 'COMPLETED' && retryExisting.result) {
            return JSON.parse(retryExisting.result) as T;
          } else if (retryExisting?.status === 'PROCESSING') {
            const processingTime = Date.now() - new Date(retryExisting.createdAt).getTime();
            if (processingTime > PROCESSING_TIMEOUT_MS) {
              db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(retryExisting.id);
              db.prepare(
                'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
              ).run(recordId, key, type, 'PROCESSING', now, expiresAt);
            } else {
              throw new BadRequestException(options.processingMessage || '处理中，请稍后再试');
            }
          } else {
            throw new BadRequestException(options.processingMessage || '处理中，请稍后再试');
          }
        } else {
          throw e;
        }
      }

      try {
        const result = handler(db);
        db.prepare(
          "UPDATE IdempotencyRecord SET status = 'COMPLETED', result = ? WHERE id = ?",
        ).run(JSON.stringify(result), recordId);
        return result;
      } catch (err: unknown) {
        db.prepare(
          "UPDATE IdempotencyRecord SET status = 'FAILED', result = ? WHERE id = ?",
        ).run(JSON.stringify({ error: (err as Error).message }), recordId);
        throw err;
      }
    });
  }
}
