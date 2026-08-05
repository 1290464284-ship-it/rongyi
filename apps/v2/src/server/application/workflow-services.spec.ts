import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import {
  ChargeAssistantService,
  ClinicalWorkflowService,
  createWechatProvider,
  HttpWechatProvider,
  PrintTemplateService,
  ReplenishmentService,
  UnconfiguredWechatProvider,
  WechatService,
} from './workflow-services';
import type { AppContext } from '../../domain/contracts';

describe('workflow services', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  let nullContext: AppContext;
  const now = '2026-08-03T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-workflow-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
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

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('transitions clinical records and locks medical records', () => {
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'IN_PROGRESS')`,
    ).run('visit-wf', context.clinicId, now, now, 'patient-demo-001', 'user-admin-001', now);
    db.prepare(
      `INSERT INTO FirstExam (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'DRAFT')`,
    ).run('exam-wf', context.clinicId, now, now, 'patient-demo-001');
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, code, name, category, price, quantity, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'T-1', 'Treatment', 'GENERAL', 100, 1, 'PLANNED')`,
    ).run('treatment-wf', context.clinicId, now, now, 'patient-demo-001', 'user-admin-001');
    db.prepare(
      `INSERT INTO MedicalRecord (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, status
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'DRAFT')`,
    ).run('record-wf', context.clinicId, now, now, 'patient-demo-001', 'user-admin-001');

    const service = new ClinicalWorkflowService(db);
    expect(service.visitStatus('visit-wf', 'COMPLETED', context).status).toBe('COMPLETED');
    expect(service.firstExamStatus('exam-wf', 'SUBMITTED', context).status).toBe('SUBMITTED');
    expect(service.treatmentStatus('treatment-wf', 'IN_PROGRESS', context).status).toBe('IN_PROGRESS');
    expect(service.lockMedicalRecord('record-wf', true, context).isLocked).toBe(true);
  });

  it('generates and applies replenishment suggestions', () => {
    const service = new ReplenishmentService(db);
    const transactionAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'DEMAND-1', 'Demand Item', 'CONSUMABLE', 'box', 1, 10, 100)`,
    ).run('item-demand', context.clinicId, transactionAt, transactionAt);
    db.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt,
         itemId, type, quantity, beforeStock, afterStock, operatorId
       ) VALUES (?, ?, ?, ?, NULL, ?, 'OUT', 90, 91, 1, ?)`,
    ).run('tx-demand', context.clinicId, transactionAt, transactionAt, 'item-demand', context.userId);
    const generated = service.generate(context);
    expect(generated.generated).toBeGreaterThanOrEqual(1);
    const suggestion = db.prepare(
      'SELECT * FROM InventoryReplenishmentSuggestion WHERE inventoryId = ? AND deletedAt IS NULL',
    ).get('item-demand') as { id: string; calculationSnapshotJson: string } | undefined;
    expect(suggestion).toBeDefined();
    if (suggestion) {
      const snapshot = JSON.parse(suggestion.calculationSnapshotJson) as { reason: string; avgDaily: number };
      expect(snapshot.reason).toBe('DEMAND_BASED_ROP');
      expect(snapshot.avgDaily).toBeCloseTo(1, 0);
    }
    expect(() => service.applyToPurchaseOrder(null as unknown as string[], context)).toThrow('At least one suggestion');
    expect(() => service.applyToPurchaseOrder(Array.from({ length: 501 }, () => 'x'), context)).toThrow('at most');
    const anySuggestion = db.prepare(
      'SELECT * FROM InventoryReplenishmentSuggestion WHERE deletedAt IS NULL LIMIT 1',
    ).get() as { id: string } | undefined;
    if (anySuggestion) {
      const result = service.applyToPurchaseOrder([anySuggestion.id], context);
      expect(result).toHaveProperty('orderId');
    }
    db.prepare(
      `INSERT INTO InventoryReplenishmentSuggestion (
         id, clinicId, inventoryId, rop, suggestedQty, createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, 1, 1, ?, ?, NULL)`,
    ).run('suggestion-missing-item', context.clinicId, 'item-missing', now, now);
    expect(() => service.applyToPurchaseOrder(['suggestion-missing-item'], context))
      .toThrow('One or more inventory items are not available');
  });

  it('sends wechat messages through a configured provider and renders print templates', async () => {
    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'TEXT', 'hello', 'PENDING')`,
    ).run('wechat-wf', context.clinicId, now, now);
    const provider = {
      name: 'fake',
      isConfigured: () => true,
      send: async () => ({ ok: true, result: 'delivered' }),
    };
    const wechat = new WechatService(db, undefined, provider);
    expect(wechat.status()).toEqual({ configured: true, provider: 'fake' });
    expect(await wechat.send('wechat-wf', context)).toMatchObject({ status: 'SENT', result: 'delivered' });
    expect(await wechat.send('wechat-wf', context)).toMatchObject({ status: 'SENT' });
    await expect(wechat.send('missing-wechat', context)).rejects.toThrow('Wechat message not found');
    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'TEXT', 'cancelled', 'CANCELLED')`,
    ).run('wechat-cancelled', context.clinicId, now, now);
    await expect(wechat.send('wechat-cancelled', context)).rejects.toThrow('cannot be sent');
    await expect(wechat.sendBatch(null as unknown as string[], context)).rejects.toThrow('array');
    await expect(wechat.sendBatch(Array.from({ length: 501 }, () => 'x'), context)).rejects.toThrow('at most');

    const fakeWechat = {
      findById: () => ({ id: 'missing-update', status: 'PENDING' }),
      markSent: () => 0,
    };
    await expect(new WechatService(db, fakeWechat as never, provider).send('missing-update', context))
      .rejects.toThrow('cannot be sent');

    db.prepare(
      `INSERT INTO PrintTemplate (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, content
       ) VALUES (?, ?, ?, ?, NULL, 'T-1', 'Template', 'REPORT', '<h1>{{title}}</h1>')`,
    ).run('print-wf', context.clinicId, now, now);
    const print = new PrintTemplateService(db);
    expect(print.list(context).length).toBeGreaterThanOrEqual(1);
    expect(print.render('T-1', { title: 'Hello' }, context)).toContain('Hello');
    const escaped = print.render('T-1', { title: '<script>alert(1)</script>' }, context);
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).not.toContain('<script>');
  });

  it('never fakes wechat delivery when the channel is not configured', async () => {
    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'TEXT', 'unconfigured', 'PENDING')`,
    ).run('wechat-unconfigured', context.clinicId, now, now);
    const unconfigured = new UnconfiguredWechatProvider();
    const service = new WechatService(db, undefined, unconfigured);
    expect(service.status()).toEqual({ configured: false, provider: 'unconfigured' });
    await expect(service.send('wechat-unconfigured', context)).rejects.toThrow('Wechat channel is not configured');
    const row = db.prepare('SELECT status FROM WechatMessage WHERE id = ?').get('wechat-unconfigured') as { status: string };
    expect(row.status).toBe('PENDING');
  });

  it('reports wechat provider network and HTTP failures without marking messages sent', async () => {
    const failingProvider = new HttpWechatProvider('http://127.0.0.1:1', 'app', 'secret');
    const failed = await failingProvider.send({ id: 'x' });
    expect(failed.ok).toBe(false);
    expect(failed.result).toBe('network_error');

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new HttpWechatProvider('https://wechat.test', 'app', 'secret');
    expect(provider.isConfigured()).toBe(true);
    const httpFailure = await provider.send({ id: 'x' });
    expect(httpFailure).toMatchObject({ ok: false, result: 'http_503' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, result: 'rejected' }) }));
    const rejected = await provider.send({ id: 'x' });
    expect(rejected).toEqual({ ok: false, result: 'rejected' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => null }));
    const sent = await provider.send({ id: 'x' });
    expect(sent).toEqual({ ok: true, result: 'sent' });
    vi.unstubAllGlobals();
  });

  it('aborts slow wechat requests and handles invalid JSON responses', async () => {
    vi.useFakeTimers();
    const provider = new HttpWechatProvider('https://wechat.test', 'app', 'secret');
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const pending = provider.send({ id: 'slow' });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ ok: false, result: 'network_error' });
    vi.unstubAllGlobals();
    vi.useRealTimers();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('invalid json');
      },
    }));
    await expect(provider.send({ id: 'invalid' })).resolves.toEqual({ ok: true, result: 'sent' });
    vi.unstubAllGlobals();
  });

  it('covers the wechat provider factory and rejects provider delivery failures', async () => {
    const unconfigured = new UnconfiguredWechatProvider();
    expect(await unconfigured.send()).toEqual({ ok: false, result: 'wechat_channel_not_configured' });

    const originalUrl = process.env.V2_WECHAT_API_URL;
    const originalAppId = process.env.V2_WECHAT_APP_ID;
    const originalSecret = process.env.V2_WECHAT_APP_SECRET;
    process.env.V2_WECHAT_API_URL = 'https://wechat.test';
    process.env.V2_WECHAT_APP_ID = 'app';
    process.env.V2_WECHAT_APP_SECRET = 'secret';
    try {
      expect(createWechatProvider().isConfigured()).toBe(true);
    } finally {
      if (originalUrl === undefined) delete process.env.V2_WECHAT_API_URL;
      else process.env.V2_WECHAT_API_URL = originalUrl;
      if (originalAppId === undefined) delete process.env.V2_WECHAT_APP_ID;
      else process.env.V2_WECHAT_APP_ID = originalAppId;
      if (originalSecret === undefined) delete process.env.V2_WECHAT_APP_SECRET;
      else process.env.V2_WECHAT_APP_SECRET = originalSecret;
    }

    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'TEXT', 'delivery-failure', 'PENDING')`,
    ).run('wechat-delivery-failure', context.clinicId, now, now);
    const failing = new WechatService(db, undefined, {
      name: 'failing',
      isConfigured: () => true,
      send: async () => ({ ok: false, result: 'rejected_by_channel' }),
    });
    await expect(failing.send('wechat-delivery-failure', context)).rejects.toThrow('Wechat channel send failed');
    const row = db.prepare('SELECT status FROM WechatMessage WHERE id = ?').get('wechat-delivery-failure') as { status: string };
    expect(row.status).toBe('PENDING');
  });

  it('returns frequent charge items', () => {
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'CHG-WF', 100, 'PAID')`,
    ).run('charge-wf', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO ChargeItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, name, category, price, quantity, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'charge-wf', 'Exam', 'EXAM', 100, 1, 100)`,
    ).run('item-wf', context.clinicId, now, now);
    const service = new ChargeAssistantService(db);
    expect(service.frequentItems(context).length).toBeGreaterThanOrEqual(1);
  });

  it('covers workflow nullish and non-completion branches', () => {
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, visitId, registeredAt
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-demo-001', NULL, 'REGULAR', 'REGISTERED', 'visit-existing', ?)`,
    ).run('reg-edge-existing-visit', now, now, now);
    const workflow = new ClinicalWorkflowService(db);
    expect(workflow.registrationStatus('reg-edge-existing-visit', 'TRIAGED', nullContext).visitId).toBe('visit-existing');

    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-demo-001', NULL, 'REGULAR', 'REGISTERED', ?)`,
    ).run('reg-edge-create-visit', now, now, now);
    const createdVisit = workflow.registrationStatus('reg-edge-create-visit', 'IN_PROGRESS', nullContext);
    expect(createdVisit.visitId).toBeDefined();

    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, 'IN_PROGRESS')`,
    ).run('visit-edge-cancelled', now, now, now);
    expect(workflow.visitStatus('visit-edge-cancelled', 'CANCELLED', nullContext).status).toBe('CANCELLED');

    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, code, name, category, price, quantity, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'C-EDGE', 'T', 'GENERAL', 100, 1, 'PLANNED')`,
    ).run('treatment-edge-cancelled', now, now);
    expect(workflow.treatmentStatus('treatment-edge-cancelled', 'CANCELLED', nullContext).status).toBe('CANCELLED');
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, code, name, category, price, quantity, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'C-EDGE-2', 'T', 'GENERAL', 100, 1, 'IN_PROGRESS')`,
    ).run('treatment-edge-completed', now, now);
    expect(workflow.treatmentStatus('treatment-edge-completed', 'COMPLETED', nullContext).status).toBe('COMPLETED');

    const replenishment = new ReplenishmentService(db);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, NULL, ?, ?, NULL, 'NULL-STOCK', 'Null Stock', 'MAT', 'box', NULL, NULL, 100)`,
    ).run('item-null-stock', now, now);
    const generated = replenishment.generate(nullContext);
    expect(generated.generated).toBeGreaterThanOrEqual(1);
    const suggestion = db.prepare(
      "SELECT * FROM InventoryReplenishmentSuggestion WHERE inventoryId = 'item-null-stock' AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 1",
    ).get() as { id: string; supplierId: string | null; suggestedQty: number } | undefined;
    expect(suggestion).toBeDefined();
    if (suggestion) {
      const applied = replenishment.applyToPurchaseOrder([suggestion.id], nullContext);
      expect(applied).toHaveProperty('orderId');
    }
    const print = new PrintTemplateService(db);
    expect(print.render('T-1', { title: null }, context)).not.toContain('null');
  });
});
