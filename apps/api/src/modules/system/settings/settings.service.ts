import { Injectable, OnModuleInit } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { CacheService } from "../../../common/services/cache.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { AppLogger } from "../../../common/services/logger.service";
import { CLINIC_INFO_CACHE_TTL_MS } from "../../../config/constants";
import * as crypto from "node:crypto";
import { AuditLogService } from "../../../common/services/audit-log.service";

const CLINIC_INFO_CACHE_KEY = "settings:clinicInfo";
const CLINIC_INFO_TTL = CLINIC_INFO_CACHE_TTL_MS;

export interface SystemConfig {
  backupRetentionDays: string;
  defaultPageSize: string;
  cacheTTLSeconds: string;
  maxBackupSizeGB: string;
  logRetentionDays: string;
  autoBackupEnabled: string;
  sessionTimeoutMinutes: string;
  [key: string]: string;
}

const DEFAULT_CONFIG: Partial<SystemConfig> = {
  backupRetentionDays: "30",
  defaultPageSize: "20",
  cacheTTLSeconds: "600",
  maxBackupSizeGB: "10",
  logRetentionDays: "30",
  autoBackupEnabled: "true",
  sessionTimeoutMinutes: "120",
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private logger = new AppLogger(SettingsService.name);
  constructor(
    private dbService: DbService,
    private cache: CacheService,
    private clinicContext: ClinicContextService,
    private auditLogService: AuditLogService,
  ) {}

  onModuleInit() {
    this.ensureDefaultConfigs();
  }

  /**
   * P0-3: 构建诊所过滤条件。
   * 对于 ClinicInfo，当 clinicId 存在时，同时返回该诊所配置和全局配置（clinicId IS NULL）。
   * 当 clinicId 不存在时（超级管理员），返回所有配置。
   */
  private buildSettingsFilter(): { clause: string; params: unknown[] } {
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) {
      return { clause: " AND (clinicId = ? OR clinicId IS NULL)", params: [clinicId] };
    }
    return { clause: "", params: [] };
  }

  /**
   * P0-3: 获取诊所专属缓存键，防止跨诊所缓存污染。
   */
  private getCacheKey(): string {
    const clinicId = this.clinicContext.getClinicId();
    return clinicId ? `${CLINIC_INFO_CACHE_KEY}:${clinicId}` : CLINIC_INFO_CACHE_KEY;
  }

  private ensureDefaultConfigs() {
    try {
      const _clinicId = this.clinicContext.getClinicId();
      for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        // 默认配置作为全局配置写入（clinicId = NULL）
        const existing = this.dbService.prepare(
          "SELECT id FROM ClinicInfo WHERE key = ? AND clinicId IS NULL"
        ).get(key);
        if (!existing) {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          this.dbService.prepare(
            "INSERT INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, ?, ?)"
          ).run(id, key, value, null, now);
        }
      }
      this.invalidateCache();
    } catch (err: unknown) {
      this.logger.warn('ensureDefaultConfigs failed:', err instanceof Error ? err.message : String(err));
    }
  }

  private loadFromDb(): Record<string, string> {
    const { clause, params } = this.buildSettingsFilter();
    const rows = this.dbService.prepare(
      `SELECT id, key, value, clinicId, updatedAt FROM ClinicInfo WHERE 1=1${clause}`
    ).all(...params) as Array<{ key: string; value: string; clinicId: string | null }>;
    const result: Record<string, string> = {};
    // 诊所专属配置优先于全局配置
    for (const row of rows) {
      result[row.key] = row.value || "";
    }
    return result;
  }

  private async getAllWithCache(): Promise<Record<string, string>> {
    const cacheKey = this.getCacheKey();
    // P3-3: 移除原本实例级的 inMemoryCache — 它不区分 clinicId，会导致跨诊所缓存污染。
    // CacheService 本身就是内存 Map，无需额外的二级缓存。
    const fromCache = await this.cache.get<Record<string, string>>(cacheKey);
    if (fromCache) {
      return fromCache;
    }
    const fromDb = this.loadFromDb();
    await this.cache.set(cacheKey, fromDb, CLINIC_INFO_TTL);
    return fromDb;
  }

  private invalidateCache() {
    const clinicId = this.clinicContext.getClinicId();
    if (clinicId) {
      // 诊所级变更：只清当前诊所缓存
      this.cache.del(this.getCacheKey());
    } else {
      // P3-3: 全局配置变更 — 所有诊所都读取全局配置，必须清空所有诊所的缓存
      this.cache.delPattern(CLINIC_INFO_CACHE_KEY);
    }
  }

  async getClinicInfo(): Promise<Record<string, string>> {
    return this.getAllWithCache();
  }

  async get<T extends keyof SystemConfig>(key: T): Promise<string | undefined>;
  async get(key: string): Promise<string | undefined>;
  async get(key: string): Promise<string | undefined> {
    const all = await this.getAllWithCache();
    return all[key];
  }

  async getNumber(key: string, defaultValue = 0): Promise<number> {
    const val = await this.get(key);
    const num = val ? parseInt(val, 10) : NaN;
    return isNaN(num) ? defaultValue : num;
  }

  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const val = await this.get(key);
    if (val === undefined || val === null) return defaultValue;
    return val === "true" || val === "1" || val === "yes";
  }

  async updateClinicInfo(key: string, value: string) {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      // P0-3: 优先更新诊所专属配置，不存在则创建
      const existing = db.prepare(
        "SELECT id, value FROM ClinicInfo WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
      ).get(key, clinicId, clinicId) as { id: string; value: string } | undefined;
      const beforeValue = existing?.value;
      if (existing) {
        db.prepare(
          "UPDATE ClinicInfo SET value = ?, updatedAt = ? WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
        ).run(value, now, key, clinicId, clinicId);
      } else {
        const id = crypto.randomUUID();
        db.prepare(
          "INSERT INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, ?, ?)"
        ).run(id, key, value, clinicId, now);
      }
      this.auditLogService.logAudit(db, "SETTING_UPDATE", key, "ClinicInfo", clinicId, {
        beforeData: beforeValue !== undefined ? { value: beforeValue } : undefined,
        afterData: { value },
      });
    });
    this.invalidateCache();
    return { key, value };
  }

  async findAll() {
    return this.getClinicInfo();
  }

  async upsertMany(data: Record<string, string>) {
    const clinicId = this.clinicContext.getClinicId();
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      for (const [key, value] of Object.entries(data)) {
        const existing = db.prepare(
          "SELECT id, value FROM ClinicInfo WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
        ).get(key, clinicId, clinicId) as { id: string; value: string } | undefined;
        if (existing) {
          db.prepare(
            "UPDATE ClinicInfo SET value = ?, updatedAt = ? WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
          ).run(value, now, key, clinicId, clinicId);
        } else {
          const id = crypto.randomUUID();
          db.prepare(
            "INSERT INTO ClinicInfo (id, key, value, clinicId, updatedAt) VALUES (?, ?, ?, ?, ?)"
          ).run(id, key, value, clinicId, now);
        }
        this.auditLogService.logAudit(db, "SETTING_UPDATE", key, "ClinicInfo", clinicId, {
          beforeData: existing ? { value: existing.value } : undefined,
          afterData: { value },
        });
      }
    });
    this.invalidateCache();
    return { success: true };
  }

  async delete(key: string) {
    const clinicId = this.clinicContext.getClinicId();
    this.dbService.prepare(
      "DELETE FROM ClinicInfo WHERE key = ? AND (clinicId = ? OR (clinicId IS NULL AND ? IS NULL))"
    ).run(key, clinicId, clinicId);
    this.auditLogService.logAudit(this.dbService, "SETTING_DELETE", key, "ClinicInfo", clinicId);
    this.invalidateCache();
    return { key };
  }
}
