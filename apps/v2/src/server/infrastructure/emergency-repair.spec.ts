import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attemptEmergencyRepair } from './emergency-repair';
import type { Logger } from './logger';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function createHealthyDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('ok');");
  db.close();
}

describe('attemptEmergencyRepair', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.V2_EMERGENCY_REPAIR;
  });

  it('returns disabled when V2_EMERGENCY_REPAIR=0', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-repair-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createHealthyDb(dbPath);
    process.env.V2_EMERGENCY_REPAIR = '0';
    expect(attemptEmergencyRepair(dbPath, makeLogger())).toEqual({
      repaired: false,
      detail: 'emergency repair disabled by V2_EMERGENCY_REPAIR=0',
    });
  });

  it('succeeds on a healthy database (REINDEX is a no-op) and keeps a backup', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-repair-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createHealthyDb(dbPath);

    const result = attemptEmergencyRepair(dbPath, makeLogger());
    expect(result.repaired).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(fs.existsSync(result.backupPath!)).toBe(true);

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.prepare('SELECT v FROM t').get()).toEqual({ v: 'ok' });
    } finally {
      db.close();
    }
  });

  it('restores the original file unchanged when repair cannot fix the corruption', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-repair-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createHealthyDb(dbPath);
    // 制造不可修复的损坏：保留页头（可被打开），破坏其后全部内容
    const buffer = fs.readFileSync(dbPath);
    const corrupted = Buffer.from(buffer);
    corrupted.fill(0xab, 512);
    fs.writeFileSync(dbPath, corrupted);
    const hashBefore = fs.readFileSync(dbPath).toString('base64');

    const result = attemptEmergencyRepair(dbPath, makeLogger());
    expect(result.repaired).toBe(false);
    // fail-closed：失败后原文件必须逐字节还原
    expect(fs.readFileSync(dbPath).toString('base64')).toBe(hashBefore);
  });

  it('fails closed when the pre-repair copy cannot be made (missing file)', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-repair-'));
    const result = attemptEmergencyRepair(path.join(dir, 'missing.sqlite'), makeLogger());
    expect(result.repaired).toBe(false);
    expect(result.detail).toBe('pre-repair copy failed');
  });

  it('records the raw error detail when a non-Error value is thrown', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-repair-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createHealthyDb(dbPath);
    const execSpy = vi.spyOn(Database.prototype, 'exec').mockImplementation(() => {
      throw 'corrupt-signal';
    });
    try {
      const result = attemptEmergencyRepair(dbPath, makeLogger());
      expect(result.repaired).toBe(false);
      expect(result.detail).toBe('corrupt-signal');
    } finally {
      execSpy.mockRestore();
    }
  });

  it('reports integrity_check still failing after REINDEX succeeds', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-repair-'));
    const dbPath = path.join(dir, 'v2.sqlite');
    createHealthyDb(dbPath);
    // REINDEX runs cleanly but integrity_check keeps reporting a problem:
    // 覆盖“REINDEX 后 integrity_check 仍失败”的 fail-closed 分支。
    const originalPragma = Database.prototype.pragma;
    const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
      this: Database.Database,
      source: string,
    ) {
      if (source === 'integrity_check') return [{ integrity_check: 'database disk image is malformed' }];
      return originalPragma.call(this, source);
    });
    try {
      const result = attemptEmergencyRepair(dbPath, makeLogger());
      expect(result.repaired).toBe(false);
      expect(result.detail).toBe('integrity_check still failing after REINDEX');
    } finally {
      pragmaSpy.mockRestore();
    }
  });
});
