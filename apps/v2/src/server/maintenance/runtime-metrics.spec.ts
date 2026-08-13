import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeMetricsSampler, persistRuntimeMetrics, type RuntimeMetricsSample } from './runtime-metrics';

describe('createRuntimeMetricsSampler', () => {
  it('samples memory, active resources, event loop lag, and db stats', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    const sampler = createRuntimeMetricsSampler(db, () => 1234);
    const sample = sampler.sample();
    expect(sample.memory.rssBytes).toBeGreaterThan(0);
    expect(sample.memory.heapUsedBytes).toBeGreaterThan(0);
    expect(sample.memory.heapTotalBytes).toBeGreaterThan(0);
    expect(Object.keys(sample.activeResources).length).toBeGreaterThan(0);
    expect(sample.eventLoop.maxLagMs).toBeGreaterThanOrEqual(0);
    expect(sample.eventLoop.meanLagMs).toBeGreaterThanOrEqual(0);
    expect(sample.eventLoop.p99LagMs).toBeGreaterThanOrEqual(0);
    expect(sample.db.pageCount).toBeGreaterThan(0);
    expect(sample.db.freelistCount).toBeGreaterThanOrEqual(0);
    expect(sample.db.walSizeHint).toBe(1234);
    expect(Number.isNaN(Date.parse(sample.sampledAt))).toBe(false);
    db.close();
  });
});

function minimalSample(): RuntimeMetricsSample {
  return {
    sampledAt: new Date().toISOString(),
    memory: { rssBytes: 1, heapUsedBytes: 2, heapTotalBytes: 3, externalBytes: 4 },
    activeResources: { Timeout: 1 },
    eventLoop: { maxLagMs: 0, meanLagMs: 0, p99LagMs: 0 },
    db: { pageCount: 1, freelistCount: 0, walSizeHint: 0 },
  };
}

describe('persistRuntimeMetrics', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes runtime.json into the log directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-runtime-'));
    persistRuntimeMetrics(tempDir, minimalSample());
    const parsed = JSON.parse(fs.readFileSync(path.join(tempDir, 'runtime.json'), 'utf8')) as { runtime: RuntimeMetricsSample };
    expect(parsed.runtime.memory.rssBytes).toBe(1);
    expect(parsed.runtime.db.walSizeHint).toBe(0);
  });

  it('swallows write failures so observability never breaks the app', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-runtime-'));
    const blocker = path.join(tempDir, 'blocker');
    fs.writeFileSync(blocker, 'x');
    // mkdirSync(blocker) 会因同名文件存在而抛错 → 函数应静默吞掉
    expect(() => persistRuntimeMetrics(blocker, minimalSample())).not.toThrow();
  });
});
