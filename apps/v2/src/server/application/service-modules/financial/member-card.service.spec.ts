// MemberCardService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
// 注：会员卡与收费单的联动（卡退款、回滚）测试保留在聚合文件（集成层）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../../infrastructure/database';
import { runMigrations } from '../../../infrastructure/migrations';
import { MemberCardService } from './member-card.service';
import { MAX_MONEY_CENTS } from '../common';
import type { MemberCardRepository } from '../../ports';
import type { AppContext } from '../../../../domain/contracts';

describe('MemberCardService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-member-card-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('recharges and consumes from a member card', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-TEST', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-test', context.clinicId, now, now, 'patient-demo-001');
    const service = new MemberCardService(db);
    await service.recharge('card-test', 1000, context);
    await service.consume('card-test', 300, context);
    await service.addPoints('card-test', 20, context);
    const card = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get('card-test') as Record<string, unknown>;
    expect(Number(card.balance)).toBe(700);
    expect(Number(card.points)).toBe(20);
  });

  it('rejects member card operations when the card is not active', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'INACTIVE-CARD-P', 'Inactive Card Patient', 'UNKNOWN', '13300000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-inactive-card', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-INACTIVE-TEST', 100, 100, 0, 'INACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-inactive-test', context.clinicId, now, now, 'patient-inactive-card');
    const service = new MemberCardService(db);
    await expect(service.recharge('card-inactive-test', 10, context)).rejects.toThrow('not active');
    await expect(service.consume('card-inactive-test', 10, context)).rejects.toThrow('not active');
    await expect(service.addPoints('card-inactive-test', 10, context)).rejects.toThrow('not active');
  });

  it('allows the same member card number in different clinics', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'DUP-CARD-B', 'Duplicate Card Patient B', 'UNKNOWN', '13300000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-dup-card-b', 'clinic-v2-002', now, now);
    const service = new MemberCardService(db);
    service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-DUP-GLOBAL',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    const second = service.create({
      patientId: 'patient-dup-card-b',
      cardNo: 'CARD-DUP-GLOBAL',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, { ...context, clinicId: 'clinic-v2-002' });
    expect(second.id).toBeDefined();
  });

  it('maps member-card create unique races to conflict errors', () => {
    const repo = {
      create: () => { throw new Error('UNIQUE constraint failed: MemberCard.cardNo'); },
    } as unknown as MemberCardRepository;
    const service = new MemberCardService(db, repo);
    expect(() => service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-CATCH-UNIQUE',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context)).toThrow('already exists');
  });

  it('rethrows non-unique member-card create failures', () => {
    const repo = {
      create: () => { throw new Error('database down'); },
    } as unknown as MemberCardRepository;
    const service = new MemberCardService(db, repo);
    expect(() => service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-CATCH-DOWN',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context)).toThrow('database down');
  });

  it('rejects invalid recharge, consume, and points values including MAX guards', async () => {
    const insertNow = new Date().toISOString();
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'CARD-EDGE-2', 100, 100, 0, 'ACTIVE', 10, 10, 'NORMAL')`,
    ).run('card-edge-2', context.clinicId, insertNow, insertNow);
    const cards = new MemberCardService(db);
    await expect(cards.recharge('card-edge-2', 0, context)).rejects.toThrow('Recharge');
    await expect(cards.consume('card-edge-2', 0, context)).rejects.toThrow('Consume');
    await expect(cards.consume('card-edge-2', 101, context)).rejects.toThrow('Insufficient member card');
    await expect(cards.addPoints('card-edge-2', -11, context)).rejects.toThrow('Insufficient points');
    await expect(cards.addPoints('card-edge-2', 0, context)).rejects.toThrow('non-zero integer');
    await expect(cards.addPoints('card-edge-2', 1.5, context)).rejects.toThrow('non-zero integer');
    await cards.addPoints('card-edge-2', -5, context);
    await expect(cards.recharge('missing-card', 1, context)).rejects.toThrow('Member card not found');
    await cards.recharge('card-edge-2', 10, { ...context, clinicId: null });
    await cards.consume('card-edge-2', 10, { ...context, clinicId: null });
    await cards.addPoints('card-edge-2', 5, { ...context, clinicId: null });
    // MAX 上限守卫：金额/积分在数值边界的拒绝路径
    await expect(cards.recharge('card-edge-2', MAX_MONEY_CENTS + 1, context)).rejects.toThrow('exceeds the member card balance limit');
    await expect(cards.recharge('card-edge-2', MAX_MONEY_CENTS, context)).rejects.toThrow('exceeds the member card balance limit');
    await expect(cards.consume('card-edge-2', MAX_MONEY_CENTS + 1, context)).rejects.toThrow('exceeds the member card limit');
    await expect(cards.addPoints('card-edge-2', 1_000_000_000_001, context)).rejects.toThrow('exceeds the member card points limit');
    await expect(cards.addPoints('card-edge-2', 999_999_999_992, context)).rejects.toThrow('exceeds the member card points limit');
  });
});
