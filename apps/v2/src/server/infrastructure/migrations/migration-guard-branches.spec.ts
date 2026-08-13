import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrations121to130 } from './v121-130';
import { migrations153 } from './v153-153';
import { migrations155 } from './v155-155';
import { migrations156 } from './v156-156';

describe('migration defensive branches', () => {
  it('migration 155 skips without SearchIndex or Patient.wechatId', () => {
    const db = new Database(':memory:');
    expect(() => migrations155[0].up(db)).not.toThrow();
    db.exec('CREATE TABLE SearchIndex (id TEXT); CREATE TABLE Patient (id TEXT PRIMARY KEY);');
    expect(() => migrations155[0].up(db)).not.toThrow();
    db.close();
  });

  it('migration 156 skips without WechatReminder or its dedup columns', () => {
    const db = new Database(':memory:');
    expect(() => migrations156[0].up(db)).not.toThrow();
    db.exec('CREATE TABLE WechatReminder (id TEXT PRIMARY KEY);');
    expect(() => migrations156[0].up(db)).not.toThrow();
    db.close();
  });

  it('migration 121 skips when User has no clinicId column', () => {
    const db = new Database(':memory:');
    db.exec(
      'CREATE TABLE Clinic (id TEXT PRIMARY KEY, createdAt TEXT); CREATE TABLE UserClinic (userId TEXT, clinicId TEXT); CREATE TABLE User (id TEXT PRIMARY KEY);',
    );
    const migration = migrations121to130.find((entry) => entry.version === 121);
    expect(migration).toBeDefined();
    expect(() => migration!.up(db)).not.toThrow();
    db.close();
  });

  it('migration 153 refuses null clinic ids when no Clinic row exists', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE Clinic (id TEXT PRIMARY KEY, createdAt TEXT); CREATE TABLE UserRole (clinicId TEXT);');
    db.prepare('INSERT INTO UserRole (clinicId) VALUES (NULL)').run();
    const migration = migrations153.find((entry) => entry.version === 153);
    expect(migration).toBeDefined();
    expect(() => migration!.up(db)).toThrow('Migration 153 requires a Clinic row to backfill UserRole.clinicId');
    db.close();
  });
});
