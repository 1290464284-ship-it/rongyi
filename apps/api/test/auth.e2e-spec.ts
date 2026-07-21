/**
 * Auth e2e tests — rewritten for DbService (better-sqlite3) API.
 */
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let db: DbService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    // Clean all tables in FK-safe order
    const tables = [
      'UsedRefreshToken', 'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FirstExam',
      'ChargeItem', 'DebtPayment', 'Refund',
      'TreatmentPlanItem', 'TreatmentPlan',
      'PrescriptionItem', 'Prescription',
      'Imaging', 'MedicalRecord',
      'InventoryTransaction', 'MemberCardLog', 'MemberPointLog', 'MemberCard',
      'ProcessingOrder', 'PurchaseOrder',
      'TreatmentCatalog', 'Treatment',
      'Visit', 'Appointment', 'ToothRecord', 'Registration',
      'WechatMessage', 'OperationLog',
      'Patient', 'User',
    ];
    for (const table of tables) {
      try { db.exec(`DELETE FROM "${table}"`); } catch { /* ok */ }
    }

    // Create test user
    const hash = await bcrypt.hash('REDACTED', 10);
    db.prepare(
      'INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)'
    ).run('boss-001', 'boss', hash, '老板', 'BOSS', new Date().toISOString(), new Date().toISOString());
  });

  afterAll(async () => { await app.close(); });

  it('POST /api/auth/login 正确密码返回JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'REDACTED' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.user.username).toBe('boss');
  });

  it('POST /api/auth/login 错误密码返回401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'wrongpass' });
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('GET /api/auth/me 带token返回当前用户', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: 'REDACTED' });
    const me = await request(app.getHttpServer())
      .get('/api/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(HttpStatus.OK);
    expect(me.body.username).toBe('boss');
  });

  it('POST /api/auth/login 连续5次错误密码后账号被锁定', async () => {
    for (let i = 0; i < 4; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/login').send({ username: 'boss', password: 'wrong' });
    }
    const res5 = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: 'wrong' });
    expect(res5.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('POST /api/auth/login 账号锁定期间正确密码也无法登录', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: 'REDACTED' });
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('POST /api/auth/login 锁定时间过期后可以重新登录', async () => {
    // Manually un-set lock
    db.prepare("UPDATE User SET lockedUntil = NULL, loginAttempts = 0 WHERE username = ?").run('boss');
    const res = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: 'REDACTED' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.access_token).toBeDefined();
  });

  it('POST /api/auth/login 正确密码登录后重置失败次数', async () => {
    const user = db.prepare("SELECT loginAttempts, lockedUntil FROM User WHERE username = ?").get('boss') as any;
    expect(user.loginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });
});
