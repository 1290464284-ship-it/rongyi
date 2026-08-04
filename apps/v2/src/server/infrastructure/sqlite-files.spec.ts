import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { summarizeSqliteFile } from './sqlite-files';

describe('sqlite file helpers', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-sqlite-files-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('summarizes core table counts and the latest paid charge', () => {
    const dbPath = path.join(dir, 'summary.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY)');
    db.exec('CREATE TABLE Charge (id TEXT PRIMARY KEY, paidAt TEXT)');
    db.prepare('INSERT INTO Charge (id, paidAt) VALUES (?, ?)').run('charge-1', '2026-08-04T00:00:00.000Z');
    db.prepare('INSERT INTO Charge (id, paidAt) VALUES (?, ?)').run('charge-2', '2026-08-05T00:00:00.000Z');
    db.close();

    const summary = summarizeSqliteFile(dbPath);
    expect(summary).toMatchObject({
      Patient: 0,
      Charge: 2,
      lastPaidAt: '2026-08-05T00:00:00.000Z',
    });
    expect(summary.Clinic).toBeUndefined();
  });

  it('handles databases without a charge table', () => {
    const dbPath = path.join(dir, 'summary-no-charge.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY)');
    db.close();

    expect(summarizeSqliteFile(dbPath).lastPaidAt).toBeNull();
  });

  it('handles charge tables without a paidAt column', () => {
    const dbPath = path.join(dir, 'summary-no-paid-at.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE Charge (id TEXT PRIMARY KEY)');
    db.close();

    expect(summarizeSqliteFile(dbPath).lastPaidAt).toBeNull();
  });
});
