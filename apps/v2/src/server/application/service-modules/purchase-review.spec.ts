import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { PurchaseReviewService } from './purchase-review';

describe('PurchaseReviewService', () => {
  let db: Database.Database;
  let dataDir: string;
  let service: PurchaseReviewService;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';
  const clinicId = 'clinic-v2-001';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-purchase-review-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    service = new PurchaseReviewService(db);
    context = {
      userId: 'user-admin-001',
      clinicId,
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(now),
    };
    db.prepare(
      `INSERT INTO Supplier (id, clinicId, createdAt, updatedAt, deletedAt, code, name)
       VALUES ('sup-001', ?, ?, ?, NULL, 'SUP-001', '供应商甲')`,
    ).run(clinicId, now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertOrder(id: string, overrides: Record<string, unknown> = {}): void {
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, receivedAt,
         reviewStatus, approvedById, approvedAt, rejectionReason, receivedById
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      overrides.clinicId ?? clinicId,
      overrides.createdAt ?? now,
      overrides.updatedAt ?? now,
      overrides.deletedAt ?? null,
      overrides.number ?? `PO-${id}`,
      overrides.supplierId ?? 'sup-001',
      overrides.totalAmount ?? 1000,
      overrides.status ?? 'PENDING',
      overrides.receivedAt ?? null,
      overrides.reviewStatus ?? 'PENDING',
      overrides.approvedById ?? null,
      overrides.approvedAt ?? null,
      overrides.rejectionReason ?? null,
      overrides.receivedById ?? null,
    );
  }

  function insertItem(id: string, orderId: string, overrides: Record<string, unknown> = {}): void {
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, orderId, itemId, name, spec, quantity, unitPrice, subtotal,
         clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      orderId,
      overrides.itemId ?? null,
      overrides.name ?? `明细-${id}`,
      overrides.spec ?? null,
      overrides.quantity ?? 2,
      overrides.unitPrice ?? 500,
      overrides.subtotal ?? 1000,
      overrides.clinicId ?? clinicId,
      overrides.createdAt ?? now,
      overrides.updatedAt ?? now,
      overrides.deletedAt ?? null,
    );
  }

  it('submit：PENDING → SUBMITTED 落库', () => {
    const id = 'po-submit-1';
    insertOrder(id);
    const result = service.submit(id, context);
    expect(result).toEqual({ id, reviewStatus: 'SUBMITTED' });
    const row = db.prepare('SELECT * FROM PurchaseOrder WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.reviewStatus).toBe('SUBMITTED');
    expect(row.approvedById).toBeNull();
    expect(row.approvedAt).toBeNull();
  });

  it('approve：SUBMITTED → APPROVED + approvedById/approvedAt 落库', () => {
    const id = 'po-approve-1';
    insertOrder(id, { reviewStatus: 'SUBMITTED' });
    const result = service.approve(id, context);
    expect(result).toEqual({ id, reviewStatus: 'APPROVED', approvedById: 'user-admin-001', approvedAt: now });
    const row = db.prepare('SELECT * FROM PurchaseOrder WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.reviewStatus).toBe('APPROVED');
    expect(row.approvedById).toBe('user-admin-001');
    expect(row.approvedAt).toBe(now);
    expect(row.rejectionReason).toBeNull();
  });

  it('approve：PENDING 直接通过 → ConflictError', () => {
    const id = 'po-approve-conflict';
    insertOrder(id);
    expect(() => service.approve(id, context)).toThrow(ConflictError);
  });

  it('approve：不存在的采购单 → NotFoundError', () => {
    expect(() => service.approve('po-missing', context)).toThrow(NotFoundError);
  });

  it('reject：SUBMITTED → REJECTED + rejectionReason 落库', () => {
    const id = 'po-reject-1';
    insertOrder(id, { reviewStatus: 'SUBMITTED' });
    const result = service.reject(id, { reason: '  单价与报价单不符  ' }, context);
    expect(result).toEqual({ id, reviewStatus: 'REJECTED', rejectionReason: '单价与报价单不符' });
    const row = db.prepare('SELECT * FROM PurchaseOrder WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.reviewStatus).toBe('REJECTED');
    expect(row.rejectionReason).toBe('单价与报价单不符');
    expect(row.approvedById).toBe('user-admin-001');
    expect(row.approvedAt).toBe(now);
  });

  it('reject：空原因 → ValidationError', () => {
    const id = 'po-reject-empty';
    insertOrder(id, { reviewStatus: 'SUBMITTED' });
    expect(() => service.reject(id, { reason: '   ' }, context)).toThrow(ValidationError);
  });

  it('reject：超长原因（>500）→ ValidationError', () => {
    const id = 'po-reject-long';
    insertOrder(id, { reviewStatus: 'SUBMITTED' });
    expect(() => service.reject(id, { reason: 'x'.repeat(501) }, context)).toThrow(ValidationError);
  });

  it('reject：PENDING 直接驳回 → ConflictError', () => {
    const id = 'po-reject-conflict';
    insertOrder(id);
    expect(() => service.reject(id, { reason: '原因' }, context)).toThrow(ConflictError);
  });

  it('reopen：REJECTED → SUBMITTED + rejectionReason 清空', () => {
    const id = 'po-reopen-1';
    insertOrder(id, { reviewStatus: 'REJECTED', rejectionReason: '价格过高' });
    const result = service.reopen(id, context);
    expect(result).toEqual({ id, reviewStatus: 'SUBMITTED' });
    const row = db.prepare('SELECT * FROM PurchaseOrder WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.reviewStatus).toBe('SUBMITTED');
    expect(row.rejectionReason).toBeNull();
  });

  it('reopen：APPROVED 重新提交 → ConflictError', () => {
    const id = 'po-reopen-conflict';
    insertOrder(id, { reviewStatus: 'APPROVED' });
    expect(() => service.reopen(id, context)).toThrow(ConflictError);
  });

  it('list：含审核列、supplierName、itemsCount，支持 reviewStatus 过滤', () => {
    const id = 'po-list-1';
    insertOrder(id, { totalAmount: 2400 });
    insertItem('po-list-1-item-1', id, { name: '树脂', quantity: 3, unitPrice: 800, subtotal: 2400 });
    insertItem('po-list-1-item-2', id, { name: '托槽', quantity: 1, unitPrice: 400, subtotal: 400 });

    const listed = service.list(context);
    expect(listed).toMatchObject({ page: 1, pageSize: 200, truncated: false });
    const row = listed.items.find((entry) => entry.id === id) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.reviewStatus).toBe('PENDING');
    expect(row.supplierName).toBe('供应商甲');
    expect(row.itemsCount).toBe(2);
    expect(row.totalAmount).toBe(2400);
    expect(row.status).toBe('PENDING');
    expect(row).toHaveProperty('approvedById');
    expect(row).toHaveProperty('approvedAt');
    expect(row).toHaveProperty('rejectionReason');
    expect(row).toHaveProperty('receivedById');

    const filtered = service.list(context, { reviewStatus: 'PENDING' });
    expect(filtered.items.some((entry) => entry.id === id)).toBe(true);
    expect(filtered.items.every((entry) => entry.reviewStatus === 'PENDING')).toBe(true);
    const approvedFiltered = service.list(context, { reviewStatus: 'APPROVED' });
    expect(approvedFiltered.items.some((entry) => entry.id === id)).toBe(false);
  });

  it('list：非法 reviewStatus 过滤值 → ValidationError', () => {
    expect(() => service.list(context, { reviewStatus: 'INVALID' })).toThrow(ValidationError);
  });

  it('stats：各状态计数与 pendingAmount 正确', () => {
    const before = service.stats(context) as Record<string, number>;
    insertOrder('po-stats-pending-1', { totalAmount: 1000 });
    insertOrder('po-stats-pending-2', { totalAmount: 3000 });
    insertOrder('po-stats-submitted-1', { reviewStatus: 'SUBMITTED', totalAmount: 2000 });
    insertOrder('po-stats-approved-1', { reviewStatus: 'APPROVED', totalAmount: 5000 });
    insertOrder('po-stats-rejected-1', { reviewStatus: 'REJECTED', totalAmount: 6000 });

    const stats = service.stats(context) as Record<string, number>;
    expect(stats.total).toBe(before.total + 5);
    expect(stats.pending).toBe(before.pending + 2);
    expect(stats.submitted).toBe(before.submitted + 1);
    expect(stats.approved).toBe(before.approved + 1);
    expect(stats.rejected).toBe(before.rejected + 1);
    // pendingAmount = PENDING + SUBMITTED 的 totalAmount 合计
    expect(stats.pendingAmount).toBe(before.pendingAmount + 1000 + 3000 + 2000);
  });

  it('租户隔离：他租户采购单 list 不可见、submit/approve 抛 NotFoundError', () => {
    const id = 'po-other-tenant';
    insertOrder(id, { clinicId: 'clinic-v2-999' });
    const rows = service.list(context);
    expect(rows.items.some((entry) => entry.id === id)).toBe(false);
    expect(() => service.submit(id, context)).toThrow(NotFoundError);
    expect(() => service.approve(id, context)).toThrow(NotFoundError);
  });

  it('rejects missing reasons, guards submit status, and tracks review writes', () => {
    insertOrder('po-missing-reason', { reviewStatus: 'SUBMITTED' });
    expect(() => service.reject('po-missing-reason', {} as never, context)).toThrow('驳回原因必填');

    insertOrder('po-submit-guard', { reviewStatus: 'SUBMITTED' });
    expect(() => service.submit('po-submit-guard', context)).toThrow('仅待提交的采购单可提交审核');

    insertOrder('po-write-tracking', { reviewStatus: 'SUBMITTED' });
    service.approve('po-write-tracking', context);
    const tracked = db.prepare(
      `SELECT COUNT(*) AS c FROM SyncChange WHERE tableName = 'PurchaseOrder' AND recordId = 'po-write-tracking'`,
    ).get() as { c: number };
    expect(Number(tracked.c)).toBeGreaterThanOrEqual(1);
  });
});
