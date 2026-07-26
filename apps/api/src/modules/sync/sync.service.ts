import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { validateColumnName } from '../../common/utils/db/validate-name';

export interface SyncChange {
  id: string;
  tableName: string;
  recordId: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  deviceId: string;
  clinicId: string;
  createdAt: string;
}

export interface SyncPushPayload {
  deviceId: string;
  changes: Array<{
    tableName: string;
    recordId: string;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
    data?: Record<string, unknown>;
    updatedAt: string;
  }>;
}

export interface SyncPullResult {
  changes: SyncChange[];
  serverTime: string;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly clinicContext: ClinicContextService,
  ) {}

  /**
   * 记录一条变更到 SyncChangeLog（供 BaseService 调用）
   */
  logChange(tableName: string, recordId: string, operation: 'INSERT' | 'UPDATE' | 'DELETE', deviceId: string): void {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) return;

    try {
      this.dbService.prepare(
        `INSERT INTO SyncChangeLog (id, tableName, recordId, operation, deviceId, clinicId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        tableName,
        recordId,
        operation,
        deviceId || 'server',
        clinicId,
        new Date().toISOString(),
      );
    } catch (err) {
      this.logger.warn(`记录同步变更失败: ${tableName}/${recordId}`, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 拉取自指定时间戳以来的所有变更（排除指定设备自身的变更）
   */
  pullChanges(since: string, deviceId: string): SyncPullResult {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      return { changes: [], serverTime: new Date().toISOString() };
    }

    const changes = this.dbService.prepare(
      `SELECT id, tableName, recordId, operation, deviceId, clinicId, createdAt
       FROM SyncChangeLog
       WHERE clinicId = ? AND createdAt > ? AND deviceId != ?
       ORDER BY createdAt ASC
       LIMIT 1000`,
    ).all(clinicId, since, deviceId) as SyncChange[];

    return {
      changes,
      serverTime: new Date().toISOString(),
    };
  }

  /**
   * 接收客户端推送的变更，写入服务端数据库
   * 采用"最后写入胜出"策略：比较 updatedAt，较新的覆盖旧的
   */
  pushChanges(payload: SyncPushPayload): { accepted: number; conflicts: number } {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      return { accepted: 0, conflicts: 0 };
    }

    let accepted = 0;
    let conflicts = 0;

    this.dbService.transaction((db) => {
      for (const change of payload.changes) {
        try {
          const table = this.sanitizeTableName(change.tableName);

          // 检查服务端是否已有更新版本（加 clinicId 隔离）
          const existing = db.prepare(
            `SELECT updatedAt FROM ${table} WHERE id = ? AND clinicId = ?`,
          ).get(change.recordId, clinicId) as { updatedAt: string } | undefined;

          if (existing && existing.updatedAt > change.updatedAt) {
            // 服务端版本更新，跳过此变更
            conflicts++;
            continue;
          }

          // 应用变更
          if (change.operation === 'DELETE') {
            db.prepare(
              `UPDATE ${table} SET deletedAt = ?, updatedAt = ? WHERE id = ? AND clinicId = ?`,
            ).run(new Date().toISOString(), change.updatedAt, change.recordId, clinicId);
          } else if (change.data) {
            // INSERT 或 UPDATE — 过滤非法列名防止 SQL 注入
            const data = change.data;
            const keys = Object.keys(data).filter(
              k => data[k] !== undefined && validateColumnName(k),
            );
            if (keys.length > 0) {
              const placeholders = keys.map(() => '?').join(', ');
              const values = keys.map(k => data[k]);

              if (change.operation === 'INSERT') {
                // 使用 ON CONFLICT DO UPDATE 避免 INSERT OR REPLACE 删旧行丢列
                const setClause = keys
                  .filter(k => k !== 'id')
                  .map(k => `${k} = excluded.${k}`)
                  .join(', ');
                if (setClause) {
                  db.prepare(
                    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})
                     ON CONFLICT(id) DO UPDATE SET ${setClause}`,
                  ).run(...values);
                } else {
                  // 只有 id 列，直接忽略
                }
              } else {
                const setClause = keys.filter(k => k !== 'id').map(k => `${k} = ?`).join(', ');
                const updateValues = keys.filter(k => k !== 'id').map(k => data[k]);
                if (setClause) {
                  db.prepare(
                    `UPDATE ${table} SET ${setClause} WHERE id = ? AND clinicId = ?`,
                  ).run(...updateValues, change.recordId, clinicId);
                }
              }
            }
          }

          // 记录变更日志
          db.prepare(
            `INSERT INTO SyncChangeLog (id, tableName, recordId, operation, deviceId, clinicId, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            crypto.randomUUID(),
            change.tableName,
            change.recordId,
            change.operation,
            payload.deviceId,
            clinicId,
            new Date().toISOString(),
          );

          accepted++;
        } catch (err) {
          this.logger.warn(
            `应用同步变更失败: ${change.tableName}/${change.recordId}`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    });

    return { accepted, conflicts };
  }

  /**
   * 清理过期的变更日志（保留最近 7 天）
   */
  cleanupOldChanges(): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString();

    const result = this.dbService.prepare(
      `DELETE FROM SyncChangeLog WHERE createdAt < ?`,
    ).run(cutoffStr);

    return result.changes;
  }

  /**
   * 简单表名校验，防止 SQL 注入
   */
  private sanitizeTableName(name: string): string {
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return name;
    }
    throw new Error(`Invalid table name: ${name}`);
  }
}
