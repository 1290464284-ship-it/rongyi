import type { BackupService } from './application/service-modules/backup';
import type { AuditService } from './application/service-modules/auth';
import type { Logger } from './infrastructure/logger';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const SYNC_CHANGE_RETENTION_DAYS = 90;
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
  /** Daily sync-change retention cleanup; receives the UTC cutoff string. */
  syncChangeCleanup?: (beforeIso: string) => { deleted: number };
  syncChangeRetentionDays?: number;
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
    syncChangeCleanup,
    syncChangeRetentionDays,
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

  function scheduleOnce(callback: () => void, ms: number): void {
    const timer = setTimeout(callback, ms);
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
    runDailyCleanup(
      'audit-cleanup',
      'audit log cleanup completed',
      'audit log cleanup failed',
      () => ({ deleted: audit.cleanup(new Date(Date.now() - AUDIT_RETENTION_MS).toISOString()) }),
    );
  }

  function runIdempotencyCleanup(): void {
    if (!idempotencyCleanup) return;
    runDailyCleanup(
      'idempotency-cleanup',
      'idempotency cleanup completed',
      'idempotency cleanup failed',
      () => idempotencyCleanup!(),
    );
  }

  function runSyncChangeCleanup(): void {
    if (!syncChangeCleanup) return;
    runDailyCleanup(
      'sync-change-cleanup',
      'sync change cleanup completed',
      'sync change cleanup failed',
      () => {
        const retentionDays = Number.isFinite(Number(syncChangeRetentionDays))
          ? Math.min(3650, Math.max(1, Math.floor(Number(syncChangeRetentionDays))))
          : SYNC_CHANGE_RETENTION_DAYS;
        const before = new Date(Date.now() - retentionDays * DAILY_MS).toISOString();
        return syncChangeCleanup!(before);
      },
    );
  }

  function runDailyCleanup(
    action: string,
    infoMessage: string,
    errorMessage: string,
    run: () => { deleted: number },
  ): void {
    try {
      const { deleted } = run();
      if (deleted > 0) logger.info(infoMessage, { action, deleted });
    } catch (error) {
      logger.error(errorMessage, { action, error });
    }
  }

  // 首执行延迟 5 分钟（恢复原 main.ts 的首延迟行为），避免每次启动立即执行
  // 全量备份拖慢启动；此后按 intervalMs 周期执行。
  scheduleOnce(() => void runAutoBackup(), 5 * 60 * 1000);
  schedule(() => void runAutoBackup(), intervalMs);

  cleanupAuditLogs();
  schedule(cleanupAuditLogs, DAILY_MS);

  // main.ts never ran the idempotency cleanup at startup, only on the daily
  // interval; keep that behavior.
  if (idempotencyCleanup) {
    schedule(runIdempotencyCleanup, DAILY_MS);
  }

  if (syncChangeCleanup) {
    runSyncChangeCleanup();
    schedule(runSyncChangeCleanup, DAILY_MS);
  }

  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
    },
  };
}
