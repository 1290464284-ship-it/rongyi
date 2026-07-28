import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { DbService } from '../../db/db.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { validateColumnName } from '../../common/utils/db/validate-name';
import { ONE_DAY_MS } from '../../config/constants';

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
  /** 是否还有更多变更未返回，客户端应继续拉取 */
  hasMore: boolean;
}

/**
 * 允许通过 sync 接口推送变更的业务表白名单。
 * 安全限制：不在白名单中的表（如 User、Config 等）禁止通过 sync 写入。
 */
const SYNC_ALLOWED_TABLES: ReadonlySet<string> = new Set([
  'Patient',
  'Appointment',
  'Treatment',
  'TreatmentPlan',
  'TreatmentPlanItem',
  'Charge',
  'ChargeItem',
  'Payment',
  'Prescription',
  'PrescriptionItem',
  'MedicalRecord',
  'FollowUp',
  'ToothRecord',
  'ImagingRecord',
  'Inventory',
  'InventoryTransaction',
  'PurchaseOrder',
  'PurchaseOrderItem',
  'ProcessingOrder',
  'Equipment',
  'MemberCard',
  'MemberCardTransaction',
  'SyncChangeLog',
]);

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly CLEANUP_INTERVAL_MS = ONE_DAY_MS; // 每日清理一次

  constructor(
    private readonly dbService: DbService,
    private readonly clinicContext: ClinicContextService,
  ) {}

  onModuleInit() {
    // P2 修复：定时清理过期的 SyncChangeLog，防止表无限增长
    // 此前 cleanupOldChanges 方法已实现但从未被调用
    this.cleanupTimer = setInterval(
      () => {
        const deleted = this.cleanupOldChanges();
        if (deleted > 0) {
          this.logger.log(`清理 ${deleted} 条过期同步变更日志`);
        }
      },
      SyncService.CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

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
      this.logger.error(`记录同步变更失败: ${tableName}/${recordId}`, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 拉取自指定时间戳以来的变更（排除指定设备自身的变更）
   * 支持游标续拉：当 hasMore=true 时，客户端应使用返回的最后一条 createdAt 作为下次 since 参数
   * @param lastId 可选游标，传入上次返回的最后一条 id，用于跳过已拉取的记录（解决同一时间戳多条记录的翻页问题）
   */
  pullChanges(since: string, deviceId: string, lastId?: string): SyncPullResult {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      return { changes: [], serverTime: new Date().toISOString(), hasMore: false };
    }

    const PULL_LIMIT = 1000;
    let changes: SyncChange[];

    if (lastId) {
      // 游标模式：跳过 lastId 之前的记录（同一时间戳内按 id 排序）
      changes = this.dbService.prepare(
        `SELECT id, tableName, recordId, operation, deviceId, clinicId, createdAt
         FROM SyncChangeLog
         WHERE clinicId = ? AND createdAt >= ? AND deviceId != ? AND id > ?
         ORDER BY createdAt ASC, id ASC
         LIMIT ?`,
      ).all(clinicId, since, deviceId, lastId, PULL_LIMIT + 1) as SyncChange[];
    } else {
      changes = this.dbService.prepare(
        `SELECT id, tableName, recordId, operation, deviceId, clinicId, createdAt
         FROM SyncChangeLog
         WHERE clinicId = ? AND createdAt > ? AND deviceId != ?
         ORDER BY createdAt ASC, id ASC
         LIMIT ?`,
      ).all(clinicId, since, deviceId, PULL_LIMIT + 1) as SyncChange[];
    }

    const hasMore = changes.length > PULL_LIMIT;
    if (hasMore) {
      changes = changes.slice(0, PULL_LIMIT);
    }

    return {
      changes,
      serverTime: new Date().toISOString(),
      hasMore,
    };
  }

  /**
   * 接收客户端推送的变更，写入服务端数据库
   * 采用"最后写入胜出"策略：比较 updatedAt，较新的覆盖旧的
   */
  pushChanges(payload: SyncPushPayload): { accepted: number; conflicts: number; failed: number; errors: Array<{ tableName: string; recordId: string; error: string }> } {
    const clinicId = this.clinicContext.getClinicId();
    if (!clinicId) {
      return { accepted: 0, conflicts: 0, failed: 0, errors: [] };
    }

    let accepted = 0;
    let conflicts = 0;
    let failed = 0;
    const errors: Array<{ tableName: string; recordId: string; error: string }> = [];

    this.dbService.transaction((_db) => {
      for (const change of payload.changes) {
        try {
          this.dbService.transaction((txDb) => {
            const table = this.sanitizeTableName(change.tableName);

            const existing = txDb.prepare(
              `SELECT updatedAt FROM ${table} WHERE id = ? AND clinicId = ?`,
            ).get(change.recordId, clinicId) as { updatedAt: string } | undefined;

            if (existing && existing.updatedAt > change.updatedAt) {
              conflicts++;
              return;
            }

            if (change.operation === 'DELETE') {
              txDb.prepare(
                `UPDATE ${table} SET deletedAt = ?, updatedAt = ? WHERE id = ? AND clinicId = ?`,
              ).run(new Date().toISOString(), change.updatedAt, change.recordId, clinicId);
            } else if (change.data) {
              const data = change.data;
              const keys = Object.keys(data).filter(
                k => data[k] !== undefined && validateColumnName(k),
              );
              if (keys.length > 0) {
                const values = keys.map(k => data[k]);

                if (change.operation === 'INSERT') {
                  // P0 修复：INSERT 路径强制注入 clinicId，防止跨租户数据污染
                  if (!keys.includes('clinicId')) {
                    keys.push('clinicId');
                    values.push(clinicId);
                  } else {
                    // 覆盖客户端传入的 clinicId，以服务端为准
                    const idx = keys.indexOf('clinicId');
                    values[idx] = clinicId;
                  }
                  const insertPlaceholders = keys.map(() => '?').join(', ');
                  const setClause = keys
                    .filter(k => k !== 'id' && k !== 'clinicId')
                    .map(k => `${k} = excluded.${k}`)
                    .join(', ');
                  if (setClause) {
                    txDb.prepare(
                      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${insertPlaceholders})
                       ON CONFLICT(id) DO UPDATE SET ${setClause}`,
                    ).run(...values);
                  }
                } else {
                  const setClause = keys.filter(k => k !== 'id').map(k => `${k} = ?`).join(', ');
                  const updateValues = keys.filter(k => k !== 'id').map(k => data[k]);
                  if (setClause) {
                    txDb.prepare(
                      `UPDATE ${table} SET ${setClause} WHERE id = ? AND clinicId = ?`,
                    ).run(...updateValues, change.recordId, clinicId);
                  }
                }
              }
            }

            txDb.prepare(
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
          });
        } catch (err) {
          failed++;
          const errorMsg = err instanceof Error ? err.message : String(err);
          // P0 修复：不向客户端回传底层 SQLite 错误消息（可能包含表名/字段名/约束类型）
          // 仅记录到日志，客户端统一收到脱敏后的提示
          this.logger.warn(
            `应用同步变更失败: ${change.tableName}/${change.recordId}`,
            errorMsg,
          );
          errors.push({
            tableName: change.tableName,
            recordId: change.recordId,
            error: '同步此条变更失败，请检查数据格式或联系管理员',
          });
        }
      }
    });

    return { accepted, conflicts, failed, errors };
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
   * 表名校验：格式合法性 + 业务白名单双重防护。
   * 非白名单表（如 User）无法通过 sync 接口写入，防止提权攻击。
   */
  private sanitizeTableName(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid table name format: ${name}`);
    }
    if (!SYNC_ALLOWED_TABLES.has(name)) {
      throw new Error(`Table '${name}' is not allowed for sync operations`);
    }
    return name;
  }
}
