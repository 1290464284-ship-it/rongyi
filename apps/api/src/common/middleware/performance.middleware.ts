import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface RequestWithRoute extends Request {
  route: { path?: string };
}

export interface PerformanceMiddlewareOptions {
  slowRequestThresholdMs?: number;
  enableStatsHeader?: boolean;
  excludePaths?: string[];
}

interface RequestStats {
  totalRequests: number;
  totalDuration: number;
  slowRequests: number;
  byMethod: Map<string, { count: number; totalDuration: number }>;
  byPath: Map<string, { count: number; totalDuration: number; slowCount: number }>;
  startTime: number;
}

const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 500;
const MAX_PATH_STATS_ENTRIES = 500;
const STATS_HEADER_NAME = 'X-Response-Time';

@Injectable()
export class PerformanceMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PerformanceMiddleware.name);
  private readonly slowRequestThresholdMs: number;
  private readonly enableStatsHeader: boolean;
  private readonly excludePaths: string[];
  private stats: RequestStats;

  constructor(options: PerformanceMiddlewareOptions = {}) {
    this.slowRequestThresholdMs = options.slowRequestThresholdMs ?? DEFAULT_SLOW_REQUEST_THRESHOLD_MS;
    this.enableStatsHeader = options.enableStatsHeader ?? true;
    this.excludePaths = options.excludePaths ?? [];
    this.stats = this.createEmptyStats();
  }

  private createEmptyStats(): RequestStats {
    return {
      totalRequests: 0,
      totalDuration: 0,
      slowRequests: 0,
      byMethod: new Map(),
      byPath: new Map(),
      startTime: Date.now(),
    };
  }

  private isExcluded(path: string): boolean {
    return this.excludePaths.some((p) => path.startsWith(p));
  }

  use(req: RequestWithRoute, res: Response, next: NextFunction) {
    if (this.isExcluded(req.originalUrl || req.url)) {
      next();
      return;
    }

    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationNs = process.hrtime.bigint() - start;
      const durationMs = Number(durationNs) / 1e6;

      if (this.enableStatsHeader) {
        res.setHeader(STATS_HEADER_NAME, `${durationMs.toFixed(2)}ms`);
      }

      this.recordStats(req.method, req.route?.path || req.originalUrl || req.url, durationMs, res.statusCode);

      if (durationMs > this.slowRequestThresholdMs) {
        this.logger.warn(
          `Slow request: ${req.method} ${req.originalUrl} status=${res.statusCode} duration=${durationMs.toFixed(2)}ms threshold=${this.slowRequestThresholdMs}ms`,
        );
      }
    });

    next();
  }

  private recordStats(method: string, path: string, durationMs: number, _statusCode: number): void {
    this.stats.totalRequests++;
    this.stats.totalDuration += durationMs;

    const methodUpper = method.toUpperCase();
    const methodStats = this.stats.byMethod.get(methodUpper) ?? { count: 0, totalDuration: 0 };
    methodStats.count++;
    methodStats.totalDuration += durationMs;
    this.stats.byMethod.set(methodUpper, methodStats);

    const pathKey = `${methodUpper} ${path}`;
    let pathStats = this.stats.byPath.get(pathKey);
    if (!pathStats) {
      if (this.stats.byPath.size >= MAX_PATH_STATS_ENTRIES) {
        return;
      }
      pathStats = { count: 0, totalDuration: 0, slowCount: 0 };
    }
    pathStats.count++;
    pathStats.totalDuration += durationMs;

    if (durationMs > this.slowRequestThresholdMs) {
      this.stats.slowRequests++;
      pathStats.slowCount++;
    }
    this.stats.byPath.set(pathKey, pathStats);
  }

  getStats() {
    const { totalRequests, totalDuration, slowRequests, byMethod, byPath, startTime } = this.stats;
    const avgDuration = totalRequests > 0 ? totalDuration / totalRequests : 0;
    const slowRate = totalRequests > 0 ? (slowRequests / totalRequests) * 100 : 0;
    const uptimeMs = Date.now() - startTime;

    const topSlowPaths = Array.from(byPath.entries())
      .sort((a, b) => b[1].totalDuration / b[1].count - a[1].totalDuration / a[1].count)
      .slice(0, 10)
      .map(([path, data]) => ({
        path,
        count: data.count,
        avgDuration: data.totalDuration / data.count,
        totalDuration: data.totalDuration,
        slowCount: data.slowCount,
      }));

    return {
      totalRequests,
      totalDurationMs: totalDuration,
      avgDurationMs: avgDuration,
      slowRequests,
      slowRatePercent: slowRate,
      uptimeMs,
      byMethod: Object.fromEntries(
        Array.from(byMethod.entries()).map(([method, data]) => [
          method,
          {
            count: data.count,
            avgDurationMs: data.count > 0 ? data.totalDuration / data.count : 0,
          },
        ]),
      ),
      topSlowPaths,
      slowRequestThresholdMs: this.slowRequestThresholdMs,
    };
  }

  resetStats(): void {
    this.stats = this.createEmptyStats();
  }
}
