import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrations121to130 } from './v121-130';
import { migrations153 } from './v153-153';
import { migrations155 } from './v155-155';
import { migrations156 } from './v156-156';
import { migrations158 } from './v158-158';

describe('migration defensive branches', () => {
  function createMinimalRebuildTargets(db: Database.Database): void {
    for (const table of [
      'Patient',
      'Visit',
      'ProcessingFactory',
      'User',
      'Charge',
      'TreatmentPlan',
      'Prescription',
      'Supplier',
      'InventoryItem',
      'MemberCard',
      'ProcessingOrder',
      'TreatmentPlanItem',
      'PrescriptionItem',
      'ProcessingOrderItem',
      'InventoryReplenishmentSuggestion',
    ]) {
      db.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY)`);
    }
  }

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

  it('migration 123 skips when User has no clinicId column', () => {
    const db = new Database(':memory:');
    db.exec(
      'CREATE TABLE Clinic (id TEXT PRIMARY KEY, createdAt TEXT); CREATE TABLE UserClinic (userId TEXT, clinicId TEXT); CREATE TABLE User (id TEXT PRIMARY KEY);',
    );
    db.prepare('INSERT INTO Clinic (id, createdAt) VALUES (?, ?)').run('clinic-1', '2026-01-01T00:00:00.000Z');
    const migration = migrations121to130.find((entry) => entry.version === 123);
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

  it('migration 158 rebuilds minimal empty tables and skips missing columns', () => {
    const db = new Database(':memory:');
    createMinimalRebuildTargets(db);
    expect(() => migrations158[0].up(db)).not.toThrow();
    const columns = (db.prepare('PRAGMA table_info("MemberCard")').all() as Array<{ name: string }>)
      .map((entry) => entry.name);
    expect(columns).toContain('patientId');
    expect(columns).toContain('status');
    db.close();
  });

  it('migration 158 backfills legacy ChargeCombo semantic columns', () => {
    const db = new Database(':memory:');
    createMinimalRebuildTargets(db);
    db.exec(`
      CREATE TABLE ChargeCombo (id TEXT PRIMARY KEY, isPublic INTEGER, type TEXT, active INTEGER, ownerId TEXT, creatorId TEXT);
      CREATE TABLE ChargeComboItem (id TEXT PRIMARY KEY, catalogId TEXT, treatmentCatalogId TEXT, name TEXT, itemName TEXT, category TEXT);
    `);
    db.prepare('INSERT INTO ChargeCombo (id, isPublic, type, active, ownerId, creatorId) VALUES (?, ?, NULL, NULL, NULL, ?)')
      .run('combo-1', 1, 'user-1');
    db.prepare('INSERT INTO ChargeCombo (id, isPublic) VALUES (?, ?)').run('combo-2', 0);
    db.prepare('INSERT INTO ChargeComboItem (id, catalogId, treatmentCatalogId, name, itemName, category) VALUES (?, NULL, ?, NULL, ?, NULL)')
      .run('item-1', 'catalog-1', '种植');
    db.prepare('INSERT INTO ChargeComboItem (id) VALUES (?)').run('item-2');

    expect(() => migrations158[0].up(db)).not.toThrow();

    const combo1 = db.prepare('SELECT type, active, ownerId FROM ChargeCombo WHERE id = ?').get('combo-1') as Record<string, unknown>;
    expect(combo1).toEqual({ type: 'PUBLIC', active: 1, ownerId: 'user-1' });
    const combo2 = db.prepare('SELECT type, active FROM ChargeCombo WHERE id = ?').get('combo-2') as Record<string, unknown>;
    expect(combo2).toEqual({ type: 'PRIVATE', active: 0 });
    const item1 = db.prepare('SELECT catalogId, name, category FROM ChargeComboItem WHERE id = ?').get('item-1') as Record<string, unknown>;
    expect(item1).toEqual({ catalogId: 'catalog-1', name: '种植', category: 'SERVICE' });
    const item2 = db.prepare('SELECT name, category FROM ChargeComboItem WHERE id = ?').get('item-2') as Record<string, unknown>;
    expect(item2).toEqual({ name: '', category: 'SERVICE' });
    db.close();
  });
});
