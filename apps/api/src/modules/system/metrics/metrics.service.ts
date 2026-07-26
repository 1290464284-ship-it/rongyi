import { Injectable, OnModuleInit } from '@nestjs/common';

interface CounterLabels {
  [key: string]: string;
}

interface HistogramLabels {
  [key: string]: string;
}

interface CounterMetric {
  name: string;
  help: string;
  values: Map<string, number>;
}

interface HistogramBucket {
  le: number;
  count: number;
}

interface HistogramMetric {
  name: string;
  help: string;
  buckets: number[];
  values: Map<string, { sum: number; count: number; buckets: HistogramBucket[] }>;
}

interface GaugeMetric {
  name: string;
  help: string;
  value: number;
  labels?: CounterLabels;
}

@Injectable()
export class MetricsService implements OnModuleInit {
  private counters: Map<string, CounterMetric> = new Map();
  private histograms: Map<string, HistogramMetric> = new Map();
  private gauges: Map<string, GaugeMetric> = new Map();
  private activeRequests = 0;
  private eventLoopDelay = 0;
  private eventLoopDelayInterval: NodeJS.Timeout | null = null;

  onModuleInit() {
    this.initCounters();
    this.initHistograms();
    this.initGauges();
    this.startEventLoopDelayMonitor();
  }

  private initCounters() {
    this.createCounter('http_requests_total', 'Total HTTP requests', ['method', 'path', 'status_code']);
    this.createCounter('db_queries_total', 'Total database queries', ['operation']);
    this.createCounter('db_connections_total', 'Total database connections', []);
  }

  private initHistograms() {
    this.createHistogram(
      'http_request_duration_ms',
      'HTTP request duration in milliseconds',
      [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      ['method', 'path']
    );
  }

  private initGauges() {
    this.createGauge('http_active_requests', 'Number of active HTTP requests');
    this.createGauge('nodejs_heap_used_bytes', 'Used heap size in bytes');
    this.createGauge('nodejs_heap_total_bytes', 'Total heap size in bytes');
    this.createGauge('nodejs_rss_bytes', 'Resident set size in bytes');
    this.createGauge('nodejs_external_bytes', 'External memory size in bytes');
    this.createGauge('nodejs_event_loop_delay_ms', 'Event loop delay in milliseconds');
    this.createGauge('business_patients_total', 'Total number of patients');
    this.createGauge('business_appointments_total', 'Total number of appointments');
    this.createGauge('business_revenue_total_cents', 'Total revenue in cents');
  }

  private createCounter(name: string, help: string, _labelNames: string[]) {
    if (this.counters.has(name)) return;
    this.counters.set(name, {
      name,
      help,
      values: new Map(),
    });
  }

  private createHistogram(name: string, help: string, buckets: number[], _labelNames: string[]) {
    if (this.histograms.has(name)) return;
    this.histograms.set(name, {
      name,
      help,
      buckets: [...buckets, Infinity],
      values: new Map(),
    });
  }

  private createGauge(name: string, help: string, labels?: CounterLabels) {
    if (this.gauges.has(name)) return;
    this.gauges.set(name, {
      name,
      help,
      value: 0,
      labels,
    });
  }

  private labelsToKey(labels: CounterLabels): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  incrementRequest(method: string, path: string, statusCode: number) {
    const normalizedPath = this.normalizePath(path);
    const labels: CounterLabels = {
      method: method.toUpperCase(),
      path: normalizedPath,
      status_code: String(statusCode),
    };
    this.incrementCounter('http_requests_total', labels);
  }

  observeRequestDuration(method: string, path: string, durationMs: number) {
    const normalizedPath = this.normalizePath(path);
    const labels: HistogramLabels = {
      method: method.toUpperCase(),
      path: normalizedPath,
    };
    this.observeHistogram('http_request_duration_ms', labels, durationMs);
  }

  incrementActiveRequests() {
    this.activeRequests++;
    this.setGauge('http_active_requests', this.activeRequests);
  }

  decrementActiveRequests() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.setGauge('http_active_requests', this.activeRequests);
  }

  incrementDbQuery(operation: string) {
    this.incrementCounter('db_queries_total', { operation });
  }

  incrementDbConnection() {
    this.incrementCounter('db_connections_total', {});
  }

