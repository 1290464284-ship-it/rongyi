import type { BackupService } from './application/service-modules/backup';
import type { AuditService } from './application/service-modules/auth';
import type { Logger } from './infrastructure/logger';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

interface StartSchedulersOptions {
  backups: BackupService;
  audit: AuditService;
  autoBackupIntervalMs: number;
  autoBackupKeep: number;
  logger: Logger;
  onAlertCreate: (input: {
    alertType: string;
    level: 'INFO' | 'WARNING' | 'CRITICAL';
    severity: 'INFO' | 'WARN' | 'CRITICAL';
    title: string;
    message: string;
    source: string;
    metricName?: string;
    suggestion?: string;
    clinicId?: string | null;
  }) => void;
}

export function startSchedulers(options: StartSchedulersOptions): { stop(): void } {
  const { backups, audit, autoBackupIntervalMs, autoBackupKeep, logger, onAlertCreate } = options;
  const intervalMs = Math.max(60_000, autoBackupIntervalMs);

  let isRunning = false;
  let backupTimer: ReturnType<typeof setInterval> | null = null;
  let auditTimer: ReturnType<typeof setInterval> | null = null;

  async function runAutoBackup(): Promise<void> {
    if (isRunning) return;
    isRunning = true;
    try {
      const result = await backups.create({ type: 'AUTO' });
      const cleanup = backups.cleanup(autoBackupKeep);
      logger.info('automatic backup completed', { action: 'auto-backup', ...result, cleanup });
    } catch (error) {
      logger.error('automatic backup failed', { action: 'auto-backup', error });
      onAlertCreate({
        alertType: 'SCHEDULER_TASK_FAILURE',
        level: 'CRITICAL',
        severity: 'CRITICAL',
        title: '自动备份失败',
        message: error instanceof Error ? error.message : String(error),
        source: 'BACKUP_AUTO',
        metricName: 'automatic_backup',
        suggestion: '请检查磁盘空间、备份目录权限和备份密钥。',
        clinicId: null,
      });
    } finally {
      isRunning = false;
    }
  }

  function cleanupAuditLogs(): void {
    try {
      const deleted = audit.cleanup(new Date(Date.now() - AUDIT_RETENTION_MS).toISOString());
      if (deleted > 0) logger.info('audit log cleanup completed', { action: 'audit-cleanup', deleted });
    } catch (error) {
      logger.error('audit log cleanup failed', { action: 'audit-cleanup', error });
    }
  }

  void runAutoBackup();
  backupTimer = setInterval(() => void runAutoBackup(), intervalMs);
  backupTimer.unref?.();

  cleanupAuditLogs();
  auditTimer = setInterval(cleanupAuditLogs, 24 * 60 * 60 * 1000);
  auditTimer.unref?.();

  return {
    stop() {
      if (backupTimer) {
        clearInterval(backupTimer);
        backupTimer = null;
      }
      if (auditTimer) {
        clearInterval(auditTimer);
        auditTimer = null;
      }
    },
  };
}
