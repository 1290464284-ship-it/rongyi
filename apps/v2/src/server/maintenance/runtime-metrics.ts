import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface RuntimeMetricsSample {
  sampledAt: string;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  activeResources: Record<string, number>;
  eventLoop: { maxLagMs: number; meanLagMs: number; p99LagMs: number };
  db: {
    pageCount: number;
    freelistCount: number;
    walSizeHint: number;
  };
}

export function createRuntimeMetricsSampler(
  db: Database.Database,
  getWalSizeBytes: () => number,
): { sample(): RuntimeMetricsSample } {
  const lagHistogram = monitorEventLoopDelay({ resolution: 20 });
  lagHistogram.enable();
  return {
    sample(): RuntimeMetricsSample {
      const mem = process.memoryUsage();
      const resources: Record<string, number> = {};
      for (const raw of process.getActiveResourcesInfo()) {
        const name = raw.split('-').length > 1 ? raw.split('-')[0] : raw;
        resources[name] = (resources[name] ?? 0) + 1;
      }
      return {
        sampledAt: new Date().toISOString(),
        memory: {
          rssBytes: mem.rss,
          heapUsedBytes: mem.heapUsed,
          heapTotalBytes: mem.heapTotal,
          externalBytes: mem.external,
        },
        activeResources: resources,
        eventLoop: {
          // 无样本时直方图返回 NaN（mean 为 NaN、percentile 亦为 NaN），按 0 输出。
          /* v8 ignore next -- 测试环境直方图恒有样本（max/percentile 初值有限），NaN 路径仅文档化防御 */
          maxLagMs: Number.isFinite(lagHistogram.max) ? Number(lagHistogram.max.toFixed(2)) : 0,
          /* v8 ignore next -- 同上 */
          meanLagMs: Number.isFinite(lagHistogram.mean) ? Number(lagHistogram.mean.toFixed(2)) : 0,
          /* v8 ignore next -- 同上 */
          p99LagMs: Number.isFinite(lagHistogram.percentile(99)) ? Number(lagHistogram.percentile(99).toFixed(2)) : 0,
        },
        db: {
          pageCount: Number(db.pragma('page_count', { simple: true })),
          freelistCount: Number(db.pragma('freelist_count', { simple: true })),
          walSizeHint: getWalSizeBytes(),
        },
      };
    },
  };
}

/** 与 persistStabilityMetrics 同风格落盘 logs/runtime.json。 */
export function persistRuntimeMetrics(logDir: string, sample: RuntimeMetricsSample): void {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, 'runtime.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), runtime: sample }, null, 2),
      'utf8',
    );
  } catch {
    // 可观测性落盘失败不得影响业务。
  }
}
