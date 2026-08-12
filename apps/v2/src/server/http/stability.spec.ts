import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { persistStabilityMetrics, stabilitySnapshot } from './stability';

describe('stability snapshot', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-stability-spec-'));
    fs.writeFileSync(path.join(dir, 'v2.sqlite'), 'db');
    fs.writeFileSync(path.join(dir, 'v2.sqlite-wal'), 'wal');
    fs.mkdirSync(path.join(dir, 'backups'));
    fs.mkdirSync(path.join(dir, 'logs'));
    fs.writeFileSync(path.join(dir, 'logs', 'v2.log'), 'log');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports db/wal/log/backup sizes and uptime', () => {
    const snapshot = stabilitySnapshot(
      path.join(dir, 'v2.sqlite'),
      path.join(dir, 'backups'),
      path.join(dir, 'logs'),
    );
    expect(snapshot.dbSizeBytes).toBeGreaterThan(0);
    expect(snapshot.walSizeBytes).toBeGreaterThan(0);
    expect(snapshot.logFileCount).toBe(1);
    expect(snapshot.logBytes).toBeGreaterThan(0);
    expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('persists stability json without throwing', () => {
    expect(() => persistStabilityMetrics(
      path.join(dir, 'logs'),
      stabilitySnapshot(path.join(dir, 'v2.sqlite'), path.join(dir, 'backups'), path.join(dir, 'logs')),
    )).not.toThrow();
    expect(fs.existsSync(path.join(dir, 'logs', 'stability.json'))).toBe(true);
  });
});
