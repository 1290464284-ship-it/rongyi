import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';

interface MetricBucket {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  errorCount: number;
}

const metrics = new Map<string, MetricBucket>();

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const key = `${req.method} ${req.route?.path ?? req.path} ${res.statusCode}`;
    const current = metrics.get(key) ?? { count: 0, totalDurationMs: 0, maxDurationMs: 0, errorCount: 0 };
    current.count += 1;
    current.totalDurationMs += durationMs;
    current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
    if (res.statusCode >= 500) current.errorCount += 1;
    metrics.set(key, current);
  });
  next();
}

export function metricsSnapshot(): Array<Record<string, unknown>> {
  return Array.from(metrics.entries())
    .map(([key, value]) => ({
      key,
      count: value.count,
      avgDurationMs: value.count > 0 ? Math.round(value.totalDurationMs / value.count) : 0,
      maxDurationMs: value.maxDurationMs,
      errorCount: value.errorCount,
    }))
    .sort((a, b) => Number(b.count) - Number(a.count));
}

export function persistMetrics(logDir: string, snapshot: Array<Record<string, unknown>>): void {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'metrics.json'), JSON.stringify({ timestamp: new Date().toISOString(), metrics: snapshot }, null, 2), 'utf8');
  } catch {
    // Metrics persistence must not break the API.
  }
}
