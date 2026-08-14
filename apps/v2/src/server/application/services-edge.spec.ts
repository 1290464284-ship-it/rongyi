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