  setBusinessMetrics(patients: number, appointments: number, revenueCents: number) {
    this.setGauge('business_patients_total', patients);
    this.setGauge('business_appointments_total', appointments);
    this.setGauge('business_revenue_total_cents', revenueCents);
  }

  private incrementCounter(name: string, labels: CounterLabels) {
    const counter = this.counters.get(name);
    if (!counter) return;
    const key = this.labelsToKey(labels);
    const current = counter.values.get(key) || 0;
    counter.values.set(key, current + 1);
  }

  private observeHistogram(name: string, labels: HistogramLabels, value: number) {
    const histogram = this.histograms.get(name);
    if (!histogram) return;
    const key = this.labelsToKey(labels);
    let entry = histogram.values.get(key);
    if (!entry) {
      entry = {
        sum: 0,
        count: 0,
        buckets: histogram.buckets.map(le => ({ le, count: 0 })),
      };
      histogram.values.set(key, entry);
    }
    entry.sum += value;
    entry.count++;
    for (const bucket of entry.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  private setGauge(name: string, value: number) {
    const gauge = this.gauges.get(name);
    if (!gauge) return;
    gauge.value = value;
  }

  private normalizePath(path: string): string {
    if (!path) return '/';
    let normalized = path;
    if (normalized.includes('?')) {
      normalized = normalized.split('?')[0];
    }
    normalized = normalized.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}');
    normalized = normalized.replace(/\/\d+/g, '/{id}');
    return normalized;
  }

  private startEventLoopDelayMonitor() {
    const intervalMs = 1000;
    let lastTime = process.hrtime.bigint();
    this.eventLoopDelayInterval = setInterval(() => {
      const now = process.hrtime.bigint();
      const delayNs = now - lastTime - BigInt(intervalMs * 1e6);
      this.eventLoopDelay = Number(delayNs) / 1e6;
      this.setGauge('nodejs_event_loop_delay_ms', Math.max(0, this.eventLoopDelay));
      lastTime = now;
    }, intervalMs);
    this.eventLoopDelayInterval.unref();
  }

  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    this.setGauge('nodejs_heap_used_bytes', memUsage.heapUsed);
    this.setGauge('nodejs_heap_total_bytes', memUsage.heapTotal);
    this.setGauge('nodejs_rss_bytes', memUsage.rss);
    this.setGauge('nodejs_external_bytes', memUsage.external);
  }

  getMetrics(): string {
    this.collectSystemMetrics();
    const lines: string[] = [];

    for (const counter of this.counters.values()) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      for (const [labels, value] of counter.values.entries()) {
        if (labels) {
          lines.push(`${counter.name}{${labels}} ${value}`);
        } else {
          lines.push(`${counter.name} ${value}`);
        }
      }
      lines.push('');
    }

    for (const histogram of this.histograms.values()) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
      lines.push(`# TYPE ${histogram.name} histogram`);
      for (const [labels, entry] of histogram.values.entries()) {
        for (const bucket of entry.buckets) {
          const leLabel = bucket.le === Infinity ? '+Inf' : String(bucket.le);
          const bucketLabels = labels ? `${labels},le="${leLabel}"` : `le="${leLabel}"`;
          lines.push(`${histogram.name}_bucket{${bucketLabels}} ${bucket.count}`);
        }
        if (labels) {
          lines.push(`${histogram.name}_sum{${labels}} ${entry.sum}`);
          lines.push(`${histogram.name}_count{${labels}} ${entry.count}`);
        } else {
          lines.push(`${histogram.name}_sum ${entry.sum}`);
          lines.push(`${histogram.name}_count ${entry.count}`);
        }
      }
      lines.push('');
    }

    for (const gauge of this.gauges.values()) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      if (gauge.labels && Object.keys(gauge.labels).length > 0) {
        const labelStr = this.labelsToKey(gauge.labels);
        lines.push(`${gauge.name}{${labelStr}} ${gauge.value}`);
      } else {
        lines.push(`${gauge.name} ${gauge.value}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  resetMetrics() {
    for (const counter of this.counters.values()) {
      counter.values.clear();
    }
    for (const histogram of this.histograms.values()) {
      histogram.values.clear();
    }
    this.activeRequests = 0;
    this.setGauge('http_active_requests', 0);
  }
}
