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
 *     await withTestUser(db, { username: 'boss', password: TEST_USER_PASSWORD });
 *   });
 *   afterAll(async () => { await teardownTestApp(app); });
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { resetTestMode, setTestMode } from '../src/db/database';

/** 测试用默认登录密码（4 位数字，符合系统校验规则） */
export const TEST_USER_PASSWORD = '123456';

/**
 * 从登录响应的 Set-Cookie 头中提取 access_token。
 * D2-4 安全加固后，login 端点不再在响应体中返回 token，仅通过 httpOnly cookie 传递。
 */
export function extractAccessToken(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('登录响应中缺少 Set-Cookie 头');
  const cookies = Array.isArray(setCookie) ? (setCookie as string[]) : [setCookie as string];
  const tokenCookie = cookies.find((c) => c.startsWith('access_token='));
  if (!tokenCookie) throw new Error('Set-Cookie 中缺少 access_token');
  return tokenCookie.split('=')[1].split(';')[0];
}

export async function setupTestApp(): Promise<{ app: INestApplication; dbService: DbService }> {
  resetTestMode();
  setTestMode(true);
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
  setTestMode(false);
  resetTestMode();
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
  opts: { username: string; password?: string; name?: string; role?: string; clinicId?: string },
): Promise<TestUser> {
  const password = opts.password || TEST_USER_PASSWORD;
  const hash = await bcrypt.hash(password, 10);
  const id = require('crypto').randomUUID();
  const clinicId = opts.clinicId || 'test-clinic-001';
  // Ensure clinic exists
  dbService.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(clinicId, '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
  dbService.prepare(
    'INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)'
  ).run(id, opts.username, hash, opts.name || '测试用户', opts.role || 'BOSS', clinicId, new Date().toISOString(), new Date().toISOString());
  return { username: opts.username, password, name: opts.name || '测试用户', role: opts.role || 'BOSS' };
}

export function extractToken(authHeader: string): string {
  return authHeader.replace('Bearer ', '');
}

/** 生成一个未来的随机 ISO 日期字符串（默认从今天起 1~365 天内） */
export function randomFutureISO(daysAheadMax = 365): string {
  const now = new Date();
  const offsetMs = Math.floor(Math.random() * daysAheadMax * 24 * 60 * 60 * 1000) + 60 * 60 * 1000;
  const date = new Date(now.getTime() + offsetMs);
  date.setMinutes(0, 0, 0);
  return date.toISOString();
}

/** 在指定 ISO 时间上增加若干分钟 */
export function addMinutesISO(iso: string, minutes: number): string {
  const date = new Date(iso);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}
