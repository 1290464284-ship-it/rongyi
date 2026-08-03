import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import {
  ChargeAssistantService,
  ClinicalWorkflowService,
  PrintTemplateService,
  ReplenishmentService,
  WechatService,
} from './workflow-services';
import type { AppContext } from '../../domain/contracts';

describe('workflow services', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
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
    const generated = service.generate(context);
    expect(generated.generated).toBeGreaterThanOrEqual(0);
    const suggestion = db.prepare(
      'SELECT * FROM InventoryReplenishmentSuggestion WHERE deletedAt IS NULL LIMIT 1',
    ).get() as { id: string } | undefined;
    if (suggestion) {
      const result = service.applyToPurchaseOrder([suggestion.id], context);
      expect(result).toHaveProperty('orderId');
    }
  });

  it('sends wechat messages and renders print templates', () => {
    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'TEXT', 'hello', 'PENDING')`,
    ).run('wechat-wf', context.clinicId, now, now);
    const wechat = new WechatService(db);
    expect(wechat.send('wechat-wf', context).status).toBe('SENT');

    db.prepare(
      `INSERT INTO PrintTemplate (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, content
       ) VALUES (?, ?, ?, ?, NULL, 'T-1', 'Template', 'REPORT', '<h1>{{title}}</h1>')`,
    ).run('print-wf', context.clinicId, now, now);
    const print = new PrintTemplateService(db);
    expect(print.list().length).toBeGreaterThanOrEqual(1);
    expect(print.render('T-1', { title: 'Hello' })).toContain('Hello');
  });

  it('returns frequent charge items', () => {
    db.prepare(
      `INSERT INTO ChargeItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, name, category, price, quantity, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'charge', 'Exam', 'EXAM', 100, 1, 100)`,
    ).run('item-wf', context.clinicId, now, now);
    const service = new ChargeAssistantService(db);
    expect(service.frequentItems().length).toBeGreaterThanOrEqual(1);
  });
});

