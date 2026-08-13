import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../infrastructure/logger';
import type { MaintenanceAlert } from './db-maintenance';

export interface DiskCheckResult {
  dir: string;
  freeBytes: number;
  ok: boolean;
}

const DEFAULT_DISK_THRESHOLD_BYTES = 1024 * 1024 * 1024; // 1GB

export function checkDiskFree(
  dir: string,
  thresholdBytes: number = DEFAULT_DISK_THRESHOLD_BYTES,
): DiskCheckResult {
  let freeBytes = 0;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const statfs = fs.statfsSync(dir);
    freeBytes = statfs.bavail * statfs.bsize;
  } catch {
    freeBytes = 0;
  }
  return { dir, freeBytes, ok: freeBytes > thresholdBytes };
}

export function startDiskMonitor(options: {
  dirs: string[];
  intervalMs: number;
  thresholdBytes?: number;
  logger: Logger;
  onAlert: (input: MaintenanceAlert) => void;
}): { stop(): void } {
  const alerted = new Set<string>();
  // 每次 tick 读取 options.thresholdBytes，允许运行期调整阈值（测试与运维调参）。
  const threshold = () => options.thresholdBytes ?? DEFAULT_DISK_THRESHOLD_BYTES;
  const timer = setInterval(() => {
    for (const dir of options.dirs) {
      const result = checkDiskFree(dir, threshold());
      if (result.ok) {
        if (alerted.delete(dir)) {
          options.logger.info('disk space recovered', { action: 'disk-monitor-recovered', dir });
        }
        continue;
      }
      if (alerted.has(dir)) continue; // 每个目录只告警一次，恢复后重置
      alerted.add(dir);
      options.logger.error('disk space below threshold', {
        action: 'disk-monitor',
        dir,
        freeBytes: result.freeBytes,
        thresholdBytes: threshold(),
      });
      options.onAlert({
        alertType: 'DISK_SPACE_LOW',
        level: 'CRITICAL',
        severity: 'CRITICAL',
        title: '磁盘空间不足',
        message: `${path.basename(dir)} 所在磁盘剩余 ${Math.round(result.freeBytes / (1024 * 1024))}MB，低于告警阈值。请清理磁盘或迁移备份目录。`,
        source: 'DISK_MONITOR',
        metricName: 'disk_free_bytes',
        suggestion: '备份会自动保留最近 N 份；可在备份页调整保留数量，或把备份目录迁移到更大磁盘。',
        clinicId: null,
      });
    }
  }, options.intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
