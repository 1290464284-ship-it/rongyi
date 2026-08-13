import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { AppError } from '../../infrastructure/errors';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { assertActiveClinic } from './clinic-access';

describe('assertActiveClinic', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-clinic-access-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns the clinic id for active clinics and rejects missing or disabled clinics', () => {
    expect(assertActiveClinic(db, 'clinic-v2-001')).toBe('clinic-v2-001');
    expect(() => assertActiveClinic(db, 'missing-clinic')).toThrow(AppError);
    expect(() => assertActiveClinic(db, 'missing-clinic')).toThrow('Clinic is disabled or deleted');
    db.prepare('UPDATE Clinic SET active = 0 WHERE id = ?').run('clinic-v2-001');
    expect(() => assertActiveClinic(db, 'clinic-v2-001')).toThrow(AppError);
  });

  it('short-circuits when no database is available', () => {
    expect(assertActiveClinic(undefined, 'any-clinic')).toBe('any-clinic');
  });
});
