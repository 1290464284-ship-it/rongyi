import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

/**
 * 全局搜索模块 HTTP E2E 测试。
 * 覆盖 GET /api/search?q=xxx，验证搜索结果返回、手机号脱敏、
 * 短关键词返回空数组、未登录返回 401。
 *
 * 注意：SearchController 使用 @Query('q') 而非 keyword；
 * 当关键词长度 < 2 时控制器直接返回 []（HTTP 200），而非 400。
 */
describe('Search (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;

  const tablesForCleanup = [
    'UsedRefreshToken', 'Visit', 'Appointment', 'Patient', 'User', 'OperationLog',
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

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: TEST_USER_PASSWORD });
    token = extractAccessToken(login);

    // 创建患者用于搜索验证
    await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '张三丰', gender: 'MALE', phone: '13800138000' });
  });

  afterAll(async () => { await app.close(); });

  it('GET /api/search?q=张三 全局搜索返回匹配结果', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?q=张三')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.patients.length).toBeGreaterThanOrEqual(1);
    expect(res.body.patients[0].name).toBe('张三丰');
  });

  it('搜索结果中手机号已脱敏', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?q=张三')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    const patient = res.body.patients[0];
    if (patient.phone) {
      // 脱敏格式：前 3 位 + **** + 后 4 位
      expect(patient.phone).toMatch(/^\d{3}\*+\d{4}$/);
      expect(patient.phone).not.toBe('13800138000');
    }
  });

  it('短关键词（少于 2 个字符）返回空数组', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?q=x')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('无匹配关键词返回空结果', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/search?q=ZZZ_NO_MATCH')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBe(0);
    expect(res.body.patients.length).toBe(0);
  });

  it('未带 token 访问返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/search?q=张');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
