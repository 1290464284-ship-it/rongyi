import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkClockDrift, writeClockMarker } from './clock-drift';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('clock drift (A-P3.3)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-clock-drift-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports no drift without a marker', () => {
    const result = checkClockDrift(path.join(dir, 'last-run.json'), 72 * 60 * 60 * 1000);
    expect(result.drifted).toBe(false);
    expect(result.lastStartedAt).toBeNull();
  });

  it('reports no drift for a normal recent marker', () => {
    const marker = path.join(dir, 'last-run.json');
    fs.writeFileSync(marker, JSON.stringify({ startedAt: new Date(Date.now() - 60_000).toISOString() }));
    const result = checkClockDrift(marker, 72 * 60 * 60 * 1000);
    expect(result.drifted).toBe(false);
    expect(result.lastStartedAt).toBeTruthy();
  });

  it('reports drift when the last start is more than 72h in the future', () => {
    const marker = path.join(dir, 'last-run.json');
    fs.writeFileSync(marker, JSON.stringify({ startedAt: new Date(Date.now() + 3 * DAY_MS + 1000).toISOString() }));
    const result = checkClockDrift(marker, 72 * 60 * 60 * 1000);
    expect(result.drifted).toBe(true);
    expect(result.driftMs).toBeLessThan(-72 * 60 * 60 * 1000);
  });

  it('tolerates a corrupt marker and a missing startedAt', () => {
    const corrupt = path.join(dir, 'corrupt.json');
    fs.writeFileSync(corrupt, '{bad json');
    expect(checkClockDrift(corrupt, 72 * 60 * 60 * 1000).drifted).toBe(false);

    const noStartedAt = path.join(dir, 'no-started.json');
    fs.writeFileSync(noStartedAt, JSON.stringify({ other: 1 }));
    const result = checkClockDrift(noStartedAt, 72 * 60 * 60 * 1000);
    expect(result.drifted).toBe(false);
    expect(result.lastStartedAt).toBeNull();
  });

  it('treats an invalid date string as no drift', () => {
    const marker = path.join(dir, 'invalid-date.json');
    fs.writeFileSync(marker, JSON.stringify({ startedAt: 'not-a-date' }));
    const result = checkClockDrift(marker, 72 * 60 * 60 * 1000);
    expect(result.drifted).toBe(false);
    expect(result.driftMs).toBe(0);
  });

  it('writes the marker and tolerates an unwritable target', () => {
    const marker = path.join(dir, 'logs', 'last-run.json');
    writeClockMarker(marker, path.join(dir, 'logs'));
    const parsed = JSON.parse(fs.readFileSync(marker, 'utf8')) as { startedAt: string };
    expect(typeof parsed.startedAt).toBe('string');
    // 目标被普通文件占位 → 静默失败
    const blocked = path.join(dir, 'blocked');
    fs.writeFileSync(blocked, 'x');
    expect(() => writeClockMarker(path.join(blocked, 'last-run.json'), blocked)).not.toThrow();
  });
});
