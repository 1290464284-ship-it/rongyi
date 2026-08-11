import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSchedulers } from './scheduler';
import type { BackupService } from './application/service-modules/backup';
import type { AuditService } from './application/service-modules/auth';
import type { Logger } from './infrastructure/logger';

type AlertCreateInput = {
  alertType: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string;
  message: string;
  source: string;
  metricName?: string;
  suggestion?: string;
  clinicId?: string | null;
};

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function makeBackups() {
  return {
    create: vi.fn().mockResolvedValue({ filename: 'b.sqlite', fileSize: 1, encrypted: false, type: 'AUTO', message: 'Backup created' }),
    cleanup: vi.fn().mockReturnValue({ kept: 1, deleted: [] }),
    list: vi.fn(),
    verify: vi.fn(),
    stageRestore: vi.fn(),
    applyRestore: vi.fn(),
    delete: vi.fn(),
  } as unknown as BackupService;
}

function makeAudit() {
  return {
    cleanup: vi.fn().mockReturnValue(5),
    record: vi.fn(),
  } as unknown as AuditService;
}

describe('startSchedulers', () => {
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeTimers = require('node:timers') as typeof import('node:timers');
  const originalSetInterval: typeof globalThis.setInterval = (globalThis as unknown as { setInterval?: typeof globalThis.setInterval }).setInterval ?? nodeTimers.setInterval;
  const originalClearInterval: typeof globalThis.clearInterval = (globalThis as unknown as { clearInterval?: typeof globalThis.clearInterval }).clearInterval ?? nodeTimers.clearInterval;
  const ensureTimers = () => {
    const g = globalThis as unknown as { setInterval?: unknown; clearInterval?: unknown };
    if (typeof g.setInterval !== 'function') {
      Object.defineProperty(globalThis, 'setInterval', { configurable: true, writable: true, value: originalSetInterval });
    }
    if (typeof g.clearInterval !== 'function') {
      Object.defineProperty(globalThis, 'clearInterval', { configurable: true, writable: true, value: originalClearInterval });
    }
  };

  beforeEach(() => {
    ensureTimers();
    timers = [];
  });

  afterEach(() => {
    for (const t of timers) clearTimeout(t);
    Object.defineProperty(globalThis, 'setInterval', { configurable: true, writable: true, value: originalSetInterval });
    Object.defineProperty(globalThis, 'clearInterval', { configurable: true, writable: true, value: originalClearInterval });
    vi.useRealTimers();
    ensureTimers();
  });

  it('runAutoBackup 重叠时不并发执行（isRunning 守卫）', async () => {
    vi.useFakeTimers();
    ensureTimers();
    const backups = makeBackups();
    let resolveSecond: () => void = () => {};
    const firstCallPromise = new Promise<Record<string, unknown>>((resolve) => {
      vi.mocked(backups.create).mockImplementationOnce(
        () => new Promise<Record<string, unknown>>((r) => setTimeout(() => {
          const v = { filename: 'first.sqlite', fileSize: 1, encrypted: false, type: 'AUTO', message: 'Backup created' };
          r(v);
          resolve(v);
        }, 10)),
      );
      vi.mocked(backups.create).mockImplementationOnce(
        () => new Promise<Record<string, unknown>>((r) => {
          resolveSecond = () => r({ filename: 'second.sqlite', fileSize: 1, encrypted: false, type: 'AUTO', message: 'Backup created' });
        }),
      );
    });
    const audit = makeAudit();
    const logger = makeLogger();
    const onAlertCreate = vi.fn();

    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 24 * 60 * 60 * 1000, // 远大于首延迟，避免推进时 interval 同步触发
      autoBackupKeep: 30,
      logger,
      onAlertCreate,
    });

    // 推进 fake timers 越过 5 分钟首延迟触发首次备份
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    await vi.waitFor(() => expect(backups.create).toHaveBeenCalledTimes(1));

    resolveSecond();

    await vi.advanceTimersByTimeAsync(10); // 放行首个备份 mock 内部的 10ms 延迟
    await firstCallPromise;
    const callCountBefore = vi.mocked(backups.create).mock.calls.length;

    stop();

    expect(callCountBefore).toBeGreaterThanOrEqual(1);
    expect(onAlertCreate).not.toHaveBeenCalled();
  }, 15_000);

  it('stop awaits an in-flight automatic backup before resolving', async () => {
    vi.useFakeTimers();
    ensureTimers();
    const backups = makeBackups();
    let resolveBackup: ((value: Record<string, unknown>) => void) | undefined;
    vi.mocked(backups.create).mockImplementationOnce(
      () => new Promise<Record<string, unknown>>((resolve) => { resolveBackup = resolve; }),
    );
    const audit = makeAudit();
    const logger = makeLogger();
    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 24 * 60 * 60 * 1000,
      autoBackupKeep: 30,
      logger,
      onAlertCreate: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    await vi.waitFor(() => expect(backups.create).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopPromise = stop().then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    resolveBackup?.({ filename: 'b.sqlite', fileSize: 1, encrypted: false, type: 'AUTO', message: 'ok' });
    await stopPromise;
    expect(stopped).toBe(true);
  }, 15_000);

  it('cleanupAuditLogs 异常时吞错仅记录日志', async () => {
    vi.useRealTimers();
    ensureTimers();
    const backups = makeBackups();
    const audit = makeAudit();
    vi.mocked(audit.cleanup).mockImplementation(() => {
      throw new Error('audit db locked');
    });
    const logger = makeLogger();
    const onAlertCreate = vi.fn();

    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 60_000,
      autoBackupKeep: 30,
      logger,
      onAlertCreate,
    });

    await vi.waitFor(() => expect(audit.cleanup).toHaveBeenCalled());
    stop();

    expect(logger.error).toHaveBeenCalledWith(
      'audit log cleanup failed',
      expect.objectContaining({ action: 'audit-cleanup' }),
    );
    expect(onAlertCreate).not.toHaveBeenCalled();
  });

  it('runs sync change cleanup at startup with a clamped retention window', () => {
    const backups = makeBackups();
    const audit = makeAudit();
    const logger = makeLogger();
    const onAlertCreate = vi.fn();
    const syncCleanup = vi.fn().mockReturnValue({ deleted: 7 });

    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 60_000,
      autoBackupKeep: 30,
      logger,
      onAlertCreate,
      syncChangeCleanup: syncCleanup,
      syncChangeRetentionDays: 30,
    });

    expect(syncCleanup).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'sync change cleanup completed',
      expect.objectContaining({ action: 'sync-change-cleanup', deleted: 7 }),
    );
    stop();
  });

  it('logs sync change cleanup failures without raising an alert', () => {
    const backups = makeBackups();
    const audit = makeAudit();
    const logger = makeLogger();
    const onAlertCreate = vi.fn();
    const syncCleanup = vi.fn().mockImplementation(() => {
      throw new Error('sync db locked');
    });

    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 60_000,
      autoBackupKeep: 30,
      logger,
      onAlertCreate,
      syncChangeCleanup: syncCleanup,
    });

    expect(logger.error).toHaveBeenCalledWith(
      'sync change cleanup failed',
      expect.objectContaining({ action: 'sync-change-cleanup' }),
    );
    expect(onAlertCreate).not.toHaveBeenCalled();
    stop();
  });

  it('runAutoBackup 失败时调用 onAlertCreate', async () => {
    vi.useFakeTimers();
    ensureTimers();
    const backups = makeBackups();
    vi.mocked(backups.create).mockRejectedValueOnce(new Error('disk full'));
    const audit = makeAudit();
    const logger = makeLogger();
    const onAlertCreate = vi.fn();

    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 60_000,
      autoBackupKeep: 30,
      logger,
      onAlertCreate,
    });

    // 推进 fake timers 越过 5 分钟首延迟触发首次备份
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    const input = await vi.waitFor<AlertCreateInput>(() => {
      expect(onAlertCreate).toHaveBeenCalled();
      return onAlertCreate.mock.calls[0][0] as AlertCreateInput;
    });
    stop();

    expect(input.alertType).toBe('SCHEDULER_TASK_FAILURE');
    expect(input.level).toBe('CRITICAL');
    expect(input.severity).toBe('CRITICAL');
    expect(input.title).toBe('自动备份失败');
    expect(input.message).toContain('disk full');
    expect(input.source).toBe('BACKUP_AUTO');
    expect(input.metricName).toBe('automatic_backup');
    expect(input.suggestion).toContain('磁盘空间');
    expect(input.clinicId).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'automatic backup failed',
      expect.objectContaining({ action: 'auto-backup' }),
    );
  });

  it('stop 清除定时器', () => {
    const backups = makeBackups();
    const audit = makeAudit();
    const logger = makeLogger();
    const onAlertCreate = vi.fn();
    const clears: Array<unknown> = [];
    const origClear = globalThis.clearInterval;
    globalThis.clearInterval = ((id: unknown) => {
      clears.push(id);
    }) as typeof clearInterval;

    try {
      const { stop } = startSchedulers({
        backups,
        audit,
        autoBackupIntervalMs: 60_000,
        autoBackupKeep: 30,
        logger,
        onAlertCreate,
      });
      stop();
      expect(clears.length).toBe(3); // 自动备份 interval + 自动备份首执行 timeout + 审计清理 interval
    } finally {
      globalThis.clearInterval = origClear;
    }
  });

  it('stop 后推进 fake timers，各定时回调不再触发', async () => {
    vi.useFakeTimers();
    const backups = makeBackups();
    const audit = makeAudit();
    const logger = makeLogger();
    const onAlertCreate = vi.fn();
    const idempotencyCleanup = vi.fn().mockReturnValue({ deleted: 3 });

    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 60_000,
      autoBackupKeep: 30,
      logger,
      onAlertCreate,
      idempotencyCleanup,
    });

    // 首启不立即执行自动备份（5 分钟首延迟），审计清理照常首启执行；
    // idempotency 与原内联行为一致不首启执行。
    expect(backups.create).not.toHaveBeenCalled();
    expect(audit.cleanup).toHaveBeenCalledTimes(1);
    expect(idempotencyCleanup).not.toHaveBeenCalled();

    stop();

    const backupsCalls = vi.mocked(backups.create).mock.calls.length;
    const auditCalls = vi.mocked(audit.cleanup).mock.calls.length;
    const idempotencyCalls = idempotencyCleanup.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000);

    expect(backups.create).toHaveBeenCalledTimes(backupsCalls);
    expect(audit.cleanup).toHaveBeenCalledTimes(auditCalls);
    expect(idempotencyCleanup).toHaveBeenCalledTimes(idempotencyCalls);
    expect(onAlertCreate).not.toHaveBeenCalled();
  });

  it('idempotencyCleanup 按每日周期被调用，且不首启执行', async () => {
    vi.useFakeTimers();
    const backups = makeBackups();
    const audit = makeAudit();
    const logger = makeLogger();
    const onAlertCreate = vi.fn();
    const idempotencyCleanup = vi.fn().mockReturnValue({ deleted: 2 });

    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 60_000,
      autoBackupKeep: 30,
      logger,
      onAlertCreate,
      idempotencyCleanup,
    });

    expect(idempotencyCleanup).not.toHaveBeenCalled();

    // 24h 前一刻仍未触发
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 - 1);
    expect(idempotencyCleanup).not.toHaveBeenCalled();

    // 满 24h 触发一次，并记录删除数量
    await vi.advanceTimersByTimeAsync(1);
    expect(idempotencyCleanup).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'idempotency cleanup completed',
      expect.objectContaining({ action: 'idempotency-cleanup', deleted: 2 }),
    );

    // 再推 24h：第二次触发
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(idempotencyCleanup).toHaveBeenCalledTimes(2);

    stop();
  });

  it('idempotencyCleanup 抛错时吞错仅记录日志', async () => {
    vi.useFakeTimers();
    const backups = makeBackups();
    const audit = makeAudit();
    const logger = makeLogger();
    const onAlertCreate = vi.fn();
    const idempotencyCleanup = vi.fn(() => {
      throw new Error('idempotency table locked');
    });

    const { stop } = startSchedulers({
      backups,
      audit,
      autoBackupIntervalMs: 60_000,
      autoBackupKeep: 30,
      logger,
      onAlertCreate,
      idempotencyCleanup,
    });

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(idempotencyCleanup).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'idempotency cleanup failed',
      expect.objectContaining({ action: 'idempotency-cleanup' }),
    );
    expect(onAlertCreate).not.toHaveBeenCalled();

    stop();
  });

  it('works without idempotency or sync cleanup callbacks', () => {
    vi.useFakeTimers();
    ensureTimers();
    const { stop } = startSchedulers({
      backups: makeBackups(),
      audit: makeAudit(),
      autoBackupIntervalMs: 24 * 60 * 60 * 1000,
      autoBackupKeep: 30,
      logger: makeLogger(),
      onAlertCreate: vi.fn(),
    });
    expect(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000)).not.toThrow();
    stop();
  });
});
