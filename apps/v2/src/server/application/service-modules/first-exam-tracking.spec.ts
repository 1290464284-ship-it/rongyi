import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { FirstExamTrackingService } from './first-exam-tracking';

describe('FirstExamTrackingService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-first-exam-tracking-'));
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

  function insertFirstExam(
    id: string,
    followUpStatus: string | null,
    nextFollowUpAt: string | null,
    clinicId = 'clinic-v2-001',
  ): void {
    db.prepare(
      `INSERT INTO FirstExam (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, status, followUpStatus, nextFollowUpAt
       ) VALUES (?, ?, ?, ?, NULL, ?, 'DRAFT', ?, ?)`,
    ).run(id, clinicId, now, now, 'patient-demo-001', followUpStatus, nextFollowUpAt);
  }

  it('reports tracking overview counts with NULL coalesced into NONE and tenant filtering', () => {
    insertFirstExam('ov-pending', 'PENDING', '2026-08-05T09:00:00.000Z');
    insertFirstExam('ov-should', 'HORIZONTAL_SHOULD', '2026-08-06T09:00:00.000Z');
    insertFirstExam('ov-lost', 'LOST', null);
    insertFirstExam('ov-null', null, null);
    insertFirstExam('ov-other-clinic', 'PENDING', '2026-08-05T09:00:00.000Z', 'clinic-other');

    const service = new FirstExamTrackingService(db);
    const overview = service.overview(context);
    expect(overview).toEqual({
      NONE: 1,
      PENDING: 1,
      HORIZONTAL_SHOULD: 1,
      HORIZONTAL_DONE: 0,
      LOST: 1,
      total: 4,
      dueToday: 1,
    });
  });

  it('updates tracking fields on the row and persists them to the database', () => {
    insertFirstExam('upd-1', 'NONE', null);
    const service = new FirstExamTrackingService(db);
    const result = service.updateTracking('upd-1', {
      followUpStatus: 'LOST',
      lossReasonType: 'COST',
      lossReason: '患者认为价格过高',
      trackingNote: '电话回访确认流失',
    }, context);
    expect(result).toEqual({ id: 'upd-1', followUpStatus: 'LOST', nextFollowUpAt: null });

    const row = db.prepare('SELECT * FROM FirstExam WHERE id = ?').get('upd-1') as Record<string, unknown>;
    expect(row.followUpStatus).toBe('LOST');
    expect(row.lossReasonType).toBe('COST');
    expect(row.lossReason).toBe('患者认为价格过高');
    expect(row.trackingNote).toBe('电话回访确认流失');
    expect(row.nextFollowUpAt).toBeNull();
  });

  it('stores nextFollowUpAt for pending follow-ups and clears optional fields otherwise', () => {
    insertFirstExam('upd-2', 'LOST', null);
    const service = new FirstExamTrackingService(db);
    const result = service.updateTracking('upd-2', {
      followUpStatus: 'PENDING',
      nextFollowUpAt: '2026-08-12',
    }, context);
    expect(result).toEqual({ id: 'upd-2', followUpStatus: 'PENDING', nextFollowUpAt: '2026-08-12' });

    const row = db.prepare('SELECT * FROM FirstExam WHERE id = ?').get('upd-2') as Record<string, unknown>;
    expect(row.followUpStatus).toBe('PENDING');
    expect(row.nextFollowUpAt).toBe('2026-08-12');
    expect(row.lossReasonType).toBeNull();
    expect(row.lossReason).toBeNull();
  });

  it('rejects invalid followUpStatus, missing loss reason, and missing next follow-up date', () => {
    insertFirstExam('upd-3', 'NONE', null);
    const service = new FirstExamTrackingService(db);
    expect(() => service.updateTracking('upd-3', { followUpStatus: 'UNKNOWN' }, context)).toThrow(ValidationError);
    expect(() => service.updateTracking('upd-3', { followUpStatus: '' }, context)).toThrow(ValidationError);
    expect(() => service.updateTracking('upd-3', { followUpStatus: 'LOST' }, context)).toThrow('流失原因类型不能为空');
    expect(() => service.updateTracking('upd-3', { followUpStatus: 'PENDING' }, context)).toThrow('请填写下次跟进日期');
    expect(() => service.updateTracking('upd-3', { followUpStatus: 'HORIZONTAL_SHOULD' }, context)).toThrow('请填写下次跟进日期');
  });

  it('throws NotFoundError for a missing exam', () => {
    const service = new FirstExamTrackingService(db);
    expect(() => service.updateTracking('missing-exam', { followUpStatus: 'NONE' }, context)).toThrow(NotFoundError);
  });
});
