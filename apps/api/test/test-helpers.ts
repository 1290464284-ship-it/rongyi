/**
 * E2E Test Helper — creates an in-memory SQLite database for each test suite.
 *
 * Usage in test files:
 *   import { setupTestApp, teardownTestApp, withTestUser } from './test-helpers';
 *
 *   let app: INestApplication;
 *   let db: Database;
 *
 *   beforeAll(async () => {
 *     ({ app, db } = await setupTestApp());
 *     await withTestUser(db, { username: 'boss', password: 'REDACTED' });
 *   });
 *   afterAll(async () => { await teardownTestApp(app); });
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { resetTestMode, _isTestMode } from '../src/db/database';
import Database from 'better-sqlite3';

export async function setupTestApp(): Promise<{ app: INestApplication; dbService: DbService }> {
  resetTestMode();
  _isTestMode = true;
  // Force in-memory database for tests
  process.env.TEST_DB_MEMORY = '1';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  const dbService = app.get(DbService);

  // Clean all tables in FK-safe order (children first)
  const tables = [
    'UsedRefreshToken', 'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FirstExam',
    'PurchaseOrderItem', 'ProcessingOrderItem', 'ProcessingFlowLog',
    'ChargeItem', 'DebtPayment', 'Refund',
    'FollowUp', 'AutoFollowUpRule', 'FollowUpItem', 'FollowUpResult', 'FollowUpTemplate',
    'OralExamination', 'PeriodontalRecord',
    'TreatmentPlanItem', 'TreatmentPlan',
    'PrescriptionItem', 'Prescription',
    'Imaging', 'MedicalRecord', 'MedicalRecordPhrase', 'MedicalRecordTemplate', 'RecordModifyRequest',
    'InventoryTransaction', 'InventoryItem', 'Supplier',
    'MemberCardLog', 'MemberPointLog', 'MemberCard',
    'MemberDiscountItem', 'MemberDiscountPlan', 'Promotion',
    'ProcessingOrder', 'ProcessingProduct', 'ProcessingFactory',
    'PurchaseOrder', 'InventoryStockCheck',
    'TreatmentCatalog', 'Treatment',
    'Visit', 'Appointment', 'ToothRecord', 'Registration',
    'WechatMessage', 'SmsLog', 'Invoice',
    'OperationLog', 'BackupRecord',
    'Chair', 'Equipment',
    'Patient', 'Family', 'User',
  ];
  for (const table of tables) {
    try { dbService.exec(`DELETE FROM "${table}"`); } catch { /* table may not exist yet */ }
  }

  return { app, dbService };
}

export async function teardownTestApp(app: INestApplication): Promise<void> {
  await app.close();
  resetTestMode();
  _isTestMode = false;
  delete process.env.TEST_DB_MEMORY;
}

export interface TestUser {
  username: string;
  password: string;
  name: string;
  role: string;
  accessToken?: string;
  refreshToken?: string;
}

export async function withTestUser(
  dbService: DbService,
  opts: { username: string; password: string; name?: string; role?: string },
): Promise<TestUser> {
  const hash = await bcrypt.hash(opts.password, 10);
  const id = require('crypto').randomUUID();
  dbService.prepare(
    'INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)'
  ).run(id, opts.username, hash, opts.name || '测试用户', opts.role || 'BOSS', new Date().toISOString(), new Date().toISOString());
  return { username: opts.username, password: opts.password, name: opts.name || '测试用户', role: opts.role || 'BOSS' };
}

export function extractToken(authHeader: string): string {
  return authHeader.replace('Bearer ', '');
}
