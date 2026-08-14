import type { BackupService } from './application/service-modules/backup';
import type { AuditService } from './application/service-modules/auth';
import type { Logger } from './infrastructure/logger';

const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const SYNC_CHANGE_RETENTION_DAYS = 90;
const DAILY_MS = 24 * 60 * 60 * 1000;
// PROCESSING 幂等记录的超时是 30 分钟；清理周期必须远小于一天，
// 否则一次异常留下的记录会把 key 锁到下一个清理周期。
const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

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
  /** 每日数据库维护（quick_check + optimize + checkpoint）。缺省不注册。 */
  dailyDbMaintenance?: () => void;
  /** 每周数据库维护（incremental_vacuum / 受控全量 VACUUM）。缺省不注册。 */
  weeklyDbMaintenance?: () => void;
  /** 磁盘空间检查。缺省不注册。 */
  diskCheck?: () => void;
  /** 系统休眠唤醒后的即时维护回调（由 triggerResumeMaintenance 调用）。 */
  onResume?: () => void;
}

export function startSchedulers(options: StartSchedulersOptions): {
  stop(): Promise<void>;
  /** 系统休眠唤醒后的即时维护（IPC 'resume' 消息驱动）。 */
  triggerResumeMaintenance(): void;
} {
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
    dailyDbMaintenance,
    weeklyDbMaintenance,
    diskCheck,
    onResume,
  } = options;
  // Clamp preserved from main.ts: never back up more often than once a minute.
  const intervalMs = Math.max(60_000, autoBackupIntervalMs);

  let isRunning = false;
  let currentBackup: Promise<void> | null = null;
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
    const task = (async () => {
      try {
        const result = await backups.create({ type: 'AUTO' });
        const cleanup = backups.cleanup(autoBackupKeep);
        logger.info('automatic backup completed', { action: 'auto-backup', ...result, cleanup });
      } catch (error) {
        logger.error('automatic backup failed', { action: 'auto-backup', error });
        try {
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
        } catch (alertError) {
          logger.error('automatic backup alert creation failed', { action: 'auto-backup-alert', error: alertError });
        }
      } finally {
        isRunning = false;
      }
    })();
    currentBackup = task;
    try {
      await task;
    } finally {
      /* v8 ignore next -- isRunning 串行化保证 currentBackup 恒为当前 task，身份不符分支不可达（防御冗余） */
      if (currentBackup === task) currentBackup = null;
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
    /* v8 ignore next -- 注册点（line 181）已按 idempotencyCleanup 存在性 gate，闭包内空守卫不可达（防御冗余） */
    if (!idempotencyCleanup) return;
    runDailyCleanup(
      'idempotency-cleanup',
      'idempotency cleanup completed',
      'idempotency cleanup failed',
      () => idempotencyCleanup!(),
    );
  }

  function runSyncChangeCleanup(): void {
    /* v8 ignore next -- 注册点（line 186）已按 syncChangeCleanup 存在性 gate，闭包内空守卫不可达（防御冗余） */
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

  if (idempotencyCleanup) {
    runIdempotencyCleanup();
    schedule(runIdempotencyCleanup, IDEMPOTENCY_CLEANUP_INTERVAL_MS);
  }

  if (syncChangeCleanup) {
    runSyncChangeCleanup();
    schedule(runSyncChangeCleanup, DAILY_MS);
  }

  // ── 数据库维护与磁盘监控（可选项，缺省不注册）────────────────────────────
  // 首执行避开开机高峰：每日维护 2h 后、每周维护 3h 后；磁盘检查 1min 后首查。
  const MAINTENANCE_DAILY_OFFSET_MS = 2 * 60 * 60 * 1000;
  const MAINTENANCE_WEEKLY_MS = 7 * DAILY_MS;
  const DISK_CHECK_INTERVAL_MS = 15 * 60 * 1000;

  if (dailyDbMaintenance) {
    scheduleOnce(() => dailyDbMaintenance(), MAINTENANCE_DAILY_OFFSET_MS);
    schedule(dailyDbMaintenance, DAILY_MS);
  }
  if (weeklyDbMaintenance) {
    scheduleOnce(() => weeklyDbMaintenance(), MAINTENANCE_DAILY_OFFSET_MS + 60 * 60 * 1000);
    schedule(weeklyDbMaintenance, MAINTENANCE_WEEKLY_MS);
  }
  if (diskCheck) {
    scheduleOnce(() => diskCheck(), 60 * 1000);
    schedule(diskCheck, DISK_CHECK_INTERVAL_MS);
  }

  return {
    async stop(): Promise<void> {
      for (const timer of timers) clearInterval(timer);
      timers.length = 0;
      // shutdown 会在 stop() 后关闭数据库，必须等正在执行的自动备份结束，
      // 否则备份 API 会读到已被关闭的 SQLite 连接。
      if (currentBackup) {
        try {
          await currentBackup;
        } catch {
          // runAutoBackup 已记录失败并创建告警；stop 不再吞掉原始流程。
        }
      }
    },
    /**
     * 系统休眠唤醒后由 main.ts 的 IPC 'resume' 消息触发：立即执行一次
     * 维护（定时器在休眠期间暂停，唤醒后无需等下一个周期）。
     */
    triggerResumeMaintenance(): void {
      try {
        onResume?.();
        dailyDbMaintenance?.();
      } catch (error) {
        logger.error('resume maintenance failed', { action: 'maintenance-resume', error });
      }
    },
  };
}
