/* eslint-disable security/detect-non-literal-fs-filename -- 健康检查路径来自服务端配置，非用户输入 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '../../../db/db.service';
import { AppLogger } from '../../../common/services/logger.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HEALTH_CACHE_TTL_MS } from '../../../config/constants';
import { validateTableName } from '../../../common/utils/db/validate-name';
import { buildClinicFilterOptional } from '../../../common/utils/db/clinic-filter';

const DIR_PATH_WHITELIST_REGEX = /^[a-zA-Z0-9:\\/\\.\-_]+$/;

function validateDirPath(dirPath: string): boolean {
  return DIR_PATH_WHITELIST_REGEX.test(dirPath);
}

export interface MemoryCheck {
  status: 'ok';
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
}

export interface DatabaseCheck {
  status: 'ok' | 'error';
  responseTimeMs: number;
  message?: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    database: DatabaseCheck;
    memory: MemoryCheck;
  };
}

export interface AppInfoResponse {
  name: string;
  version: string;
  environment: string;
  nodeVersion: string;
  uptime: number;
  timestamp: string;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
}

export interface HealthCheckDetailItem {
  name: string;
  status: 'ok' | 'warning' | 'error';
  data?: Record<string, unknown>;
  message?: string;
}

export interface HealthCheckDetailResult {
  status: 'ok' | 'warning' | 'error';
  timestamp: string;
  checks: HealthCheckDetailItem[];
}

@Injectable()
export class HealthService {
  private readonly logger = new AppLogger(HealthService.name);
  private readonly appName: string;
  private readonly appVersion: string;
  private tableStatsCache: { data: Array<{ name: string; count: number }>; timestamp: number } | null = null;
  private readonly TABLE_STATS_CACHE_TTL = HEALTH_CACHE_TTL_MS;

  constructor(
    private readonly dbService: DbService,
    private readonly configService: ConfigService,
    private readonly clinicContext: ClinicContextService,
  ) {
    this.appName = this.configService.get<string>('npm_package_name') || '@dental/api';
    this.appVersion = this.configService.get<string>('npm_package_version') || '0.1.0';
  }

  checkSimple(): { status: 'ok' | 'down' } {
    try {
      const result = this.dbService.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      return { status: result?.ok === 1 ? 'ok' : 'down' };
    } catch {
      return { status: 'down' };
    }
  }

  check(): HealthCheckResponse {
    const dbCheck = this.checkDatabaseInternal();
    const memoryCheck = this.checkMemory();

    const isDbOk = dbCheck.status === 'ok';
    const overallStatus: 'ok' | 'degraded' = isDbOk ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: this.appVersion,
      environment: this.configService.get<string>('NODE_ENV') || 'development',
      checks: {
        database: dbCheck,
        memory: memoryCheck,
      },
    };
  }

  getInfo(): AppInfoResponse {
    const memoryUsage = process.memoryUsage();

    return {
      name: this.appName,
      version: this.appVersion,
      environment: this.configService.get<string>('NODE_ENV') || 'development',
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      memory: {
        heapUsedMB: Number((memoryUsage.heapUsed / (1024 * 1024)).toFixed(2)),
        heapTotalMB: Number((memoryUsage.heapTotal / (1024 * 1024)).toFixed(2)),
        rssMB: Number((memoryUsage.rss / (1024 * 1024)).toFixed(2)),
      },
    };
  }

  async getDetail(): Promise<HealthCheckDetailResult> {
    const isProd = this.configService.get('NODE_ENV') === 'production';
    const checks: HealthCheckDetailItem[] = [];

    const dbCheck = this.checkDatabase();
    checks.push(dbCheck);

    const diskCheck = this.checkDiskSpace();
    checks.push(diskCheck);

    const backupCheck = this.checkBackupStatus();
    checks.push(backupCheck);

    const dbSizeCheck = await this.checkDatabaseSize();
    checks.push(dbSizeCheck);

    const hasError = checks.some(c => c.status === 'error');
    const hasWarning = checks.some(c => c.status === 'warning');
    const overallStatus: 'ok' | 'warning' | 'error' = hasError ? 'error' : hasWarning ? 'warning' : 'ok';

    const result: HealthCheckDetailResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks: isProd ? checks.map(c => ({ name: c.name, status: c.status })) : checks,
    };

    return result;
  }

  private checkDatabaseInternal(): DatabaseCheck {
    const startTime = Date.now();
    try {
      const result = this.dbService.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      const responseTimeMs = Date.now() - startTime;

      if (result?.ok === 1) {
        return {
          status: 'ok',
          responseTimeMs,
        };
      }

      return {
        status: 'error',
        responseTimeMs,
        message: '数据库查询返回异常结果',
      };
    } catch (err: unknown) {
      const responseTimeMs = Date.now() - startTime;
      return {
        status: 'error',
        responseTimeMs,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private checkMemory(): MemoryCheck {
    const memoryUsage = process.memoryUsage();

    return {
      status: 'ok',
      heapUsedMB: Number((memoryUsage.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMB: Number((memoryUsage.heapTotal / (1024 * 1024)).toFixed(2)),
      rssMB: Number((memoryUsage.rss / (1024 * 1024)).toFixed(2)),
    };
  }

  checkDatabase(): HealthCheckDetailItem {
    try {
      const result = this.dbService.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      const dbOk = result?.ok === 1;
      return {
        name: 'database',
        status: dbOk ? 'ok' : 'error',
        data: { connected: dbOk },
        message: dbOk ? '数据库连接正常' : '数据库连接失败',
      };
    } catch (err: unknown) {
      this.logger.error('健康检查失败：数据库连接异常', err instanceof Error ? err : String(err));
      return {
        name: 'database',
        status: 'error',
        message: `数据库连接异常: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  checkDiskSpace(): HealthCheckDetailItem {
    try {
      const dbPath = this.dbService.db.name;
      const dataDir = path.dirname(dbPath);
      const freeBytes = this.getDiskFreeSpace(dataDir);
      const totalBytes = this.getDiskTotalSpace(dataDir);
      const freeGB = freeBytes / (1024 * 1024 * 1024);
      const thresholdGB = 1;

      let status: 'ok' | 'warning' | 'error' = 'ok';
      let message = `磁盘剩余空间: ${freeGB.toFixed(2)} GB`;

      if (freeBytes < thresholdGB * 1024 * 1024 * 1024) {
        status = 'warning';
        message = `磁盘剩余空间不足: ${freeGB.toFixed(2)} GB (低于 ${thresholdGB}GB 阈值)`;
      }

      return {
        name: 'disk_space',
        status,
        data: {
          freeBytes,
          totalBytes,
          freeGB: Number(freeGB.toFixed(2)),
          totalGB: totalBytes ? Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2)) : undefined,
          thresholdGB,
        },
        message,
      };
    } catch (err: unknown) {
      this.logger.warn('磁盘空间检查失败', err instanceof Error ? err.message : String(err));
      return {
        name: 'disk_space',
        status: 'warning',
        message: `磁盘空间检查失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private getDiskFreeSpace(dirPath: string): number {
    try {
      if (!validateDirPath(dirPath)) {
        return 0;
      }
      const stats = fs.statfsSync(dirPath);
      const freeBytes = Number(stats.bfree) * Number(stats.bsize);
      return isNaN(freeBytes) ? 0 : freeBytes;
    } catch {
      return 0;
    }
  }

  private getDiskTotalSpace(dirPath: string): number | null {
    try {
      if (!validateDirPath(dirPath)) {
        return null;
      }
      const stats = fs.statfsSync(dirPath);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      return isNaN(totalBytes) ? null : totalBytes;
    } catch {
      return null;
    }
  }

  checkBackupStatus(): HealthCheckDetailItem {
    try {
      const clinicId = this.clinicContext.getClinicId();
      const latestBackup = this.dbService.prepare(
        clinicId
          ? "SELECT id, filename, fileSize, type, operatorId, operatorName, remark, clinicId, createdAt FROM BackupRecord WHERE clinicId = ? ORDER BY createdAt DESC LIMIT 1"
          : "SELECT id, filename, fileSize, type, operatorId, operatorName, remark, clinicId, createdAt FROM BackupRecord ORDER BY createdAt DESC LIMIT 1"
      ).get(...(clinicId ? [clinicId] : [])) as { id: string; filename: string; createdAt: string; type: string; fileSize?: number } | undefined;

      if (!latestBackup) {
        return {
          name: 'backup',
          status: 'warning',
          message: '暂无备份记录',
        };
      }

      const backupTime = new Date(latestBackup.createdAt).getTime();
      const now = Date.now();
      const hoursSinceBackup = (now - backupTime) / (1000 * 60 * 60);
      const maxHours = 25;

      let status: 'ok' | 'warning' | 'error' = 'ok';
      let message = `最近备份: ${latestBackup.createdAt} (${hoursSinceBackup.toFixed(1)} 小时前)`;

      if (hoursSinceBackup > maxHours) {
        status = 'warning';
        message = `备份超时: 最近一次备份在 ${hoursSinceBackup.toFixed(1)} 小时前 (超过 25 小时)`;
      }

      return {
        name: 'backup',
        status,
        data: {
          latestBackup: latestBackup.createdAt,
          latestBackupFilename: latestBackup.filename,
          latestBackupType: latestBackup.type,
          latestBackupSize: latestBackup.fileSize,
          hoursSinceBackup: Number(hoursSinceBackup.toFixed(2)),
        },
        message,
      };
    } catch (err: unknown) {
      this.logger.warn('备份状态检查失败', err instanceof Error ? err.message : String(err));
      return {
        name: 'backup',
        status: 'warning',
        message: `备份状态检查失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async checkDatabaseSize(): Promise<HealthCheckDetailItem> {
    try {
      const dbPath = this.dbService.db.name;
      const stats = await fs.promises.stat(dbPath);
      const sizeBytes = stats.size;
      const sizeMB = sizeBytes / (1024 * 1024);

      const walPath = dbPath + '-wal';
      let walSizeBytes = 0;
      try {
        const walStats = await fs.promises.stat(walPath);
        walSizeBytes = walStats.size;
      } catch {
        // WAL file may not exist
      }

      const totalSizeBytes = sizeBytes + walSizeBytes;
      const totalSizeMB = totalSizeBytes / (1024 * 1024);

      const tableStats = this.getTableStats();

      return {
        name: 'database_size',
        status: 'ok',
        data: {
          dbSizeBytes: sizeBytes,
          dbSizeMB: Number(sizeMB.toFixed(2)),
          walSizeBytes,
          walSizeMB: Number((walSizeBytes / (1024 * 1024)).toFixed(2)),
          totalSizeBytes,
          totalSizeMB: Number(totalSizeMB.toFixed(2)),
          tables: tableStats,
        },
        message: `数据库大小: ${totalSizeMB.toFixed(2)} MB`,
      };
    } catch (err: unknown) {
      this.logger.warn('数据库大小检查失败', err instanceof Error ? err.message : String(err));
      return {
        name: 'database_size',
        status: 'warning',
        message: `数据库大小检查失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  getTableStats(): Array<{ name: string; count: number }> {
    const now = Date.now();
    if (this.tableStatsCache && now - this.tableStatsCache.timestamp < this.TABLE_STATS_CACHE_TTL) {
      return this.tableStatsCache.data;
    }
    try {
      const tables = this.dbService.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as Array<{ name: string }>;

      const role = this.clinicContext.getRole();
      const clinicId = this.clinicContext.getClinicId();
      const isBoss = role === 'BOSS';

      if (!isBoss && !clinicId) {
        return [];
      }

      const clinicFilter = buildClinicFilterOptional(isBoss ? null : clinicId);

      const stats: Array<{ name: string; count: number }> = [];
      for (const table of tables) {
        try {
          if (!validateTableName(table.name)) {
            continue;
          }
          let result: { cnt: number };
          try {
            const sql = `SELECT COUNT(*) as cnt FROM "${table.name}"${clinicFilter.clause ? ' WHERE 1=1' + clinicFilter.clause : ''}`;
            result = this.dbService.prepare(sql).get(...clinicFilter.params) as { cnt: number };
          } catch {
            const fallbackSql = clinicFilter.clause
              ? `SELECT COUNT(*) as cnt FROM "${table.name}" WHERE 1=1${clinicFilter.clause}`
              : `SELECT COUNT(*) as cnt FROM "${table.name}"`;
            result = this.dbService.prepare(fallbackSql).get(...(clinicFilter.clause ? clinicFilter.params : [])) as { cnt: number };
          }
          stats.push({ name: table.name, count: result.cnt });
        } catch {
          // skip tables that can't be queried
        }
      }
      this.tableStatsCache = { data: stats, timestamp: now };
      return stats;
    } catch {
      return [];
    }
  }
}
