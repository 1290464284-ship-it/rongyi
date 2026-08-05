import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildFtsQuery, rebuildSearchIndex } from './search-index';

describe('rebuildSearchIndex', () => {
  it('clears stale rows and rebuilds SearchIndex content for all six resources', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE Patient (id TEXT PRIMARY KEY, clinicId TEXT, name TEXT, code TEXT, phone TEXT, deletedAt TEXT);
      CREATE TABLE InventoryItem (id TEXT PRIMARY KEY, clinicId TEXT, name TEXT, code TEXT, category TEXT, deletedAt TEXT);
      CREATE TABLE Supplier (id TEXT PRIMARY KEY, clinicId TEXT, name TEXT, code TEXT, phone TEXT, deletedAt TEXT);
      CREATE TABLE Appointment (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, startTime TEXT, status TEXT, deletedAt TEXT);
      CREATE TABLE Charge (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, number TEXT, status TEXT, deletedAt TEXT);
      CREATE TABLE FollowUp (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, content TEXT, status TEXT, planDate TEXT, deletedAt TEXT);
      CREATE VIRTUAL TABLE SearchIndex USING fts5(resource UNINDEXED, recordId UNINDEXED, clinicId UNINDEXED, content);
    `);
    db.prepare(`INSERT INTO Patient (id, clinicId, name, code, phone) VALUES ('p1', 'c1', '张三', 'P001', '13800000000')`).run();
    db.prepare(`INSERT INTO SearchIndex(resource, recordId, clinicId, content) VALUES ('Patient', 'stale', 'c1', '旧数据')`).run();
    rebuildSearchIndex(db);
    const stale = db.prepare(`SELECT resource, recordId FROM SearchIndex WHERE recordId = 'stale'`).all();
    expect(stale).toHaveLength(0);
    const fresh = db.prepare(`SELECT recordId FROM SearchIndex WHERE resource = 'Patient' AND recordId = 'p1'`).all();
    expect(fresh).toHaveLength(1);
    db.close();
  });

  it('builds FTS query with quoted prefix tokens and escapes embedded quotes', () => {
    expect(buildFtsQuery('张三  138')).toBe('"张三"* "138"*');
    expect(buildFtsQuery('a "b" c')).toBe('"a"* """b"""* "c"*');
    expect(buildFtsQuery('   ')).toBe('');
  });
});
