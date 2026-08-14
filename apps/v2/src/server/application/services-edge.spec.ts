// L-04 索引：本文件是早期聚合的"边缘/异常分支"测试（约 1898 行），覆盖
// 多诊所、医生、采购/加工、审计、预约、收费、库存、随访、备份、
// 统计/打印/搜索、同步、租户隔离、HR、会员卡、处方、头颅测量、
// 进度、导入、债务、通知、满意度等 20+ 服务的边界路径。
// 各服务的常规路径已有独立 spec（src/server/application/service-modules/
// *.spec.ts）；本文件的断言可逐步迁移到对应模块 spec 后删除，迁移前保持聚合。
// auth 相关边界测试已迁入 service-modules/auth.service.spec.ts（round 20）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import { rebuildSearchIndex } from '../infrastructure/search-index';
import { recordSyncChange } from '../infrastructure/sync-change';
import { MAX_MONEY_CENTS } from './service-modules/common';
import {
  AlertService,
  AppointmentService,
  BulkImportService,
  CephalometricService,
  ChargeService,
  DebtService,
  HrService,
  InventoryService,
  MemberCardService,
  NotificationService,
  PatientRiskService,
  PrescriptionSafetyService,
  PrintService,
  ProcessingOrderService,
  PurchaseOrderService,
  SatisfactionService,
  SearchService,
  StatsService,
  SyncService,
  TreatmentProgressService,
} from './services';
import {
  AnalyticsService,
  ChargeAssistantService,
  ClinicalWorkflowService,
  PrintTemplateService,
  ReplenishmentService,
  WechatService,
} from './workflow-services';
import { ProcessingSettleService } from './service-modules/processing-settle';
import { PurchaseReviewService } from './service-modules/purchase-review';
import type { AppContext } from '../../domain/contracts';

