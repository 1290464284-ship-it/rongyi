/* eslint-disable security/detect-non-literal-fs-filename -- 自动备份路径来自服务端配置，非用户输入 */
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import * as fs from "node:fs";
import * as path from "node:path";
import { AppLogger } from "../../../common/services/logger.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { AlertService, AlertCategory } from "../../../common/services/alert.service";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import {
  BACKUP_AUTO_INTERVAL_MS,
  BACKUP_VERIFY_INTERVAL_MS,
  BACKUP_MAX_AUTO_BACKUPS,
  BACKUP_MAX_DIR_BYTES,
  BACKUP_LARGE_DB_THRESHOLD_BYTES,
  BACKUP_FULL_VACUUM_INTERVAL_MS,
  BACKUP_MANUAL_RETENTION_DAYS,
} from "../../../config/constants";
import { BackupManualService } from "./backup-manual.service";
import { getBackupDir } from './backup-core';

@Injectable()
export class BackupAutoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(BackupAutoService.name);
  private autoBackupTimer: NodeJS.Timeout | null = null;
  private autoVerifyTimer: NodeJS.Timeout | null = null;
  private readonly AUTO_BACKUP_INTERVAL_MS = BACKUP_AUTO_INTERVAL_MS;
  private readonly AUTO_VERIFY_INTERVAL_MS = BACKUP_VERIFY_INTERVAL_MS;
  private readonly MAX_AUTO_BACKUPS = BACKUP_MAX_AUTO_BACKUPS;
  private readonly MANUAL_BACKUP_RETENTION_DAYS = BACKUP_MANUAL_RETENTION_DAYS;
  private readonly MAX_BACKUP_DIR_BYTES = BACKUP_MAX_DIR_BYTES;
  private readonly LARGE_DB_THRESHOLD_BYTES = BACKUP_LARGE_DB_THRESHOLD_BYTES;
  private lastFullVacuumTime: number = 0;
  private readonly FULL_VACUUM_INTERVAL_MS = BACKUP_FULL_VACUUM_INTERVAL_MS;

  constructor(
    private dbService: DbService,
    private alertService: AlertService,
    private clinicContext: ClinicContextService,
    private manualBackup: BackupManualService,
  ) {}

  onModuleInit() {
    this.startAutoBackup();
    this.startAutoVerify();
    process.nextTick(() => {
      this.cleanupOrphanedFiles().catch((err) => {
        this.logger.warn('清理孤儿备份文件失败', err instanceof Error ? err.message : String(err));
      });
    });
  }

  onModuleDestroy() {
    this.stopAutoBackup();
    this.stopAutoVerify();
  }

  private startAutoBackup() {
    if (this.autoBackupTimer) return;
    this.logger.log('自动备份已启动，间隔 24 小时');
    this.autoBackupTimer = setInterval(() => {
      this.performAutoBackup().catch((err) => {
        this.logger.error('自动备份失败', err instanceof Error ? err.stack : String(err));
      });
    }, this.AUTO_BACKUP_INTERVAL_MS);

    process.nextTick(() => {
      this.ensureDailyBackup().catch((err) => {
        this.logger.warn('检查今日备份失败', err instanceof Error ? err.message : String(err));
      });
    });
  }

  private stopAutoBackup() {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
      this.logger.log('自动备份已停止');
    }
  }

  private startAutoVerify() {
    if (this.autoVerifyTimer) return;
    this.logger.log('自动备份验证已启动，间隔 12 小时');
    this.autoVerifyTimer = setInterval(() => {
      this.performAutoVerify().catch((err) => {
        this.logger.error('自动备份验证失败', err instanceof Error ? err.stack : String(err));
      });
    }, this.AUTO_VERIFY_INTERVAL_MS);
  }

  private stopAutoVerify() {
    if (this.autoVerifyTimer) {
      clearInterval(this.autoVerifyTimer);
      this.autoVerifyTimer = null;
      this.logger.log('自动备份验证已停止');
    }
  }

  async performAutoVerify() {
    this.logger.log('开始执行自动备份验证...');
    const { clause: autoClinicClause, params: autoClinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    const backups = this.dbService.prepare(
      `SELECT id, filename, createdAt FROM BackupRecord WHERE type = 'AUTO'${autoClinicClause} ORDER BY createdAt DESC LIMIT 3`
    ).all(...autoClinicParams) as Array<{ id: string; filename: string; createdAt: string }>;

    if (backups.length === 0) {
      this.logger.warn('没有找到自动备份文件，跳过验证');
      return;
    }

    for (const backup of backups) {
      this.logger.log(`验证备份: ${backup.filename} (${backup.createdAt})`);
      try {
        const result = await this.manualBackup.verifyBackup(backup.id);
        if (!result.success) {
          this.logger.error(`备份验证失败: ${backup.filename}`, JSON.stringify(result.results));
        } else {
          this.logger.log(`备份验证通过: ${backup.filename}`);
        }
      } catch (err: unknown) {
        this.logger.error(`验证备份 ${backup.filename} 时发生错误`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  async ensureDailyBackup() {
    const today = new Date().toISOString().split('T')[0];
    const { clause: dailyClinicClause, params: dailyClinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    const todayBackups = this.dbService.prepare(
      `SELECT COUNT(*) as cnt FROM BackupRecord WHERE type = 'AUTO' AND DATE(createdAt) = ?${dailyClinicClause}`
    ).get(today, ...dailyClinicParams) as { cnt: number };
    if (todayBackups.cnt === 0) {
      this.logger.log('今日暂无自动备份，执行首次自动备份');
      await this.performAutoBackup();
    }
  }

  async performAutoBackup() {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.logger.log(`开始执行自动备份（第 ${attempt}/${MAX_RETRIES} 次尝试）...`);
        const result = await this.manualBackup.create('AUTO', '自动定时备份', { id: 'system', name: 'system' });
        this.logger.log(`自动备份完成: ${result.filename}`);
        this.alertService.recordSuccess(AlertCategory.BACKUP, 'auto-backup');
        await this.cleanupOldAutoBackups();

        this.logger.log('开始执行数据库优化（VACUUM/ANALYZE）...');
        const optimizeResult = this.optimizeDatabase();
        if (optimizeResult.success) {
          this.logger.log(
            `数据库优化完成: 大小 ${optimizeResult.sizeBeforeMB}MB → ${optimizeResult.sizeAfterMB}MB ` +
            `(释放 ${optimizeResult.sizeDiffMB}MB), VACUUM: ${optimizeResult.vacuumMode}`
          );
        } else {
          this.logger.warn(`数据库优化执行异常: ${optimizeResult.error}`);
        }
        return; // 成功，退出重试循环
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.stack : String(err);
        this.logger.error(`自动备份第 ${attempt} 次尝试失败`, errMsg);

        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
          this.logger.log(`${delay}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // 所有重试耗尽，记录 CRITICAL 级别告警
          this.alertService.recordFailure(
            AlertCategory.BACKUP,
            'auto-backup',
            `自动备份连续 ${MAX_RETRIES} 次失败，请立即检查`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  }

  async cleanupOldAutoBackups() {
    try {
      const { clause: cleanupClinicClause, params: cleanupClinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
      const autoBackups = this.dbService.prepare(
        `SELECT * FROM BackupRecord WHERE type = 'AUTO'${cleanupClinicClause} ORDER BY createdAt DESC`
      ).all(...cleanupClinicParams) as Array<{ id: string; filename: string }>;

      if (autoBackups.length > this.MAX_AUTO_BACKUPS) {
        const toDelete = autoBackups.slice(this.MAX_AUTO_BACKUPS);
        for (const backup of toDelete) {
          try {
            await this.manualBackup.removeById(backup.id);
            this.logger.log(`清理过期自动备份: ${backup.filename}`);
          } catch (err: unknown) {
            this.logger.warn(`清理备份 ${backup.filename} 失败`, err instanceof Error ? err.message : String(err));
          }
        }
      }
    } catch (err: unknown) {
      this.logger.error('清理旧备份失败', err instanceof Error ? err.message : String(err));
    }
  }

  private getDatabaseSizeBytes(): number {
    const dbPath = this.dbService.db.name;
    let totalSize = 0;
    try {
      totalSize += fs.statSync(dbPath).size;
      const walPath = dbPath + '-wal';
      if (fs.existsSync(walPath)) {
        totalSize += fs.statSync(walPath).size;
      }
    } catch (err: unknown) {
      this.logger.warn('获取数据库大小失败', err instanceof Error ? err.message : String(err));
    }
    return totalSize;
  }

  private optimizeDatabase(): {
    success: boolean;
    sizeBeforeMB: number;
    sizeAfterMB: number;
    sizeDiffMB: number;
    vacuumMode: 'full' | 'none' | 'analyze-only';
    error?: string;
  } {
    const sizeBefore = this.getDatabaseSizeBytes();
    const sizeBeforeMB = Number((sizeBefore / (1024 * 1024)).toFixed(2));
    const now = Date.now();
    const isLargeDb = sizeBefore > this.LARGE_DB_THRESHOLD_BYTES;
    const canDoFullVacuum = !isLargeDb || (now - this.lastFullVacuumTime) >= this.FULL_VACUUM_INTERVAL_MS;

    let vacuumMode: 'full' | 'none' | 'analyze-only' = 'none';

    try {
      this.dbService.checkpoint('TRUNCATE');

      if (canDoFullVacuum) {
        this.logger.log(`执行完整 VACUUM (${isLargeDb ? '大库每周一次' : '常规'})...`);
        this.dbService.exec('VACUUM');
        vacuumMode = 'full';
        this.lastFullVacuumTime = now;
      } else {
        this.logger.log('数据库较大，跳过完整 VACUUM，仅执行 ANALYZE');
        vacuumMode = 'analyze-only';
      }

      this.dbService.exec('ANALYZE');

      const sizeAfter = this.getDatabaseSizeBytes();
      const sizeAfterMB = Number((sizeAfter / (1024 * 1024)).toFixed(2));
      const sizeDiffMB = Number((sizeBeforeMB - sizeAfterMB).toFixed(2));

      return {
        success: true,
        sizeBeforeMB,
        sizeAfterMB,
        sizeDiffMB,
        vacuumMode,
      };
    } catch (err: unknown) {
      return {
        success: false,
        sizeBeforeMB,
        sizeAfterMB: sizeBeforeMB,
        sizeDiffMB: 0,
        vacuumMode,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async cleanupOrphanedFiles() {
    const backupDir = getBackupDir(this.dbService);
    if (!fs.existsSync(backupDir)) return;

    // Startup warning: alert if backup directory is unusually large
    try {
      const dirFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith('.sqlite'));
      if (dirFiles.length > 50) {
        let dirTotalBytes = 0;
        for (const f of dirFiles) {
          try { dirTotalBytes += fs.statSync(path.join(backupDir, f)).size; } catch { /* ignore */ }
        }
        const dirTotalMB = Math.round(dirTotalBytes / (1024 * 1024));
        this.logger.warn(
          `备份目录包含 ${dirFiles.length} 个文件（${dirTotalMB} MB），建议检查清理策略`,
        );
      }
    } catch { /* non-critical, ignore */ }

    const recordedFiles = new Set(
      (this.dbService.prepare('SELECT filename FROM BackupRecord').all() as Array<{ filename: string }>)
        .map((r) => r.filename),
    );

    const filesOnDisk = fs.readdirSync(backupDir)
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => {
        const fullPath = path.join(backupDir, f);
        const stat = fs.statSync(fullPath);
        return { filename: f, fullPath, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => a.mtime - b.mtime);

    let orphanDeleted = 0;
    for (const file of filesOnDisk) {
      if (!recordedFiles.has(file.filename)) {
        try {
          fs.unlinkSync(file.fullPath);
          orphanDeleted++;
        } catch (err: unknown) {
          this.logger.warn(`删除孤儿备份文件失败: ${file.filename}`, err instanceof Error ? err.message : String(err));
        }
      }
    }
    if (orphanDeleted > 0) {
      this.logger.log(`P1-1: 清理 ${orphanDeleted} 个孤儿备份文件`);
    }

    const cutoff = Date.now() - this.MANUAL_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const { clause: manualClinicClause, params: manualClinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    const oldManual = this.dbService.prepare(
      `SELECT id, filename FROM BackupRecord WHERE type = 'MANUAL' AND createdAt < ?${manualClinicClause}`,
    ).all(new Date(cutoff).toISOString(), ...manualClinicParams) as Array<{ id: string; filename: string }>;
    for (const backup of oldManual) {
      try {
        await this.manualBackup.removeById(backup.id);
        this.logger.log(`P1-1: 清理过期手动备份: ${backup.filename}`);
      } catch (err: unknown) {
        this.logger.warn(`清理过期手动备份 ${backup.filename} 失败`, err instanceof Error ? err.message : String(err));
      }
    }

    const remainingFiles = filesOnDisk
      .filter((f) => recordedFiles.has(f.filename) && fs.existsSync(f.fullPath))
      .map((f) => ({ ...f, stat: fs.statSync(f.fullPath) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
    let totalSize = remainingFiles.reduce((sum, f) => sum + f.stat.size, 0);
    while (totalSize > this.MAX_BACKUP_DIR_BYTES && remainingFiles.length > 0) {
      const oldest = remainingFiles.shift();
      if (!oldest) break;
      try {
        fs.unlinkSync(oldest.fullPath);
        totalSize -= oldest.stat.size;
        this.logger.log(`P1-1: 目录超限，清理最旧备份: ${oldest.filename}`);
      } catch (err: unknown) {
        this.logger.warn(`清理最旧备份 ${oldest.filename} 失败`, err instanceof Error ? err.message : String(err));
        break;
      }
    }
  }
}
