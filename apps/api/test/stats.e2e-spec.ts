import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

/**
 * 统计报表模块 HTTP E2E 测试。
 * 覆盖 GET /api/stats/dashboard、/api/stats/revenue、/api/stats/doctor-workload，
 * 并验证未登录返回 401、RECEPTIONIST 无权访问 doctor-workload 返回 403。
 */
describe('Stats (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let receptionistToken: string;

  const tablesForCleanup = [
    'UsedRefreshToken', 'ChargeItem', 'DebtPayment', 'Refund',
    'Visit', 'Appointment', 'Patient', 'User', 'OperationLog',
  ];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const table of tablesForCleanup) {
      try { db.exec(`DELETE FROM "${table}"`); } catch { /* ok */ }
    }

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, now, now);

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'boss', hash, '老板', 'BOSS', 'test-clinic-001', now, now);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'receptionist', hash, '前台', 'RECEPTIONIST', 'test-clinic-001', now, now);

    const bossLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(bossLogin);

    const recLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'receptionist', password: TEST_USER_PASSWORD });
    receptionistToken = extractAccessToken(recLogin);
  });

  afterAll(async () => { await app.close(); });

  it('GET /api/stats/dashboard 获取仪表盘数据', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stats/dashboard')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toBeDefined();
    expect(typeof res.body).toBe('object');
  });

  it('GET /api/stats/revenue 获取收入统计', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stats/revenue')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toBeDefined();
  });

  it('GET /api/stats/revenue 支持日期范围与分组参数', async () => {
    const start = '2026-01-01';
    const end = '2026-12-31';
    const res = await request(app.getHttpServer())
      .get(`/api/stats/revenue?startDate=${start}&endDate=${end}&groupBy=month`)
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toBeDefined();
  });

  it('GET /api/stats/doctor-workload 获取医生工作量', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stats/doctor-workload')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toBeDefined();
  });

  it('GET /api/stats/patient-growth 获取患者增长统计', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stats/patient-growth')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toBeDefined();
  });

  it('未带 token 访问返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/stats/dashboard');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('RECEPTIONIST 无权访问 doctor-workload 返回 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stats/doctor-workload')
      .set('Authorization', `Bearer ${receptionistToken}`);
    expect(res.status).toBe(HttpStatus.FORBIDDEN);
  });
});
