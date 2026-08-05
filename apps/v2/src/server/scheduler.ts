import type { BackupService } from './application/service-modules/backup';
import type { AuditService } from './application/service-modules/auth';
import type { Logger } from './infrastructure/logger';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;

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
  /**
   * Daily idempotency-record cleanup. Mirrors the return shape of
   * `cleanupIdempotencyRecords` in infrastructure/idempotency. Optional: when
   * absent no idempotency timer is registered.
   */
  idempotencyCleanup?: () => { deleted: number };
}

export function startSchedulers(options: StartSchedulersOptions): { stop(): void } {
  const {
    backups,
    audit,
    autoBackupIntervalMs,
    autoBackupKeep,
    logger,
    onAlertCreate,
    idempotencyCleanup,
  } = options;
  // Clamp preserved from main.ts: never back up more often than once a minute.
  const intervalMs = Math.max(60_000, autoBackupIntervalMs);

  let isRunning = false;
  const timers: Array<ReturnType<typeof setInterval>> = [];

  function schedule(callback: () => void, ms: number): void {
    const timer = setInterval(callback, ms);
    timer.unref?.();
    timers.push(timer);
  }

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

  function runIdempotencyCleanup(): void {
    if (!idempotencyCleanup) return;
    try {
      const { deleted } = idempotencyCleanup();
      if (deleted > 0) logger.info('idempotency cleanup completed', { action: 'idempotency-cleanup', deleted });
    } catch (error) {
      logger.error('idempotency cleanup failed', { action: 'idempotency-cleanup', error });
    }
  }

  // First run executes immediately (behavioral difference from the old
  // main.ts 5-minute first-delay is accepted by the caller).
  void runAutoBackup();
  schedule(() => void runAutoBackup(), intervalMs);

  cleanupAuditLogs();
  schedule(cleanupAuditLogs, DAILY_MS);

  // main.ts never ran the idempotency cleanup at startup, only on the daily
  // interval; keep that behavior.
  if (idempotencyCleanup) {
    schedule(runIdempotencyCleanup, DAILY_MS);
  }

  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
