import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { BusinessValidationException } from '@common/errors';
import { DbService } from '../../db/db.service';
import { IDatabase } from '../../db/db.interface';
import * as crypto from 'node:crypto';
import { IDEMPOTENCY_DEFAULT_TTL_MS, ONE_HOUR_MS } from '../../config/constants';

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
export class IdempotencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyService.name);
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly CLEANUP_INTERVAL_MS = ONE_HOUR_MS;

  constructor(private dbService: DbService) {}

  onModuleInit() {
    // P2 修复：定时清理过期的 IdempotencyRecord，防止表无限增长
    // 此前仅在被相同 key 再次访问时懒清理，未被访问的过期记录会永久残留
    this.cleanupTimer = setInterval(
      () => this.cleanupExpiredRecords(),
      IdempotencyService.CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref?.();
    // 启动时立即执行一次
    process.nextTick(() => this.cleanupExpiredRecords());
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 清理已过期的幂等记录
   */
  private cleanupExpiredRecords(): void {
    try {
      const now = new Date().toISOString();
      const result = this.dbService.prepare(
        'DELETE FROM IdempotencyRecord WHERE expiresAt < ?',
      ).run(now);
      if (result.changes > 0) {
        this.logger.log(`清理 ${result.changes} 条过期幂等记录`);
      }
    } catch (err: unknown) {
      this.logger.warn(
        '清理过期幂等记录失败:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * 在事务中执行幂等操作
   * @param options 幂等配置
   * @param options.key 幂等键，相同 key 的重复请求会返回首次执行结果
   * @param options.type 操作类型标识
   * @param options.ttlMs 幂等记录过期时间（毫秒），默认使用系统配置
   * @param options.processingMessage 处理中时的错误提示消息
   * @param handler 实际业务处理函数，接收数据库连接对象，支持事务。
   *                **必须是同步函数**（不可返回 Promise），否则会破坏事务原子性。
   *                若检测到 handler 返回 Promise，本方法会立即抛错并在控制台打印
   *                堆栈以便排查，防止"事务已 COMMIT 但业务逻辑仍在 await"的隐蔽破坏。
   * @returns 业务处理函数的返回值（首次执行）或缓存的成功结果（重复请求）
   * @throws BusinessValidationException 同一 key 正在处理中时抛出
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
    let handlerReached = false;

    try {
    return this.dbService.transaction((db) => {
      const existing = db.prepare(
        'SELECT id, key, type, status, result, createdAt, expiresAt FROM IdempotencyRecord WHERE key = ? AND expiresAt > ?',
      ).get(key, now) as IdempotencyRecord | undefined;

      const PROCESSING_TIMEOUT_MS = 120000;

      if (existing) {
        if (existing.status === 'COMPLETED' && existing.result) {
          // P1 修复：JSON.parse 失败时清理损坏记录并重试，避免 SyntaxError 导致请求失败
          try {
            return JSON.parse(existing.result) as T;
          } catch {
            db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(existing.id);
            throw new BusinessValidationException('幂等记录结果损坏，正在重试');
          }
        }
        if (existing.status === 'COMPLETED' && !existing.result) {
          db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(existing.id);
          throw new BusinessValidationException('幂等记录状态异常，正在重试');
        }
        if (existing.status === 'PROCESSING') {
          const processingTime = Date.now() - new Date(existing.createdAt).getTime();
          if (processingTime > PROCESSING_TIMEOUT_MS) {
            db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(existing.id);
          } else {
            throw new BusinessValidationException(options.processingMessage || '处理中，请稍后再试');
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
            // P1 修复：JSON.parse 失败时清理损坏记录并重试
            try {
              return JSON.parse(retryExisting.result) as T;
            } catch {
              db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(retryExisting.id);
              throw new BusinessValidationException('幂等记录结果损坏，正在重试');
            }
          } else if (retryExisting?.status === 'COMPLETED' && !retryExisting.result) {
            // COMPLETED 但无 result：损坏记录，删除后重试（与主流程 L91-93 保持一致）
            db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(retryExisting.id);
            throw new BusinessValidationException('幂等记录状态异常，正在重试');
          } else if (retryExisting?.status === 'PROCESSING') {
            const processingTime = Date.now() - new Date(retryExisting.createdAt).getTime();
            if (processingTime > PROCESSING_TIMEOUT_MS) {
              db.prepare('DELETE FROM IdempotencyRecord WHERE id = ?').run(retryExisting.id);
              db.prepare(
                'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
              ).run(recordId, key, type, 'PROCESSING', now, expiresAt);
            } else {
              throw new BusinessValidationException(options.processingMessage || '处理中，请稍后再试');
            }
          } else {
            throw new BusinessValidationException(options.processingMessage || '处理中，请稍后再试');
          }
        } else {
          throw e;
        }
      }

      handlerReached = true;
      const result = handler(db);
      // 契约守卫：handler 必须是同步函数。better-sqlite3 事务在 handler 返回
      // 后立即 COMMIT，若 handler 是 async（返回 Promise），await 期间的
      // DB 操作会落在事务外，破坏原子性并可能造成"状态=COMPLETED 但业务未落库"。
      if (result instanceof Promise) {
        throw new Error(
          `[IdempotencyService] handler 必须为同步函数（不可返回 Promise）。` +
          `key=${key}, type=${type}。请移除 handler 内的 await，或改用非事务 API。`,
        );
      }
      db.prepare(
        "UPDATE IdempotencyRecord SET status = 'COMPLETED', result = ? WHERE id = ?",
      ).run(JSON.stringify(result), recordId);
      return result;
    });
    } catch (err: unknown) {
      // P2 修复：FAILED 状态在事务外写入。事务内的 FAILED 更新会被 ROLLBACK 回滚，
      // 导致失败状态永远无法持久化。现在在事务外重新 INSERT FAILED 记录，
      // 使后续相同 key 请求可识别"上次失败"并立即重试。
      if (handlerReached) {
        try {
          this.dbService.prepare(
            "INSERT OR REPLACE INTO IdempotencyRecord (id, key, type, status, result, createdAt, expiresAt) VALUES (?, ?, ?, 'FAILED', ?, ?, ?)",
          ).run(recordId, key, type, JSON.stringify({ error: (err as Error).message }), now, expiresAt);
        } catch {
          // 忽略：写入失败不影响业务异常的正常传播
        }
      }
      throw err;
    }
  }
}
