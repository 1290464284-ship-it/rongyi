import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { FollowUpExecutionService } from './follow-up-execution';

type ExecuteInput = Parameters<FollowUpExecutionService['execute']>[1];

describe('FollowUpExecutionService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-follow-up-execution-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date('2026-08-05T10:00:00.000Z'),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertFollowUp(
    id: string,
    overrides: {
      status?: string;
      executionStatus?: string | null;
      patientRating?: number | null;
      clinicId?: string;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, status, executionStatus, patientRating
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      overrides.clinicId ?? 'clinic-v2-001',
      now,
      now,
      'patient-demo-001',
      '2026-08-05',
      overrides.status ?? 'PENDING',
      overrides.executionStatus === undefined ? 'PENDING' : overrides.executionStatus,
      overrides.patientRating === undefined ? null : overrides.patientRating,
    );
  }

  it('records a DONE execution and persists all structured fields', () => {
    insertFollowUp('fu-done');
    const service = new FollowUpExecutionService(db);
    const result = service.execute('fu-done', {
      executionStatus: 'DONE',
      patientRating: 9,
      painLevel: 2,
      feedback: '患者恢复良好',
      contactedAt: '2026-08-05T09:30:00.000Z',
      nextPlanDate: '2026-09-05',
    }, context);
    expect(result).toEqual({
      id: 'fu-done',
      executionStatus: 'DONE',
      patientRating: 9,
      painLevel: 2,
      nextPlanDate: '2026-09-05',
    });

    const row = db.prepare('SELECT * FROM FollowUp WHERE id = ?').get('fu-done') as Record<string, unknown>;
    expect(row.executionStatus).toBe('DONE');
    expect(row.patientRating).toBe(9);
    expect(row.painLevel).toBe(2);
    expect(row.feedback).toBe('患者恢复良好');
    expect(row.contactedAt).toBe('2026-08-05T09:30:00.000Z');
    expect(row.nextPlanDate).toBe('2026-09-05');
    expect(row.status).toBe('COMPLETED');
    expect(row.completedAt).toBe(now);
    expect(row.updatedAt).toBe(now);
  });

  it('rejects re-execution with a conflict error', () => {
    insertFollowUp('fu-conflict', { executionStatus: 'DONE' });
    const service = new FollowUpExecutionService(db);
    expect(() => service.execute('fu-conflict', {
      executionStatus: 'DONE',
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context)).toThrow(ConflictError);
    expect(() => service.execute('fu-conflict', { executionStatus: 'SKIPPED' }, context)).toThrow('该随访已完成执行');
  });

  it('requires a valid executionStatus of DONE or SKIPPED', () => {
    insertFollowUp('fu-status');
    const service = new FollowUpExecutionService(db);
    expect(() => service.execute('fu-status', {} as ExecuteInput, context)).toThrow(ValidationError);
    expect(() => service.execute('fu-status', { executionStatus: '' }, context)).toThrow(ValidationError);
    expect(() => service.execute('fu-status', { executionStatus: 'UNKNOWN' }, context)).toThrow(ValidationError);
  });

  it('validates patientRating and painLevel as integers within 0-10', () => {
    insertFollowUp('fu-rating');
    const service = new FollowUpExecutionService(db);
    expect(() => service.execute('fu-rating', {
      executionStatus: 'DONE',
      patientRating: 11,
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context)).toThrow('评分必须在 0-10 之间');
    expect(() => service.execute('fu-rating', {
      executionStatus: 'DONE',
      patientRating: -1,
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context)).toThrow(ValidationError);
    expect(() => service.execute('fu-rating', {
      executionStatus: 'DONE',
      patientRating: 3.5,
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context)).toThrow('评分必须在 0-10 之间');
    expect(() => service.execute('fu-rating', {
      executionStatus: 'DONE',
      painLevel: 12,
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context)).toThrow('评分必须在 0-10 之间');

    const result = service.execute('fu-rating', {
      executionStatus: 'DONE',
      patientRating: 0,
      painLevel: 10,
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context);
    expect(result.patientRating).toBe(0);
    expect(result.painLevel).toBe(10);
  });

  it('requires contactedAt for DONE but not for SKIPPED', () => {
    insertFollowUp('fu-contact');
    const service = new FollowUpExecutionService(db);
    expect(() => service.execute('fu-contact', { executionStatus: 'DONE' }, context)).toThrow('请填写联系时间');
    expect(() => service.execute('fu-contact', { executionStatus: 'DONE', contactedAt: '   ' }, context)).toThrow('请填写联系时间');

    const skipped = service.execute('fu-contact', { executionStatus: 'SKIPPED', feedback: '   ' }, context);
    expect(skipped.executionStatus).toBe('SKIPPED');
    const row = db.prepare('SELECT * FROM FollowUp WHERE id = ?').get('fu-contact') as Record<string, unknown>;
    expect(row.status).toBe('COMPLETED');
    expect(row.contactedAt).toBeNull();
    expect(row.feedback).toBeNull();
  });

  it('treats NULL executionStatus as PENDING and enforces tenant scope', () => {
    insertFollowUp('fu-null-exec', { executionStatus: null });
    insertFollowUp('fu-other-clinic', { clinicId: 'clinic-other' });
    const service = new FollowUpExecutionService(db);
    const result = service.execute('fu-null-exec', {
      executionStatus: 'DONE',
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context);
    expect(result.executionStatus).toBe('DONE');
    expect(() => service.execute('fu-other-clinic', {
      executionStatus: 'DONE',
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context)).toThrow(NotFoundError);
  });

  it('throws NotFoundError for a missing follow-up', () => {
    const service = new FollowUpExecutionService(db);
    expect(() => service.execute('missing-fu', {
      executionStatus: 'DONE',
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context)).toThrow(NotFoundError);
  });

  it('throws NotFoundError for a soft-deleted follow-up', () => {
    insertFollowUp('fu-deleted');
    db.prepare('UPDATE FollowUp SET deletedAt = ?, updatedAt = ? WHERE id = ?').run(now, now, 'fu-deleted');
    const service = new FollowUpExecutionService(db);
    expect(() => service.execute('fu-deleted', {
      executionStatus: 'DONE',
      contactedAt: '2026-08-05T09:30:00.000Z',
    }, context)).toThrow(NotFoundError);
  });

  it('computes NPS groups, average and breakdown from rated follow-ups', () => {
    db.prepare('DELETE FROM FollowUp WHERE patientRating IS NOT NULL').run();
    const ratings: Array<[string, number]> = [['nps-9', 9], ['nps-10', 10], ['nps-7', 7], ['nps-5', 5], ['nps-3', 3]];
    for (const [id, rating] of ratings) insertFollowUp(id, { patientRating: rating });
    insertFollowUp('nps-other', { patientRating: 10, clinicId: 'clinic-other' });

    const service = new FollowUpExecutionService(db);
    const result = service.nps(context);
    expect(result.total).toBe(5);
    expect(result.promoters).toBe(2);
    expect(result.passives).toBe(1);
    expect(result.detractors).toBe(2);
    expect(result.nps).toBe(0);
    expect(result.average).toBe(6.8);
    expect(result.breakdown).toEqual([
      { rating: 3, count: 1 },
      { rating: 5, count: 1 },
      { rating: 7, count: 1 },
      { rating: 9, count: 1 },
      { rating: 10, count: 1 },
    ]);
  });

  it('returns zeroed NPS stats when no ratings exist', () => {
    db.prepare('DELETE FROM FollowUp WHERE patientRating IS NOT NULL').run();
    const service = new FollowUpExecutionService(db);
    expect(service.nps(context)).toEqual({
      total: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      nps: 0,
      average: 0,
      breakdown: [],
    });
  });
});
