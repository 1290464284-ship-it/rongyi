import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDiskFree, startDiskMonitor } from './disk-monitor';
import type { MaintenanceAlert } from './db-maintenance';
import type { Logger } from '../infrastructure/logger';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe('checkDiskFree', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('reports ok for a writable directory with a small threshold', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disk-'));
    const result = checkDiskFree(tempDir, 1);
    expect(result.dir).toBe(tempDir);
    expect(result.freeBytes).toBeGreaterThan(1);
    expect(result.ok).toBe(true);
  });

  it('reports not-ok below a huge threshold', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disk-'));
    const result = checkDiskFree(tempDir, Number.MAX_SAFE_INTEGER);
    expect(result.ok).toBe(false);
  });

  it('fails closed with zero bytes when the directory cannot be created', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disk-'));
    const blocker = path.join(tempDir, 'blocker');
    fs.writeFileSync(blocker, 'x');
    const result = checkDiskFree(path.join(blocker, 'sub'));
    expect(result.freeBytes).toBe(0);
    expect(result.ok).toBe(false);
  });

  it('applies the default threshold when none is provided', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disk-'));
    const result = checkDiskFree(tempDir); // 默认 1GB 阈值
    expect(result.ok).toBe(true);
  });
});

describe('startDiskMonitor', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('alerts once per directory below threshold, recovers, and re-alerts', () => {
    vi.useFakeTimers();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disk-mon-'));
    const alerts: MaintenanceAlert[] = [];
    const logger = makeLogger();
    const options = {
      dirs: [tempDir],
      intervalMs: 1000,
      thresholdBytes: Number.MAX_SAFE_INTEGER,
      logger,
      onAlert: (input: MaintenanceAlert) => alerts.push(input),
    };
    const monitor = startDiskMonitor(options);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(alerts).toHaveLength(1); // 去重：连续低于阈值只告警一次
    expect(alerts[0]).toMatchObject({ alertType: 'DISK_SPACE_LOW', level: 'CRITICAL', severity: 'CRITICAL' });

    options.thresholdBytes = 1; // 阈值回调：磁盘“恢复”
    vi.advanceTimersByTime(1000);
    expect(alerts).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith('disk space recovered', expect.objectContaining({ dir: tempDir }));

    options.thresholdBytes = Number.MAX_SAFE_INTEGER; // 再次低于阈值 → 重新告警
    vi.advanceTimersByTime(1000);
    expect(alerts).toHaveLength(2);

    monitor.stop();
  });

  it('stops the interval when stop() is called', () => {
    vi.useFakeTimers();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disk-stop-'));
    const alerts: MaintenanceAlert[] = [];
    const monitor = startDiskMonitor({
      dirs: [tempDir],
      intervalMs: 1000,
      thresholdBytes: Number.MAX_SAFE_INTEGER,
      logger: makeLogger(),
      onAlert: (input: MaintenanceAlert) => alerts.push(input),
    });
    vi.advanceTimersByTime(1000);
    expect(alerts).toHaveLength(1);
    monitor.stop();
    vi.advanceTimersByTime(60_000);
    expect(alerts).toHaveLength(1);
  });

  it('stays silent on a healthy tick without a prior alert', () => {
    vi.useFakeTimers();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disk-healthy-'));
    const alerts: MaintenanceAlert[] = [];
    const logger = makeLogger();
    const monitor = startDiskMonitor({
      dirs: [tempDir],
      intervalMs: 1000,
      thresholdBytes: 1, // 磁盘立即健康：alerted.delete 返回 false 的 else 分支
      logger,
      onAlert: (input: MaintenanceAlert) => alerts.push(input),
    });
    vi.advanceTimersByTime(1000);
    expect(alerts).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    monitor.stop();
  });

  it('falls back to the default threshold when the option is omitted', () => {
    vi.useFakeTimers();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-disk-default-'));
    const alerts: MaintenanceAlert[] = [];
    const logger = makeLogger();
    // 模拟 500MB 剩余空间：低于默认 1GB 阈值 → 告警，且日志记录默认阈值
    vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: 500 * 1024, bsize: 1024 } as never);
    const monitor = startDiskMonitor({
      dirs: [tempDir],
      intervalMs: 1000,
      logger,
      onAlert: (input: MaintenanceAlert) => alerts.push(input),
    });
    vi.advanceTimersByTime(1000);
    expect(alerts).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      'disk space below threshold',
      expect.objectContaining({ thresholdBytes: 1024 * 1024 * 1024 }),
    );
    monitor.stop();
    vi.restoreAllMocks();
  });
});
