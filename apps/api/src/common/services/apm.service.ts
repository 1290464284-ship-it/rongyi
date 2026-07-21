import { Injectable } from '@nestjs/common';

/**
 * APM (应用性能监控) 服务
 * 提供轻量级的性能追踪能力
 * 未来可集成 OpenTelemetry / Prometheus / Datadog 等
 */
@Injectable()
export class ApmService {
  private metrics: Map<string, { count: number; totalMs: number; maxMs: number; minMs: number }> = new Map();

  /**
   * 追踪函数执行时间
   */
  async track<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.recordMetric(name, Date.now() - start);
      return result;
    } catch (err) {
      this.recordMetric(name, Date.now() - start, true);
      throw err;
    }
  }

  /**
   * 同步追踪
   */
  trackSync<T>(name: string, fn: () => T): T {
    const start = Date.now();
    try {
      const result = fn();
      this.recordMetric(name, Date.now() - start);
      return result;
    } catch (err) {
      this.recordMetric(name, Date.now() - start, true);
      throw err;
    }
  }

  private recordMetric(name: string, durationMs: number, isError = false): void {
    const key = isError ? `${name}:error` : name;
    const existing = this.metrics.get(key) || { count: 0, totalMs: 0, maxMs: 0, minMs: Infinity };
    existing.count++;
    existing.totalMs += durationMs;
    existing.maxMs = Math.max(existing.maxMs, durationMs);
    existing.minMs = Math.min(existing.minMs, durationMs);
    this.metrics.set(key, existing);
  }

  /**
   * 获取性能指标快照
   */
  getMetrics(): Record<string, { count: number; avgMs: number; maxMs: number; minMs: number }> {
    const result: Record<string, { count: number; avgMs: number; maxMs: number; minMs: number }> = {};
    for (const [key, val] of this.metrics.entries()) {
      result[key] = {
        count: val.count,
        avgMs: Math.round(val.totalMs / val.count * 100) / 100,
        maxMs: val.maxMs,
        minMs: val.minMs === Infinity ? 0 : val.minMs,
      };
    }
    return result;
  }

  /**
   * 重置指标
   */
  reset(): void {
    this.metrics.clear();
  }
}