describe('service edge coverage', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  let nullContext: AppContext;
  const now = '2026-08-04T00:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-service-edge-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    };
    nullContext = {
      userId: 'user-admin-001',
      clinicId: null,
      role: 'BOSS',
      traceId: 'trace-null',
      now: () => new Date(),
    };
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates purchase and processing orders with validation', async () => {
    const purchase = new PurchaseOrderService(db);
    const createdPo = await purchase.create({
      number: 'PO-CREATE',
      items: [{ itemId: 'inventory-demo-001', name: 'Dental Material', quantity: 2, unitPrice: 100 }],
    }, context);
    expect(createdPo).toMatchObject({ status: 'PENDING', totalAmount: 200 });
    expect(db.prepare(
      `SELECT 1 FROM SyncChange WHERE tableName = 'PurchaseOrder' AND recordId = ? AND operation = 'INSERT' AND clinicId = ?`,
    ).get(String(createdPo.id), context.clinicId)).toBeDefined();
    // 全新库回归：服务建单必须显式落 reviewStatus='PENDING'（不能依赖 DB 列默认值，
    // 资源注册表建表不带 DEFAULT，迁移 addColumns 会因列已存在而跳过）。
    const poRow = db.prepare('SELECT reviewStatus FROM PurchaseOrder WHERE id = ?').get(String(createdPo.id)) as { reviewStatus: string | null };
    expect(poRow.reviewStatus).toBe('PENDING');
    const review = new PurchaseReviewService(db);
    expect(review.submit(String(createdPo.id), context).reviewStatus).toBe('SUBMITTED');
    expect(review.approve(String(createdPo.id), context).reviewStatus).toBe('APPROVED');
    expect(db.prepare(
      `SELECT 1 FROM SyncChange WHERE tableName = 'PurchaseOrder' AND recordId = ? AND operation = 'UPDATE' AND clinicId = ?`,
    ).get(String(createdPo.id), context.clinicId)).toBeDefined();
    expect(purchase.items(String(createdPo.id), context)).toHaveLength(1);

    await expect(purchase.create({ items: [{ name: 'X', quantity: 1, unitPrice: 1 }] } as unknown as Parameters<typeof purchase.create>[0], context)).rejects.toThrow('number is required');
    await expect(purchase.create({
      number: 'PO-BAD-NAME',
      items: [{ name: undefined as unknown as string, quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Each purchase item requires');
    await expect(purchase.create({ number: 'PO-BAD', items: [] }, context)).rejects.toThrow('1 to 500');
    await expect(purchase.create({
      number: 'PO-BAD-2',
      items: [{ name: 'X', quantity: 0, unitPrice: 1 }],
    }, context)).rejects.toThrow('positive quantity');
    await expect(purchase.create({
      number: 'PO-BAD-3',
      items: [{ itemId: 'missing-item', name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Inventory item not found');
    // P0-4：单价必须是整数分，小数单价会导致 unitPrice 取整与 subtotal 不一致的坏账。
    await expect(purchase.create({
      number: 'PO-BAD-4',
      items: [{ name: 'X', quantity: 1, unitPrice: 10.5 }],
    }, context)).rejects.toThrow('unit price');
    const nullPurchase = await purchase.create({
      number: 'PO-NULL-CLINIC',
      items: [{ name: 'Null Clinic Item', quantity: 1, unitPrice: 1 }],
    }, nullContext);
    expect(nullPurchase.status).toBe('PENDING');

    const processing = new ProcessingOrderService(db);
    const createdProc = await processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-CREATE',
      totalFee: 500,
      items: [{ name: 'Crown', quantity: 1, unitPrice: 500 }],
    }, context);
    expect(createdProc).toMatchObject({ status: 'DRAFT' });
    // 全新库回归：建单必须显式落 settleStatus='UNSETTLED'，否则对账统计漏计新单。
    const procRow = db.prepare('SELECT settleStatus FROM ProcessingOrder WHERE id = ?').get(String(createdProc.id)) as { settleStatus: string | null };
    expect(procRow.settleStatus).toBe('UNSETTLED');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-ITEM',
      totalFee: 1,
      items: [{ name: 'X', quantity: 0, unitPrice: 1 }],
    }, context)).rejects.toThrow('positive quantity');
    const arrayProc = await processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-ARRAY',
      totalFee: 100,
      teethNumbers: ['11'],
      items: [{ name: 'Bracket', quantity: 1, unitPrice: 100 }],
    }, nullContext);
    expect(arrayProc.status).toBe('DRAFT');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      totalFee: 1,
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    } as unknown as Parameters<typeof processing.create>[0], context)).rejects.toThrow('number is required');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-NAME',
      totalFee: 1,
      items: [{ name: undefined as unknown as string, quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Each processing item requires');
    await expect(processing.create({
      patientId: 'missing-patient',
      number: 'PROC-BAD',
      totalFee: 1,
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Patient not found');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-2',
      totalFee: -1,
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('non-negative');
    // 加工单 totalFee 必须是整数分：小数金额不再静默取整（与 unitPrice 校验一致）
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-FEE-DECIMAL',
      totalFee: 12.5,
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('non-negative');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-3',
      totalFee: 1,
      items: [],
    }, context)).rejects.toThrow('1 to 500');
    // P0-4：加工项单价必须是整数分，小数单价会导致 subtotal 坏账。
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-4',
      totalFee: 1,
      items: [{ name: 'X', quantity: 1, unitPrice: 10.5 }],
    }, context)).rejects.toThrow('unit price');
    // 加工单结算全链路（全新库）：COMPLETED 后结算 → 对账统计计入已结算。
    const procId = String(createdProc.id);
    processing.transition(procId, 'SENT', context);
    processing.transition(procId, 'IN_PROGRESS', context);
    processing.transition(procId, 'COMPLETED', context);
    const settle = new ProcessingSettleService(db);
    expect(settle.settle(procId, { amount: 500 }, context).settleStatus).toBe('SETTLED');
    expect(Number((settle.stats(context) as { settled: { count: number } }).settled.count)).toBeGreaterThanOrEqual(1);
    expect(settle.unsettle(procId, context).settleStatus).toBe('UNSETTLED');
    expect(Number((settle.stats(context) as { unsettled: { count: number } }).unsettled.count)).toBeGreaterThanOrEqual(1);
  });

  it('validates supplier links, overflow amounts and non-approved receives', async () => {
    const purchase = new PurchaseOrderService(db);
    db.prepare(
      `INSERT INTO Supplier (id, clinicId, createdAt, updatedAt, deletedAt, code, name)
       VALUES ('sup-po-edge', ?, ?, ?, NULL, 'SUP-PO-EDGE', 'PO供应商')`,
    ).run(context.clinicId, now, now);

    await expect(purchase.create({
      number: 'PO-SUP-1',
      supplierId: 'sup-po-edge',
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).resolves.toMatchObject({ status: 'PENDING' });
    await expect(purchase.create({
      number: 'PO-SUP-2',
      supplierId: 'sup-missing',
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Supplier not found');
    await expect(purchase.create({
      number: 'PO-SUB-OVER',
      items: [{ name: 'X', quantity: 1, unitPrice: 2_000_000_000_000 }],
    }, context)).rejects.toThrow('Purchase item subtotal exceeds');
    await expect(purchase.create({
      number: 'PO-TOTAL-OVER',
      items: [
        { name: 'A', quantity: 1, unitPrice: 600_000_000_000 },
        { name: 'B', quantity: 1, unitPrice: 600_000_000_000 },
      ],
    }, context)).rejects.toThrow('Purchase order total exceeds');

    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES ('po-not-approved', ?, ?, ?, NULL, 'PO-NA', NULL, 0, 'PENDING', 'SUBMITTED')`,
    ).run(context.clinicId, now, now);
    await expect(purchase.receive('po-not-approved', context)).rejects.toThrow('must be approved before receiving');
  });

  it('falls back to the pre-adjust stock when the post-adjust snapshot is missing', async () => {
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES ('item-af', ?, ?, ?, NULL, 'AF-CODE', 'AF Item', 'MAT', 'box', 5, 0, 100)`,
    ).run(context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES ('po-after-fallback', ?, ?, ?, NULL, 'PO-AF', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run(context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES ('poi-af', ?, ?, ?, NULL, 'po-after-fallback', 'item-af', 'AF Item', 2, 100, 200)`,
    ).run(context.clinicId, now, now);

    let finds = 0;
    const fakeInventory = {
      findItem: () => {
        finds += 1;
        return finds === 1 ? { id: 'item-af', stock: 5 } : null;
      },
      adjustStock: () => undefined,
      createTransaction: () => undefined,
    };
    const purchase = new PurchaseOrderService(db, undefined, fakeInventory as never);
    const result = await purchase.receive('po-after-fallback', context) as {
      items: Array<{ itemId: string; beforeStock: number; afterStock: number }>;
    };
    expect(result.items[0]).toMatchObject({ itemId: 'item-af', beforeStock: 5, afterStock: 7 });
  });

  it('covers stats, print, and search label branches', () => {
    const nullContext = { ...context, clinicId: null };
    const stats = new StatsService(db);
    expect(stats.dashboard(nullContext)).toHaveProperty('patients');
    expect(stats.revenue('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', 'day', nullContext)).toBeInstanceOf(Array);
    expect(stats.revenue('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', 'month', nullContext)).toBeInstanceOf(Array);
    expect(stats.patientGrowth('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', nullContext)).toBeInstanceOf(Array);
    expect(stats.inventoryStats(nullContext)).toBeInstanceOf(Array);
    expect(stats.memberStats(nullContext)).toHaveProperty('total');

    const print = new PrintService();
    expect(print.render('report', { title: 'Title', note: 'Note' })).toContain('Title');
    expect(print.render('report', { note: 'Note' })).toContain('report');

    const analytics = new AnalyticsService(db);
    expect(analytics.rfm(nullContext)).toMatchObject({ items: expect.any(Array), truncated: expect.any(Boolean) });
    expect(analytics.churn(nullContext)).toMatchObject({ items: expect.any(Array), truncated: expect.any(Boolean) });
    expect(analytics.doctorAnomalies(nullContext)).toBeInstanceOf(Array);
    const satisfaction = new SatisfactionService(db);
    expect(satisfaction.nps(nullContext).score).toBeGreaterThanOrEqual(0);
    expect(satisfaction.trend(nullContext)).toBeInstanceOf(Array);
    expect(satisfaction.doctorRankings(nullContext)).toBeInstanceOf(Array);
    const chargeAssistant = new ChargeAssistantService(db);
    expect(chargeAssistant.frequentItems(nullContext)).toBeInstanceOf(Array);
    const printTemplates = new PrintTemplateService(db);
    expect(printTemplates.list(nullContext)).toBeInstanceOf(Array);
    expect(() => printTemplates.render('missing-null-template', {}, nullContext)).toThrow('Print template not found');

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, ?, ?, ?, NULL, 'S-EDGE', NULL, '1351234')`,
    ).run('supplier-edge', null, now, now);
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, ?, ?, ?, NULL, NULL, 'Supplier Only', '13512345')`,
    ).run('supplier-edge-2', null, now, now);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'XNULL', NULL, 'UNKNOWN', 'PHONE123',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-null-name', null, now, now);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'UNKNOWN', 'SHORT',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-short-phone', null, now, now);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'SEARCHCAT', 'box', 1, 0, 100)`,
    ).run('inventory-null-label', null, now, now);
    // 迁移 119 已移除 FTS 触发器（按需重建索引），测试需显式重建。
    rebuildSearchIndex(db);
    const search = new SearchService(db);
    const results = search.search('Supplier', nullContext);
    expect(results.length).toBeGreaterThanOrEqual(1);
    db.prepare(
      `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
       VALUES ('Unknown', 'search-unknown', 'clinic-v2-001', 'UNKNOWNTERM')`,
    ).run();
    search.search('UNKNOWNTERM', context);
    expect(search.search('', context)).toEqual([]);
    expect(search.search('XNULL', nullContext).some((row) => row.resource === 'patients' && row.label === 'XNULL')).toBe(true);
    expect(search.search('SHORT', nullContext).some((row) => (row.detail as Record<string, unknown>).phone === '*****')).toBe(true);
    expect(search.search('SEARCHCAT', nullContext).some((row) => row.resource === 'inventoryItems' && row.label === '')).toBe(true);

    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', 'user-admin-001', ?, ?, 'LABELSTATUS', 'REGULAR')`,
    ).run('appointment-label-null', now, now, now, now);
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', NULL, 100, 'LABELCHARGE')`,
    ).run('charge-label-null', now, now);
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, NULL, ?, ?, NULL, NULL, NULL, 'LABELPHONE')`,
    ).run('supplier-label-null', now, now);
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', ?, 'LABELCONTENT', 'PENDING')`,
    ).run('followup-label-null', now, now, now.slice(0, 10));
    rebuildSearchIndex(db);
    expect(search.search('LABELSTATUS', nullContext).some((row) => row.resource === 'appointments' && row.label === '')).toBe(true);
    expect(search.search('LABELCHARGE', nullContext).some((row) => row.resource === 'charges' && row.label === '')).toBe(true);
    expect(search.search('LABELPHONE', nullContext).some((row) => row.resource === 'suppliers' && row.label === '')).toBe(true);
    expect(search.search('LABELCONTENT', nullContext).some((row) => row.resource === 'followUps' && row.label === '')).toBe(true);
  });

  it('covers sync push error branches', async () => {
    const service = new SyncService(db);
    const freshIso = new Date(Date.now() + 60_000).toISOString();
    expect(() => service.pull(now, '', 'bad-token', context)).toThrow('Device credentials');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: 'bad-token',
      changes: [],
    }, context)).rejects.toThrow('not registered');
    expect(() => service.registerDevice('forbidden-device', 'x', { ...context, role: 'DOCTOR' }))
      .toThrow('Sync requires BOSS');
    expect(() => service.registerDevice('null-clinic-device', 'x', { ...context, clinicId: null }))
      .toThrow('Sync requires a clinic scope');
    const device = service.registerDevice('device-1', 'Edge Device', context);
    expect(() => service.pull(now, 'device-1', device.token, { ...context, clinicId: null }))
      .toThrow('Sync requires a clinic scope');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [],
    }, { ...context, clinicId: null })).rejects.toThrow('Sync requires a clinic scope');
    expect(() => service.pull(now, 'device-1', device.token, { ...context, role: 'DOCTOR' }))
      .toThrow('Sync requires BOSS');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [],
    }, { ...context, role: 'DOCTOR' })).rejects.toThrow('Sync requires BOSS');
    expect(service.pull(now, 'device-1', device.token, context)).toHaveProperty('changes');
    const notAllowed = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'NotAllowed', recordId: 'x', operation: 'INSERT', updatedAt: now, data: {} }],
    }, context);
    expect(notAllowed.failed).toBe(1);
    const missingData = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'edge-sync-1', operation: 'INSERT', updatedAt: now, data: undefined }],
    }, context);
    expect(missingData.failed).toBe(1);
    const badOperation = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'edge-sync-op', operation: 'UPSERT', updatedAt: now, data: {} }],
    }, context);
    expect(badOperation.failed).toBe(1);
    const chargeSync = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Charge', recordId: 'edge-sync-charge', operation: 'INSERT', updatedAt: now, data: {} }],
    }, context);
    expect(chargeSync.failed).toBe(1);
    // Charge 任何操作（含 DELETE）都禁止经 sync 写入，防绕过 cancel 状态机软删收费单
    const chargeDelete = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Charge', recordId: 'edge-sync-charge', operation: 'DELETE', updatedAt: now }],
    }, context);
    expect(chargeDelete.failed).toBe(1);
    expect(chargeDelete.errors[0].error).toBe('Charge writes are disabled in sync; use charge APIs');
    const deleteResult = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'edge-sync-2', operation: 'DELETE', updatedAt: now }],
    }, context);
    expect(deleteResult.failed).toBe(1);
    const updateResult = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-edge',
        operation: 'INSERT',
        updatedAt: now,
        data: { code: 'SYNC-EDGE', name: 'Sync Edge', gender: 'UNKNOWN', phone: '13600000002', source: 'OTHER', active: true },
      }],
    }, context);
    expect(updateResult.accepted).toBe(1);
    const updateAgain = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-edge',
        operation: 'INSERT',
        updatedAt: freshIso,
        data: { name: 'Sync Edge Updated' },
      }],
    }, context);
    expect(updateAgain.accepted).toBe(1);
    const deleteTarget = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-delete',
        operation: 'INSERT',
        updatedAt: now,
        data: { code: 'SYNC-DELETE', name: 'Sync Delete', gender: 'UNKNOWN', phone: '13600000005', source: 'OTHER', active: true },
      }],
    }, context);
    expect(deleteTarget.accepted).toBe(1);
    const deleteExisting = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'patient-sync-delete', operation: 'DELETE', updatedAt: freshIso }],
    }, context);
    expect(deleteExisting.accepted).toBe(1);
    const deletedRow = db.prepare('SELECT deletedAt FROM Patient WHERE id = ?').get('patient-sync-delete') as { deletedAt: string | null } | undefined;
    expect(deletedRow?.deletedAt).not.toBeNull();
    // 状态机资源不能经 sync 直写终态；INSERT 缺省状态时注入初始状态。
    const terminalTreatment = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Treatment',
        recordId: 'edge-sync-treatment-terminal',
        operation: 'INSERT',
        updatedAt: now,
        data: {
          patientId: 'patient-demo-001',
          doctorId: 'user-admin-001',
          code: 'T-SYNC-TERMINAL',
          name: 'Terminal',
          category: 'GENERAL',
          price: 100,
          quantity: 1,
          status: 'COMPLETED',
        },
      }],
    }, context);
    expect(terminalTreatment.failed).toBe(1);
    expect(terminalTreatment.errors[0].error).toContain('状态由服务端状态机管理');
    const defaultTreatment = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Treatment',
        recordId: 'edge-sync-treatment-default',
        operation: 'INSERT',
        updatedAt: now,
        data: {
          patientId: 'patient-demo-001',
          doctorId: 'user-admin-001',
          code: 'T-SYNC-DEFAULT',
          name: 'Default',
          category: 'GENERAL',
          price: 100,
          quantity: 1,
        },
      }],
    }, context);
    expect(defaultTreatment.accepted).toBe(1);
    expect((db.prepare('SELECT status FROM Treatment WHERE id = ?').get('edge-sync-treatment-default') as { status: string }).status)
      .toBe('PLANNED');
    const mismatchedUpdate = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Treatment',
        recordId: 'edge-sync-treatment-default',
        operation: 'UPDATE',
        updatedAt: freshIso,
        data: { status: 'COMPLETED' },
      }],
    }, context);
    expect(mismatchedUpdate.failed).toBe(1);
    const matchedUpdate = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Treatment',
        recordId: 'edge-sync-treatment-default',
        operation: 'UPDATE',
        updatedAt: freshIso,
        data: { name: 'Default Updated', status: 'PLANNED' },
      }],
    }, context);
    expect(matchedUpdate.accepted).toBe(1);
    const trickyData: Record<string, unknown> = {};
    Object.defineProperty(trickyData, 'code', {
      enumerable: true,
      get() {
        throw 'sync-string-error';
      },
    });
    const nonError = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-non-error',
        operation: 'INSERT',
        updatedAt: now,
        data: trickyData,
      }],
    }, context);
    expect(nonError.failed).toBe(1);
    expect(() => service.cleanup(now, { ...context, clinicId: null })).toThrow('Sync requires a clinic scope');
    expect(service.cleanup(now, context).deleted).toBeGreaterThanOrEqual(0);
  });

  it('keeps sync pull scoped to the active clinic', () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-isolation-device', 'Isolation', context);
    const afterNow = '2026-08-04T00:00:00.100Z';
    const otherClinic = 'clinic-v2-sync-other';
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-SYNC-OTHER', 'Sync Other Clinic', 1)`,
    ).run(otherClinic, now, now);
    db.prepare(
      `INSERT INTO SyncChange (
         id, clinicId, createdAt, updatedAt, deletedAt,
         tableName, recordId, operation, deviceId
       ) VALUES ('sync-isolation-a', ?, ?, ?, NULL, 'Patient', 'patient-a', 'INSERT', 'other-device')`,
    ).run(context.clinicId, afterNow, afterNow);
    db.prepare(
      `INSERT INTO SyncChange (
         id, clinicId, createdAt, updatedAt, deletedAt,
         tableName, recordId, operation, deviceId
       ) VALUES ('sync-isolation-b', ?, ?, ?, NULL, 'Patient', 'patient-b', 'INSERT', 'other-device')`,
    ).run(otherClinic, afterNow, afterNow);

    const pulled = service.pull(now, 'sync-isolation-device', device.token, context);
    expect(pulled.changes.some((row) => row.id === 'sync-isolation-a')).toBe(true);
    expect(pulled.changes.some((row) => row.id === 'sync-isolation-b')).toBe(false);
  });

  it('provides a full resync snapshot scoped to the active clinic', () => {
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'EXTRA-SYNC', 'Extra Sync Patient', 'UNKNOWN', '13900000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-extra-snapshot', context.clinicId, now, now);
    const service = new SyncService(db);
    const metadata = service.fullSnapshot(context);
    expect(metadata.tables?.Patient.total).toBeGreaterThanOrEqual(1);
    const page = service.fullSnapshot(context, { table: 'Patient', limit: 1, offset: 0 });
    expect(page.rows?.some((row) => row.id === 'patient-demo-001')).toBe(true);
    expect(page.truncated).toBe(true);
    const otherPage = service.fullSnapshot({ ...context, clinicId: 'clinic-v2-sync-other' }, { table: 'Patient' });
    expect(otherPage.rows?.some((row) => row.id === 'patient-demo-001')).toBe(false);
    expect(() => service.fullSnapshot(context, { table: 'NotATable' })).toThrow('Sync table is not allowed');
    expect(() => service.fullSnapshot({ ...context, role: 'DOCTOR' })).toThrow('Sync requires BOSS');
    const bounded = service.fullSnapshot(context, {
      table: 'Patient',
      limit: Number.POSITIVE_INFINITY,
      offset: Number.POSITIVE_INFINITY,
    });
    expect(Number.isFinite(bounded.limit)).toBe(true);
    expect(Number(bounded.limit)).toBeLessThanOrEqual(50_000);
    expect(Number.isFinite(bounded.offset)).toBe(true);
    const hugeOffset = service.fullSnapshot(context, { table: 'Patient', limit: 1, offset: 1e12 });
    expect(Number(hugeOffset.offset ?? 0)).toBeLessThanOrEqual(50_000);
    const first = service.fullSnapshot(context, { table: 'Patient', limit: 1 });
    const second = service.fullSnapshot(context, { table: 'Patient', limit: 1, afterId: String(first.nextId) });
    expect(second.offset).toBeUndefined();
    expect(second.rows?.[0]?.id).not.toBe(first.rows?.[0]?.id);
    const exactTotal = Math.max(1, Number(metadata.tables?.Patient.total ?? 0));
    const exact = service.fullSnapshot(context, { table: 'Patient', limit: exactTotal });
    expect(exact.truncated).toBe(false);
    expect(exact.nextId).toBeUndefined();
  });

  it('pulls server-originated changes to other devices and keeps push single-row', async () => {
    const service = new SyncService(db);
    const device = service.registerDevice('sync-server-origin-device', 'Server Origin', context);
    const since = new Date(Date.now() - 60_000).toISOString();
    // 模拟 web/服务端本地直写产生的 server 变更。
    recordSyncChange(db, { tableName: 'Patient', recordId: 'patient-server-origin', operation: 'INSERT', clinicId: context.clinicId as string });
    const pulled = service.pull(since, 'sync-server-origin-device', device.token, context);
    expect(pulled.changes.some((c) => String(c.recordId) === 'patient-server-origin' && c.deviceId === 'server')).toBe(true);
    // push 保持单行且设备归属正确（repository 在 push 内不额外发射 server 行）。
    const pushed = await service.push({
      deviceId: 'sync-server-origin-device',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient', recordId: 'patient-pushed-single', operation: 'INSERT', updatedAt: new Date().toISOString(),
        data: { code: 'SYNC-SINGLE', name: 'Single', gender: 'UNKNOWN', phone: '13500000001', source: 'WALK_IN', active: true },
      }],
    }, context);
    expect(pushed.accepted).toBe(1);
    const rows = db.prepare(`SELECT deviceId, operation FROM SyncChange WHERE recordId = 'patient-pushed-single'`).all() as Array<{ deviceId: string; operation: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deviceId: 'sync-server-origin-device', operation: 'INSERT' });
  });

  it('enforces tenant scope in core workflows', async () => {
    const now = new Date().toISOString();
    const otherClinic = 'other-clinic';

    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appointment-other', otherClinic, now, now, now, new Date(Date.now() + 3_600_000).toISOString());
    const appointments = new AppointmentService(db);
    await expect(appointments.transition('appointment-other', 'CANCELLED', context)).rejects.toThrow('Appointment not found');

    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, paidAmount, refundedAmount, discount, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'OTHER-CHARGE', 100, 0, 0, 0, 'UNPAID')`,
    ).run('charge-other', otherClinic, now, now);
    const charges = new ChargeService(db);
    await expect(charges.pay('charge-other', 10, 'CASH', undefined, context)).rejects.toThrow('Charge not found');
    await expect(charges.refund('charge-other', 10, 'other', context)).rejects.toThrow('Charge not found');

    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge-other', 'patient-demo-001', 100, 0, 'UNPAID')`,
    ).run('debt-other', otherClinic, now, now);
    const debts = new DebtService(db);
    await expect(debts.pay('debt-other', 10, context)).rejects.toThrow('Debt record not found');

    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'OTHER-CARD', 100, 100, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-other', otherClinic, now, now);
    const cards = new MemberCardService(db);
    await expect(cards.recharge('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.consume('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.addPoints('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.recharge('missing-card', 10, context)).rejects.toThrow('Member card not found');
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'BAD-STATUS', status: 'BAD', level: 'NORMAL' }, context))
      .toThrow('Invalid member card status');
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'BAD-LEVEL', status: 'ACTIVE', level: 'BAD' }, context))
      .toThrow('Invalid member card level');
    expect(() => cards.create({ patientId: '', cardNo: '', status: 'ACTIVE', level: 'NORMAL' }, context))
      .toThrow('patientId and cardNo are required');
    expect(() => cards.create({} as never, context)).toThrow('patientId and cardNo are required');
    const createdCard = cards.create({ patientId: 'patient-demo-001', cardNo: 'CREATED-CARD', status: 'ACTIVE', level: 'NORMAL' }, context);
    expect(createdCard.id).toBeDefined();
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'CREATED-CARD', status: 'ACTIVE', level: 'NORMAL' }, context))
      .toThrow('Member card number already exists');

    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'OTHER-ITEM', 'Other Item', 'MAT', 'box', 10, 1, 100)`,
    ).run('inventory-other', otherClinic, now, now);
    const inventory = new InventoryService(db);
    await expect(inventory.createTransaction({ itemId: 'inventory-other', type: 'IN', quantity: 1 }, context))
      .rejects.toThrow('Inventory item not found');
    expect(inventory.expiringSoon(30, { ...context, clinicId: null }).items).toBeInstanceOf(Array);
  });

  it('keeps analytics, search, and replenishment scoped to the active clinic', () => {
    const otherClinic = 'clinic-v2-read-other';
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-READ-OTHER', 'Read Other Clinic', 1)`,
    ).run(otherClinic, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'READ-OTHER', 'Isolation Secret Patient', 'UNKNOWN', '13900008888',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-read-other', otherClinic, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, paidAmount, refundedAmount, discount, status, paidAt
       ) VALUES (?, ?, ?, ?, NULL, 'patient-read-other', 'READ-OTHER-CHARGE', 888, 888, 0, 0, 'PAID', ?)`,
    ).run('charge-read-other', otherClinic, now, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'READ-OTHER-ITEM', 'Read Other Item', 'ISOLATION', 'box', 2, 20, 100)`,
    ).run('inventory-read-other', otherClinic, now, now);

    // 当前用户只属于 clinic-v2-001，不属于 otherClinic
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, 'clinic-v2-001', 'BOSS', ?, ?, NULL)`,
    ).run(context.userId, now, now);

    const stats = new StatsService(db);
    expect(Number(stats.dashboard(nullContext).patients)).toBeGreaterThan(Number(stats.dashboard(context).patients));
    const revenue = stats.revenue('2026-08-04T00:00:00.000Z', '2026-08-04T23:59:59.999Z', 'day', context);
    expect(revenue.some((row) => Number(row.amount) === 888)).toBe(false);
    expect(stats.inventoryStats(context).some((row) => row.category === 'ISOLATION')).toBe(false);

    rebuildSearchIndex(db);
    const search = new SearchService(db);
    expect(search.search('Isolation Secret', context)).toEqual([]);
    expect(search.search('Isolation Secret', nullContext).some((row) => row.id === 'patient-read-other')).toBe(true);

    const inventory = new InventoryService(db);
    expect(inventory.lowStock(context).items.some((row) => row.id === 'inventory-read-other')).toBe(false);

    const replenishment = new ReplenishmentService(db);
    replenishment.generate(context);
    const otherSuggestion = db.prepare(
      'SELECT id FROM InventoryReplenishmentSuggestion WHERE inventoryId = ? AND clinicId = ? AND deletedAt IS NULL',
    ).get('inventory-read-other', otherClinic) as { id: string } | undefined;
    expect(otherSuggestion).toBeUndefined();

    const analytics = new AnalyticsService(db);
    // 只展示当前用户有成员关系的诊所（UserClinic 过滤）+ legacy 兜底行
    const overview = analytics.clinicOverview(context);
    const otherOverview = overview.find((row) => row.clinicId === otherClinic) as Record<string, unknown>;
    expect(otherOverview).toBeUndefined();
    expect(overview.some((row) => row.clinicId === 'clinic-v2-001')).toBe(true);
  });

  it('calls the stocktake lock guard while receiving a purchase order', async () => {
    const lockGuard = vi.fn();
    const purchase = new PurchaseOrderService(db, undefined, undefined, lockGuard);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'PO-LOCK-ITEM', 'Lock Item', 'MAT', 'box', 1, 0, 100)`,
    ).run('inventory-po-lock', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, ?, ?, ?, NULL, 'PO-LOCK', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run('po-lock', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-lock', 'inventory-po-lock', 'Lock Item', 1, 100, 100)`,
    ).run('poi-lock', context.clinicId, now, now);

    await purchase.receive('po-lock', context);
    expect(lockGuard).toHaveBeenCalledWith('inventory-po-lock', 'clinic-v2-001');
  });

  it('covers HR, alerts, member cards, purchase, processing, risk, prescription, ceph, progress, import, debt, notifications, satisfaction branches', async () => {
    const hr = new HrService(db);
    expect(hr.attendance(now.slice(0, 10), context).items).toBeInstanceOf(Array);
    expect(hr.attendance().items).toBeInstanceOf(Array);
    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, ?, ?, ?, NULL, 'user-admin-001', '2026-08-01', '2026-08-02', 'ANNUAL', 'r', 'PENDING')`,
    ).run('leave-edge-reject', context.clinicId, now, now);
    expect(hr.approveLeave('leave-edge-reject', 'user-admin-001', false, context).status).toBe('REJECTED');
    expect(() => hr.approveLeave('leave-edge-reject', 'user-admin-001', true, context)).toThrow('cannot be approved');
    expect(() => hr.approveLeave('missing-leave', 'user-admin-001', true, context)).toThrow('Leave request not found');
    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, ?, ?, ?, NULL, 'user-admin-001', '2026-08-01', '2026-08-02', 'ANNUAL', 'race', 'PENDING')`,
    ).run('leave-edge-race', context.clinicId, now, now);
    const failingHr = new HrService(db, {
      attendance: () => ({ items: [], total: 0, page: 1, pageSize: 200 }),
      approveLeave: () => 0,
    });
    expect(() => failingHr.approveLeave('leave-edge-race', 'user-admin-001', true, context)).toThrow('cannot be approved');

    const alerts = new AlertService(db);
    expect(alerts.open().items).toBeInstanceOf(Array);
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED', 'user-admin-001')).toThrow('Business alert not found');
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED')).toThrow('Business alert not found');
    const alertEdge = alerts.create({
      alertType: 'TEST',
      level: 'INFO',
      severity: 'INFO',
      title: 'T',
      message: 'M',
      source: 'edge',
      clinicId: context.clinicId,
    });
    expect(alerts.setStatus(String(alertEdge.id), 'ACKNOWLEDGED', 'user-admin-001', context).status).toBe('ACKNOWLEDGED');
    expect(alerts.setStatus(String(alertEdge.id), 'RESOLVED', 'user-admin-001', context).status).toBe('RESOLVED');
    expect(() => alerts.setStatus(String(alertEdge.id), 'OPEN', 'user-admin-001', context)).toThrow('Cannot transition');
    expect(() => alerts.setStatus(String(alertEdge.id), 'BAD' as never, 'user-admin-001', context)).toThrow('Invalid business alert status');
    const alertRace = alerts.create({
      alertType: 'TEST',
      level: 'INFO',
      severity: 'INFO',
      title: 'R',
      message: 'R',
      source: 'edge-race',
      clinicId: context.clinicId,
    });
    const failingAlerts = new AlertService(db, {
      open: () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
      setStatus: () => 0,
    });
    expect(() => failingAlerts.setStatus(String(alertRace.id), 'RESOLVED', 'user-admin-001', context)).toThrow('status update failed');
    const nullAlertRace = alerts.create({
      alertType: 'TEST',
      level: 'INFO',
      severity: 'INFO',
      title: 'Null',
      message: 'Null',
      source: 'edge-null-race',
    });
    const failingNullAlerts = new AlertService(db, {
      open: () => ({ items: [], total: 0, page: 1, pageSize: 100 }),
      setStatus: () => 0,
    });
    expect(() => failingNullAlerts.setStatus(String(nullAlertRace.id), 'RESOLVED')).toThrow('status update failed');
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED', 'user-admin-001', context)).toThrow('Business alert not found');

    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'CARD-EDGE-2', 100, 100, 0, 'ACTIVE', 10, 10, 'NORMAL')`,
    ).run('card-edge-2', context.clinicId, now, now);
    const cards = new MemberCardService(db);
    await expect(cards.recharge('card-edge-2', 0, context)).rejects.toThrow('Recharge');
    await expect(cards.consume('card-edge-2', 0, context)).rejects.toThrow('Consume');
    await expect(cards.consume('card-edge-2', 101, context)).rejects.toThrow('Insufficient member card');
    await expect(cards.addPoints('card-edge-2', -11, context)).rejects.toThrow('Insufficient points');
    await expect(cards.addPoints('card-edge-2', 0, context)).rejects.toThrow('non-zero integer');
    await expect(cards.addPoints('card-edge-2', 1.5, context)).rejects.toThrow('non-zero integer');
    await cards.addPoints('card-edge-2', -5, context);
    await expect(cards.recharge('missing-card', 1, context)).rejects.toThrow('Member card not found');
    await cards.recharge('card-edge-2', 10, nullContext);
    await cards.consume('card-edge-2', 10, nullContext);
    await cards.addPoints('card-edge-2', 5, nullContext);
    // MAX 上限守卫：金额/积分在数值边界的拒绝路径
    await expect(cards.recharge('card-edge-2', MAX_MONEY_CENTS + 1, context)).rejects.toThrow('exceeds the member card balance limit');
    await expect(cards.recharge('card-edge-2', MAX_MONEY_CENTS, context)).rejects.toThrow('exceeds the member card balance limit');
    await expect(cards.consume('card-edge-2', MAX_MONEY_CENTS + 1, context)).rejects.toThrow('exceeds the member card limit');
    await expect(cards.addPoints('card-edge-2', 1_000_000_000_001, context)).rejects.toThrow('exceeds the member card points limit');
    await expect(cards.addPoints('card-edge-2', 999_999_999_992, context)).rejects.toThrow('exceeds the member card points limit');

    const purchase = new PurchaseOrderService(db);
    await expect(purchase.receive('missing-po', context)).rejects.toThrow('Purchase order not found');
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE', NULL, 0, 'RECEIVED')`,
    ).run('po-edge', context.clinicId, now, now);
    await expect(purchase.receive('po-edge', context)).rejects.toThrow('not pending');
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE-2', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run('po-edge-2', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-2', NULL, 'No item', 1, 100, 100)`,
    ).run('poi-edge-null', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'PO-OTHER', 'Other Clinic Item', 'MAT', 'box', 1, 0, 100)`,
    ).run('inventory-po-other', 'clinic-v2-other', now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-2', 'inventory-po-other', 'Other Clinic Item', 1, 100, 100)`,
    ).run('poi-edge-missing', context.clinicId, now, now);
    await expect(purchase.receive('po-edge-2', context)).rejects.toThrow('missing inventory items');
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'PO-ITEM', 'PO Item', 'MAT', 'box', 1, 0, 100)`,
    ).run('inventory-po-valid', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE-3', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run('po-edge-3', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-3', 'inventory-po-valid', 'Valid', 2, 100, 200)`,
    ).run('poi-edge-valid', context.clinicId, now, now);
    const receipt = await purchase.receive('po-edge-3', context);
    expect(receipt).toMatchObject({
      id: 'po-edge-3',
      status: 'RECEIVED',
      number: 'PO-EDGE-3',
      items: [
        {
          itemId: 'inventory-po-valid',
          name: 'Valid',
          quantity: 2,
          unitPrice: 100,
          subtotal: 200,
          beforeStock: 1,
          afterStock: 3,
        },
      ],
    });
    expect(purchase.items('po-edge-3', context).length).toBe(1);
    expect(() => purchase.items('missing-po', context)).toThrow('Purchase order not found');
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status, reviewStatus
       ) VALUES (?, NULL, ?, ?, NULL, 'PO-EDGE-NULL', NULL, 0, 'PENDING', 'APPROVED')`,
    ).run('po-edge-null', now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, NULL, ?, ?, NULL, 'po-edge-null', 'inventory-po-valid', 'Null Clinic', 1, 100, 100)`,
    ).run('poi-edge-null-clinic', now, now);
    const nullReceipt = await purchase.receive('po-edge-null', nullContext);
    expect(nullReceipt.items).toEqual([
      expect.objectContaining({
        itemId: 'inventory-po-valid',
        beforeStock: 3,
        afterStock: 4,
      }),
    ]);
    const stock = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('inventory-po-valid') as { stock: number };
    expect(Number(stock.stock)).toBe(4);

    const processing = new ProcessingOrderService(db);
    expect(() => processing.transition('missing-processing', 'SENT', context)).toThrow('Processing order not found');
    db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE-PROC', 'patient-demo-001', 'DRAFT')`,
    ).run('proc-edge', context.clinicId, now, now);
    expect(processing.transition('proc-edge', 'CANCELLED', context).status).toBe('CANCELLED');
    expect(() => processing.transition('proc-edge', 'SENT', context)).toThrow('Cannot transition');
    db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, status
       ) VALUES (?, NULL, ?, ?, NULL, 'PROC-NULL', 'patient-demo-001', 'DRAFT')`,
    ).run('proc-edge-null', now, now);
    expect(processing.transition('proc-edge-null', 'SENT', nullContext).status).toBe('SENT');

    const risk = new PatientRiskService(db);
    const riskResult = risk.calculate('patient-demo-001', context);
    expect(riskResult).toHaveProperty('cariesScore');
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'RISK', 'Risk Patient', 'UNKNOWN', '13600000004',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-risk-high', context.clinicId, now, now);
    for (let i = 0; i < 16; i += 1) {
      db.prepare(
        `INSERT INTO Treatment (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, doctorId, code, name, category, price, quantity, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-risk-high', 'user-admin-001', ?, 'T', 'GENERAL', 100, 1, 'COMPLETED')`,
      ).run(`risk-treatment-${i}`, context.clinicId, now, now, `R-${i}`);
    }
    const riskHigh = new PatientRiskService(db).calculate('patient-risk-high', context);
    expect(riskHigh).toHaveProperty('cariesScore');
    expect(() => risk.calculate('missing-risk-patient', context)).toThrow('Patient not found');
    for (const [patientId, codePrefix, count] of [
      ['patient-risk-medium', 'RM', 6],
      ['patient-risk-high-level', 'RH', 12],
    ] as Array<[string, string, number]>) {
      db.prepare(
        `INSERT INTO Patient (
           id, clinicId, createdAt, updatedAt, deletedAt,
           code, name, gender, phone, tags, allergies, medicalHistory,
           medicationHistory, systemicDiseases, source, active
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'UNKNOWN', '13600000005',
           '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
      ).run(patientId, context.clinicId, now, now, codePrefix, patientId);
      for (let i = 0; i < count; i += 1) {
        db.prepare(
          `INSERT INTO Treatment (
             id, clinicId, createdAt, updatedAt, deletedAt,
             patientId, doctorId, code, name, category, price, quantity, status
           ) VALUES (?, ?, ?, ?, NULL, ?, 'user-admin-001', ?, 'T', 'GENERAL', 100, 1, 'COMPLETED')`,
        ).run(`${patientId}-${i}`, context.clinicId, now, now, patientId, `${codePrefix}-${i}`);
      }
      new PatientRiskService(db).calculate(patientId, context);
    }
    new PatientRiskService(db).calculate('patient-risk-medium', nullContext);

    const prescription = new PrescriptionSafetyService(db);
    await expect(() => prescription.check('missing-rx', context)).toThrow('Prescription not found');
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'missing-patient', 'user-admin-001')`,
    ).run('rx-edge-missing-patient', context.clinicId, now, now);
    expect(prescription.check('rx-edge-missing-patient', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-EMPTY', 'Empty Allergy', 'UNKNOWN', '13600000007',
         '[]', '', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-empty', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-empty', 'user-admin-001')`,
    ).run('rx-edge-empty-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-empty-allergy', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-OBJECT', 'Object Allergy', 'UNKNOWN', '13600000010',
         '[]', '{}', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-object', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-object', 'user-admin-001')`,
    ).run('rx-edge-object-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-object-allergy', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-NULL', 'Null Allergy', 'UNKNOWN', '13600000011',
         '[]', NULL, '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-null', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-null', 'user-admin-001')`,
    ).run('rx-edge-null-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-null-allergy', context).safe).toBe(true);

    const ceph = new CephalometricService(db);
    await expect(() => ceph.compute('missing-ceph', context)).toThrow('Cephalometric case not found');
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '{}', 'DRAFT')`,
    ).run('ceph-edge-empty', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-empty', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', NULL, 'DRAFT')`,
    ).run('ceph-edge-null-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-null-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', 'not-json', 'DRAFT')`,
    ).run('ceph-edge-malformed-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-malformed-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '[]', 'DRAFT')`,
    ).run('ceph-edge-array-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-array-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '123', 'DRAFT')`,
    ).run('ceph-edge-number-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-number-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png',
         '{"sella":{"x":0,"y":0},"nasion":{"x":10,"y":0},"upperIncisor":{"x":0,"y":10},"lowerIncisor":{"x":10,"y":10}}', 'DRAFT')`,
    ).run('ceph-edge-full', context.clinicId, now, now);
    const cephMetrics = ceph.compute('ceph-edge-full', context).metrics as Record<string, number>;
    expect(cephMetrics.snLength).toBeGreaterThan(0);
    expect(cephMetrics.interincisalAngle).toBeGreaterThanOrEqual(0);

    const progress = new TreatmentProgressService(db);
    await expect(() => progress.summary('missing-plan', context)).toThrow('Treatment plan not found');
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, name, status, totalFee
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'Plan', 'APPROVED', 0)`,
    ).run('plan-edge-empty', context.clinicId, now, now);
    expect(progress.summary('plan-edge-empty', context).progress).toBe(0);

    const bulk = new BulkImportService(db);
    await expect(bulk.importRows('not-a-resource', [], context)).rejects.toThrow('cannot import');
    const bulkResult = await bulk.importRows('patients', [
      { code: 'BULK-EDGE', name: 'Invalid Gender', gender: 'INVALID', phone: '13600000003', source: 'OTHER' },
    ], context);
    expect(bulkResult.failed).toBe(1);
    const missingRequired = await bulk.importRows('patients', [{ name: 'Missing Code' }], context);
    expect(missingRequired.failed).toBe(1);
    await expect(bulk.importRows('users', [], context)).rejects.toThrow('disabled');
    await expect(bulk.importRows('operationLogs', [], context)).rejects.toThrow('Resource cannot import: operationLogs');
    await expect(bulk.importRows('rolePermissions', [], { ...context, role: 'DOCTOR' })).rejects.toThrow('Forbidden resource');
    await expect(bulk.importRows('patients', null as unknown as Array<Record<string, unknown>>, context)).rejects.toThrow('array');
    const tooManyRows = Array.from({ length: 10001 }, (_, index) => ({
      code: `BULK-${index}`,
      name: 'Bulk',
      gender: 'UNKNOWN',
      phone: '13600000000',
      source: 'OTHER',
    }));
    await expect(bulk.importRows('patients', tooManyRows, context)).rejects.toThrow('at most');
    const nonErrorRow: Record<string, unknown> = {};
    Object.defineProperty(nonErrorRow, 'code', {
      enumerable: true,
      get() {
        throw 'bulk-string-error';
      },
    });
    const nonErrorImport = await bulk.importRows('patients', [nonErrorRow], context);
    expect(nonErrorImport.failed).toBe(1);
    const chunked = await bulk.importRows('patients', [
      { code: 'CHUNK-1', name: 'Chunk One', gender: 'UNKNOWN', phone: '13600000001', source: 'OTHER' },
      { name: 'Missing Chunk' },
      { code: 'CHUNK-2', name: 'Chunk Two', gender: 'UNKNOWN', phone: '13600000002', source: 'OTHER' },
    ], context, 1);
    expect(chunked).toMatchObject({ imported: 2, failed: 1, chunks: 3 });
    expect((await bulk.importRows('patients', [
      { code: 'CHUNK-ZERO', name: 'Chunk Zero', gender: 'UNKNOWN', phone: '13600000003', source: 'OTHER' },
    ], context, 0)).chunks).toBe(1);
    expect((await bulk.importRows('patients', [
      { code: 'CHUNK-CLAMP', name: 'Chunk Clamp', gender: 'UNKNOWN', phone: '13600000004', source: 'OTHER' },
    ], context, 5000)).chunks).toBe(1);

    const originalExec = db.exec.bind(db);
    const exec = vi.spyOn(db, 'exec');
    exec.mockImplementation((sql: string) => {
      if (sql === 'COMMIT') throw new Error('commit failed');
      return originalExec(sql);
    });
    await expect(bulk.importRows('patients', [
      { code: 'CHUNK-ROLLBACK', name: 'Chunk Rollback', gender: 'UNKNOWN', phone: '13600000005', source: 'OTHER' },
    ], context, 1)).rejects.toThrow('commit failed');
    expect(db.prepare('SELECT id FROM Patient WHERE code = ?').get('CHUNK-ROLLBACK')).toBeUndefined();
    exec.mockRestore();

    const debt = new DebtService(db);
    await expect(debt.pay('missing-debt', 1, context)).rejects.toThrow('Debt record not found');
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge-edge-debt', 'patient-demo-001', 500, 0, 'UNPAID')`,
    ).run('debt-edge-pay', context.clinicId, now, now);
    await expect(debt.pay('debt-edge-pay', 0, context)).rejects.toThrow('Invalid debt payment');
    expect((await debt.pay('debt-edge-pay', 500, context)).status).toBe('PAID');

    const notifications = new NotificationService(db);
    expect(notifications.list('user-admin-001', null).items).toBeInstanceOf(Array);
    expect(() => notifications.markRead('missing-notification', context.userId)).toThrow('Notification not found');

    const satisfaction = new SatisfactionService(db);
    const npsBefore = satisfaction.nps(context);
    db.prepare(
      `INSERT INTO SatisfactionSurvey (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, score, channel, comment, surveyDate
       ) VALUES (?, ?, ?, ?, ?, 'patient-demo-001', 'user-admin-001', 10, 'CLINIC', 'deleted', '2026-08-04')`,
    ).run('satisfaction-deleted', context.clinicId, now, now, now);
    expect(satisfaction.nps(context)).toEqual(npsBefore);
    expect(satisfaction.trend(context)).toBeInstanceOf(Array);
    expect(satisfaction.doctorRankings(context)).toBeInstanceOf(Array);

    const workflow = new ClinicalWorkflowService(db);
    expect(() => workflow.registrationStatus('missing-registration', 'IN_PROGRESS', context)).toThrow('Registration not found');
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'REGULAR', 'REGISTERED', ?)`,
    ).run('registration-edge-invalid', context.clinicId, now, now, now);
    expect(() => workflow.registrationStatus('registration-edge-invalid', 'COMPLETED', context)).toThrow('Cannot transition');

    const replenishment = new ReplenishmentService(db);
    expect(() => replenishment.applyToPurchaseOrder(['missing-suggestion'], context)).toThrow('No applicable suggestions');

    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'TEXT', 'batch', 'PENDING')`,
    ).run('wechat-edge-batch', context.clinicId, now, now);
    const wechat = new WechatService(db, undefined, {
      name: 'fake',
      isConfigured: () => true,
      send: async () => ({ ok: true }),
    });
    expect((await wechat.sendBatch(['wechat-edge-batch'], context)).sent).toBe(1);

    expect(() => new PrintTemplateService(db).render('missing-template', {}, context)).toThrow('Print template not found');
  });

  it('includes doctors linked only through UserClinic in doctor anomalies', () => {
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES ('doctor-anomaly-membership', NULL, ?, ?, NULL, 'anomaly-doc', 'x', 'Anomaly Doc', 'DOCTOR', 1, 0, 0)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES ('doctor-anomaly-membership', 'clinic-v2-001', 'DOCTOR', ?, ?, NULL)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO Charge (
         id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount,
         discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES ('charge-anomaly-membership', 'patient-demo-001', NULL, 'doctor-anomaly-membership', 'CHG-ANOM',
         10000, 10000, 0, 0, 'PAID', 'CASH', ?, NULL, 'clinic-v2-001', ?, ?, NULL)`,
    ).run(now, now, now);

    const analytics = new AnalyticsService(db);
    const rows = analytics.doctorAnomalies(context);
    expect(rows.some((row) => row.doctorId === 'doctor-anomaly-membership')).toBe(true);
    const other = analytics.doctorAnomalies({ ...context, clinicId: 'clinic-other' });
    expect(other.some((row) => row.doctorId === 'doctor-anomaly-membership')).toBe(false);
  });
});
