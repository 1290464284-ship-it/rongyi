import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { MedicalRecordEditService } from './medical-record-edit';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';

describe('MedicalRecordEditService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-03T00:00:00.000Z';

  function insertRecord(
    id: string,
    overrides: Record<string, unknown> = {},
  ): void {
    const defaults: Record<string, unknown> = {
      id,
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      status: 'DRAFT',
      category: 'GENERAL',
      diagnosis: '原诊断',
      teethInvolved: '["11"]',
      images: '[]',
      isLocked: 1,
      lockedAt: '2026-08-01T00:00:00.000Z',
      lockedBy: 'user-admin-001',
    };
    const row = { ...defaults, ...overrides };
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(`INSERT INTO MedicalRecord (${columns.join(', ')}) VALUES (${placeholders})`)
      .run(...columns.map((column) => row[column]));
  }

  function getRecord(id: string): Record<string, unknown> {
    return db.prepare('SELECT * FROM MedicalRecord WHERE id = ?').get(id) as Record<string, unknown>;
  }

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-medical-record-edit-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace-edit',
      now: () => new Date('2026-08-03T08:00:00.000Z'),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('requests an edit and persists PENDING fields', () => {
    insertRecord('r-edit-1');

    const service = new MedicalRecordEditService(db);
    const result = service.requestEdit('r-edit-1', {
      reason: '  诊断需要修正  ',
      proposedContent: { diagnosis: '龋齿（深）', teethInvolved: ['11', '21'] },
    }, context);

    expect(result).toEqual({ id: 'r-edit-1', editRequestStatus: 'PENDING' });
    const row = getRecord('r-edit-1');
    expect(row.editRequestStatus).toBe('PENDING');
    expect(row.editRequestReason).toBe('诊断需要修正');
    expect(row.editRequestedById).toBe('user-admin-001');
    expect(row.editRequestedAt).toBe('2026-08-03T08:00:00.000Z');
    expect(JSON.parse(String(row.proposedContentJson))).toEqual({
      diagnosis: '龋齿（深）',
      teethInvolved: ['11', '21'],
    });
    // 申请阶段不合并、不解锁
    expect(row.diagnosis).toBe('原诊断');
    expect(row.isLocked).toBe(1);
  });

  it('rejects a second request while PENDING', () => {
    const service = new MedicalRecordEditService(db);
    expect(() => service.requestEdit('r-edit-1', {
      reason: '再改一次',
      proposedContent: { diagnosis: 'X' },
    }, context)).toThrow(ConflictError);
    expect(() => service.requestEdit('r-edit-1', {
      reason: '再改一次',
      proposedContent: { diagnosis: 'X' },
    }, context)).toThrow('该病历已有待审核的修改申请');
  });

  it('validates request input', () => {
    insertRecord('r-edit-valid');
    const service = new MedicalRecordEditService(db);
    expect(() => service.requestEdit('r-edit-valid', {
      reason: '   ',
      proposedContent: { diagnosis: 'X' },
    }, context)).toThrow(ValidationError);
    expect(() => service.requestEdit('r-edit-valid', {
      reason: '',
      proposedContent: { diagnosis: 'X' },
    }, context)).toThrow('修改原因不能为空');
    expect(() => service.requestEdit('r-edit-valid', {
      reason: '原因',
      proposedContent: [] as unknown as Record<string, unknown>,
    }, context)).toThrow(ValidationError);
    expect(() => service.requestEdit('r-edit-valid', {
      reason: '原因',
      proposedContent: {},
    }, context)).toThrow(ValidationError);
    expect(() => service.requestEdit('r-edit-valid', {
      reason: '原因',
      proposedContent: null as unknown as Record<string, unknown>,
    }, context)).toThrow(ValidationError);
    expect(() => service.requestEdit('missing-record', {
      reason: '原因',
      proposedContent: { diagnosis: 'X' },
    }, context)).toThrow(NotFoundError);
    expect(() => service.requestEdit('missing-record', {
      reason: '原因',
      proposedContent: { diagnosis: 'X' },
    }, context)).toThrow('MedicalRecord not found');
  });

  it('honors tenant scoping for lookups', () => {
    insertRecord('r-edit-other-clinic', { clinicId: 'clinic-other' });
    const service = new MedicalRecordEditService(db);
    expect(() => service.requestEdit('r-edit-other-clinic', {
      reason: '原因',
      proposedContent: { diagnosis: 'X' },
    }, context)).toThrow(NotFoundError);
    const otherContext = { ...context, clinicId: 'clinic-other' };
    const result = service.requestEdit('r-edit-other-clinic', {
      reason: '原因',
      proposedContent: { diagnosis: 'X' },
    }, otherContext);
    expect(result.editRequestStatus).toBe('PENDING');
  });

  it('approves an edit: merges whitelisted fields, unlocks, and records the review', () => {
    insertRecord('r-edit-approve', {
      diagnosis: '原诊断',
      isLocked: 1,
      lockedAt: '2026-08-01T00:00:00.000Z',
      lockedBy: 'user-admin-001',
    });
    const service = new MedicalRecordEditService(db);
    service.requestEdit('r-edit-approve', {
      reason: '更新诊断',
      proposedContent: {
        diagnosis: '新诊断',
        status: 'SUBMITTED',
        teethInvolved: ['12', '22'],
        images: ['https://img/x.png'],
      },
    }, context);

    const result = service.review('r-edit-approve', { approve: true, reviewNote: '同意修改' }, context);
    expect(result).toEqual({ id: 'r-edit-approve', editRequestStatus: 'APPROVED', applied: true });

    const row = getRecord('r-edit-approve');
    expect(row.diagnosis).toBe('新诊断');
    expect(row.status).toBe('SUBMITTED');
    expect(JSON.parse(String(row.teethInvolved))).toEqual(['12', '22']);
    expect(JSON.parse(String(row.images))).toEqual(['https://img/x.png']);
    expect(row.isLocked).toBe(0);
    expect(row.lockedAt).toBeNull();
    expect(row.lockedBy).toBeNull();
    expect(row.editRequestStatus).toBe('APPROVED');
    expect(row.reviewedById).toBe('user-admin-001');
    expect(row.reviewedAt).toBe('2026-08-03T08:00:00.000Z');
    expect(row.reviewNote).toBe('同意修改');
    // 未出现在 proposedContent 中的字段保持不变
    expect(row.category).toBe('GENERAL');
  });

  it('only merges whitelisted keys even when proposed content targets other columns', () => {
    insertRecord('r-edit-whitelist', { diagnosis: '原诊断', isLocked: 1 });
    const service = new MedicalRecordEditService(db);
    service.requestEdit('r-edit-whitelist', {
      reason: '白名单测试',
      proposedContent: {
        diagnosis: '白名单后诊断',
        isLocked: 1,
        lockedBy: 'evil-user',
        editRequestStatus: 'REJECTED',
        id: 'r-edit-whitelist',
      },
    }, context);
    service.review('r-edit-whitelist', { approve: true }, context);

    const row = getRecord('r-edit-whitelist');
    expect(row.diagnosis).toBe('白名单后诊断');
    // 白名单外列不得被合并：解锁逻辑仍然生效，锁定信息被清空
    expect(row.isLocked).toBe(0);
    expect(row.lockedBy).toBeNull();
    expect(row.editRequestStatus).toBe('APPROVED');
    expect(row.id).toBe('r-edit-whitelist');
  });

  it('rejects edits whose array fields are not arrays', () => {
    insertRecord('r-edit-bad-array');
    const service = new MedicalRecordEditService(db);
    service.requestEdit('r-edit-bad-array', {
      reason: '坏数组',
      proposedContent: { teethInvolved: '11,21' },
    }, context);
    expect(() => service.review('r-edit-bad-array', { approve: true }, context))
      .toThrow(ValidationError);
    expect(() => service.review('r-edit-bad-array', { approve: true }, context))
      .toThrow('teethInvolved 必须为数组');
  });

  it('rejects approval when proposedContentJson is invalid JSON', () => {
    insertRecord('r-edit-bad-json', {
      editRequestStatus: 'PENDING',
      proposedContentJson: 'not-json{{{',
    });
    const service = new MedicalRecordEditService(db);
    expect(() => service.review('r-edit-bad-json', { approve: true }, context))
      .toThrow(ValidationError);
  });

  it('rejects an edit: keeps content locked and records the rejection', () => {
    insertRecord('r-edit-reject', {
      diagnosis: '保持原样',
      isLocked: 1,
      lockedAt: '2026-08-01T00:00:00.000Z',
      lockedBy: 'user-admin-001',
    });
    const service = new MedicalRecordEditService(db);
    service.requestEdit('r-edit-reject', {
      reason: '建议改诊断',
      proposedContent: { diagnosis: '不应合并' },
    }, context);

    const result = service.review('r-edit-reject', { approve: false, reviewNote: '证据不足' }, context);
    expect(result).toEqual({ id: 'r-edit-reject', editRequestStatus: 'REJECTED', applied: false });

    const row = getRecord('r-edit-reject');
    expect(row.editRequestStatus).toBe('REJECTED');
    expect(row.diagnosis).toBe('保持原样');
    expect(row.isLocked).toBe(1);
    expect(row.lockedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(row.lockedBy).toBe('user-admin-001');
    expect(row.reviewedById).toBe('user-admin-001');
    expect(row.reviewNote).toBe('证据不足');
  });

  it('allows re-requesting after rejection and rejects review of non-PENDING records', () => {
    const service = new MedicalRecordEditService(db);
    // REJECTED 后可再次申请
    const result = service.requestEdit('r-edit-reject', {
      reason: '补充证据后再次申请',
      proposedContent: { diagnosis: '再次申请' },
    }, context);
    expect(result.editRequestStatus).toBe('PENDING');
    // 非 PENDING（这里已重新变为 PENDING；先审核掉）
    service.review('r-edit-reject', { approve: false }, context);
    // APPROVED 状态不可再审核
    expect(() => service.review('r-edit-approve', { approve: false }, context))
      .toThrow(ConflictError);
    expect(() => service.review('r-edit-approve', { approve: false }, context))
      .toThrow('该病历没有待审核的修改申请');
  });

  it('returns only PENDING records with parsed proposed content', () => {
    // r-edit-1 自首个用例起一直处于 PENDING，先审核掉避免干扰
    const service = new MedicalRecordEditService(db);
    service.review('r-edit-1', { approve: false }, context);
    insertRecord('r-edit-pending-1', {
      editRequestStatus: 'PENDING',
      proposedContentJson: JSON.stringify({ diagnosis: '待审诊断' }),
    });
    insertRecord('r-edit-pending-2', {
      editRequestStatus: 'PENDING',
      proposedContentJson: 'broken-json',
    });
    const pending = service.pending(context);
    const ids = pending.map((row) => row.id);
    expect(ids).toContain('r-edit-pending-1');
    expect(ids).toContain('r-edit-pending-2');
    // 已 APPROVED/REJECTED/NONE 的行不返回
    expect(ids).not.toContain('r-edit-approve');
    expect(ids).not.toContain('r-edit-reject');
    expect(ids).not.toContain('r-edit-1');
    const parsed = pending.find((row) => row.id === 'r-edit-pending-1');
    expect(parsed?.proposedContent).toEqual({ diagnosis: '待审诊断' });
    const broken = pending.find((row) => row.id === 'r-edit-pending-2');
    expect(broken?.proposedContent).toBeNull();
  });
});
