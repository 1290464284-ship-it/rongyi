import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createDatabase } from './database';
import {
  buildFtsQuery,
  rebuildSearchIndex,
  upsertSearchRow,
  removeSearchRow,
  removeSearchRowsByRecordIds,
  refreshPatientChildSearchRows,
} from './search-index';

describe('rebuildSearchIndex', () => {
  it('clears stale rows and rebuilds SearchIndex content for all six resources', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE Patient (id TEXT PRIMARY KEY, clinicId TEXT, name TEXT, code TEXT, phone TEXT, wechatId TEXT, deletedAt TEXT);
      CREATE TABLE InventoryItem (id TEXT PRIMARY KEY, clinicId TEXT, name TEXT, code TEXT, category TEXT, deletedAt TEXT);
      CREATE TABLE Supplier (id TEXT PRIMARY KEY, clinicId TEXT, name TEXT, code TEXT, phone TEXT, deletedAt TEXT);
      CREATE TABLE Appointment (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, startTime TEXT, status TEXT, deletedAt TEXT);
      CREATE TABLE Charge (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, number TEXT, status TEXT, deletedAt TEXT);
      CREATE TABLE FollowUp (id TEXT PRIMARY KEY, clinicId TEXT, patientId TEXT, content TEXT, status TEXT, planDate TEXT, deletedAt TEXT);
      CREATE VIRTUAL TABLE SearchIndex USING fts5(resource UNINDEXED, recordId UNINDEXED, clinicId UNINDEXED, content);
    `);
    db.prepare(`INSERT INTO Patient (id, clinicId, name, code, phone, wechatId) VALUES ('p1', 'c1', '张三', 'P001', '13800000000', 'wx-001')`).run();
    db.prepare(`INSERT INTO SearchIndex(resource, recordId, clinicId, content) VALUES ('Patient', 'stale', 'c1', '旧数据')`).run();
    rebuildSearchIndex(db);
    const stale = db.prepare(`SELECT resource, recordId FROM SearchIndex WHERE recordId = 'stale'`).all();
    expect(stale).toHaveLength(0);
    const fresh = db.prepare(`SELECT recordId FROM SearchIndex WHERE resource = 'Patient' AND recordId = 'p1'`).all();
    expect(fresh).toHaveLength(1);
    const content = db.prepare(`SELECT content FROM SearchIndex WHERE resource = 'Patient' AND recordId = 'p1'`).get() as { content: string };
    expect(content.content).toContain('wx-001');
    db.close();
  });

  it('builds FTS query with quoted prefix tokens and escapes embedded quotes', () => {
    expect(buildFtsQuery('张三  138')).toBe('"张三"* "138"*');
    expect(buildFtsQuery('a "b" c')).toBe('"a"* """b"""* "c"*');
    expect(buildFtsQuery('   ')).toBe('');
  });
});

describe('runtime SearchIndex maintenance', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-search-runtime-'));
    db = createDatabase(dataDir);
    // repository.spec.ts 同款：createDatabase 不跑迁移，按迁移 115 的 DDL 建 FTS 表。
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS SearchIndex USING fts5(
      resource UNINDEXED,
      recordId UNINDEXED,
      clinicId UNINDEXED,
      content
    )`);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertPatient(id: string, name: string, code: string, phone: string): void {
    db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, name, code, phone)
       VALUES (?, 'c1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?, ?, ?)`,
    ).run(id, name, code, phone);
  }

  function searchRows(resource: string, recordId: string): Array<{
    resource: string;
    recordId: string;
    clinicId: string | null;
    content: string;
  }> {
    return db.prepare(
      `SELECT resource, recordId, clinicId, content FROM SearchIndex WHERE resource = ? AND recordId = ?`,
    ).all(resource, recordId) as Array<{
      resource: string;
      recordId: string;
      clinicId: string | null;
      content: string;
    }>;
  }

  it('upserts a fresh index row for a new Patient with name/code/phone content', () => {
    insertPatient('si-p-new', '李四', 'P-SI-01', '13800000001');
    upsertSearchRow(db, 'Patient', 'si-p-new');
    const rows = searchRows('Patient', 'si-p-new');
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('李四');
    expect(rows[0].content).toContain('P-SI-01');
    expect(rows[0].content).toContain('13800000001');
  });

  it('re-upserting after an update replaces content and keeps a single row', () => {
    insertPatient('si-p-upd', '旧名字', 'P-SI-02', '13800000002');
    upsertSearchRow(db, 'Patient', 'si-p-upd');
    db.prepare(`UPDATE Patient SET name = ? WHERE id = 'si-p-upd'`).run('新名字');
    upsertSearchRow(db, 'Patient', 'si-p-upd');
    const rows = searchRows('Patient', 'si-p-upd');
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('新名字');
    expect(rows[0].content).not.toContain('旧名字');
  });

  it('removes the index row on removeSearchRow', () => {
    insertPatient('si-p-del', '待删', 'P-SI-03', '13800000003');
    upsertSearchRow(db, 'Patient', 'si-p-del');
    expect(searchRows('Patient', 'si-p-del')).toHaveLength(1);
    removeSearchRow(db, 'Patient', 'si-p-del');
    expect(searchRows('Patient', 'si-p-del')).toHaveLength(0);
  });

  it('removes multiple index rows in one batch', () => {
    insertPatient('si-p-batch-a', '批量甲', 'P-SI-05', '13800000005');
    insertPatient('si-p-batch-b', '批量乙', 'P-SI-06', '13800000006');
    upsertSearchRow(db, 'Patient', 'si-p-batch-a');
    upsertSearchRow(db, 'Patient', 'si-p-batch-b');
    removeSearchRowsByRecordIds(db, 'Patient', ['si-p-batch-a', 'si-p-batch-b']);
    expect(searchRows('Patient', 'si-p-batch-a')).toHaveLength(0);
    expect(searchRows('Patient', 'si-p-batch-b')).toHaveLength(0);
  });

  it('refreshes child Appointment rows after a patient rename', () => {
    insertPatient('si-p-child', '张三', 'P-SI-04', '13800000004');
    upsertSearchRow(db, 'Patient', 'si-p-child');
    db.prepare(
      `INSERT INTO Appointment (id, clinicId, createdAt, updatedAt, patientId, startTime, endTime, status, type)
       VALUES ('si-a-1', 'c1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
               'si-p-child', '2026-02-01T09:00:00.000Z', '2026-02-01T10:00:00.000Z', 'BOOKED', 'REGULAR')`,
    ).run();
    upsertSearchRow(db, 'Appointment', 'si-a-1');
    expect(searchRows('Appointment', 'si-a-1')[0].content).toContain('张三');

    db.prepare(`UPDATE Patient SET name = ? WHERE id = 'si-p-child'`).run('张三丰');
    refreshPatientChildSearchRows(db, 'si-p-child');
    const rows = searchRows('Appointment', 'si-a-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('张三丰 2026-02-01T09:00:00.000Z BOOKED');
  });

  it('does not throw for unknown resources or rows absent from the index', () => {
    expect(() => upsertSearchRow(db, 'UnknownResource', 'x1')).not.toThrow();
    expect(() => removeSearchRow(db, 'Patient', 'si-never-existed')).not.toThrow();
  });

  it('no-ops for databases without the SearchIndex table or child patientId columns', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY); CREATE TABLE Appointment (id TEXT PRIMARY KEY);');
    expect(() => upsertSearchRow(db, 'Patient', 'p1')).not.toThrow();
    expect(() => removeSearchRow(db, 'Patient', 'p1')).not.toThrow();
    expect(() => removeSearchRowsByRecordIds(db, 'Patient', ['p1'])).not.toThrow();
    expect(() => rebuildSearchIndex(db)).not.toThrow();
    expect(() => refreshPatientChildSearchRows(db, 'p1')).not.toThrow();
    db.close();
  });
});
