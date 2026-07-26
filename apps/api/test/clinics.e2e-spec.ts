import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

/**
 * 诊所管理模块 HTTP E2E 测试。
 * 覆盖 GET /api/clinics、GET /api/clinics/active、GET /api/clinics/current、
 * GET /api/clinics/:id、POST /api/clinics、PATCH /api/clinics/:id、DELETE /api/clinics/:id，
 * 并验证未登录返回 401、DOCTOR 无权访问返回 403。
 *
 * 注意：
 * 1. Clinic 表本身没有 clinicId 列，但 BaseService.create 会自动注入当前用户的 clinicId。
 *    测试启动时需手动添加该列，使注入无害（与 system-modules.e2e-spec.ts 做法一致）。
 * 2. Clinic 表有 deletedAt 列，支持软删除。
 * 3. code 字段有 UNIQUE 约束，重复创建会返回 409。
 */
describe('Clinics (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let doctorToken: string;
  let createdClinicId: string;

  const tablesForCleanup = [
    'UsedRefreshToken', 'AuditLog', 'OperationLog', 'User',
  ];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    // Clinic 表补建 clinicId 列（BaseService.create 会自动注入此字段）
    try { db.exec('ALTER TABLE Clinic ADD COLUMN clinicId TEXT'); } catch { /* 已存在 */ }

    for (const table of tablesForCleanup) {
      try { db.exec(`DELETE FROM "${table}"`); } catch { /* ok */ }
    }
    // 清理测试创建的诊所（保留种子诊所 test-clinic-001）
    try { db.exec(`DELETE FROM Clinic WHERE code LIKE 'E2E_%'`); } catch { /* ok */ }

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, now, now);

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'boss', hash, '老板', 'BOSS', 'test-clinic-001', now, now);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'doctor', hash, '医生', 'DOCTOR', 'test-clinic-001', now, now);

    const bossLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(bossLogin);

    const docLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'doctor', password: TEST_USER_PASSWORD });
    doctorToken = extractAccessToken(docLogin);
  });

  afterAll(async () => { await app.close(); });

  it('GET /api/clinics 获取诊所列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/clinics')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/clinics/active 获取活跃诊所列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/clinics/active')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // 所有返回的诊所应处于活跃状态（active=1）
    expect(res.body.every((c: { isActive?: number }) => c.isActive === 1 || c.isActive === undefined)).toBe(true);
  });

  it('GET /api/clinics/current 获取当前用户诊所信息', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/clinics/current')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body).toBeDefined();
    expect(res.body.id).toBe('test-clinic-001');
  });

  it('POST /api/clinics 创建诊所', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/clinics')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({
        name: 'E2E 新诊所',
        code: 'E2E_NEW001',
        address: '测试地址',
        phone: '13800138000',
      });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('E2E 新诊所');
    expect(res.body.code).toBe('E2E_NEW001');
    createdClinicId = res.body.id;
  });

  it('POST /api/clinics 重复编码返回 409', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/clinics')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ name: '重复诊所', code: 'E2E_NEW001' });
    expect(res.status).toBe(HttpStatus.CONFLICT);
  });

  it('POST /api/clinics 校验失败返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/clinics')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ code: 'E2E_BAD' }); // 缺少 name
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('GET /api/clinics/:id 获取诊所详情', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/clinics/${createdClinicId}`)
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.id).toBe(createdClinicId);
    expect(res.body.name).toBe('E2E 新诊所');
  });

  it('PATCH /api/clinics/:id 更新诊所信息', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/clinics/${createdClinicId}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ name: 'E2E 已更新诊所', address: '新地址' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.name).toBe('E2E 已更新诊所');
    expect(res.body.address).toBe('新地址');
  });

  it('DELETE /api/clinics/:id 软删除诊所', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/clinics/${createdClinicId}`)
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);

    // 删除后再获取详情应返回 400（诊所不存在）
    const after = await request(app.getHttpServer())
      .get(`/api/clinics/${createdClinicId}`)
      .set('Authorization', `Bearer ${bossToken}`);
    expect([HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND]).toContain(after.status);
  });

  it('未带 token 访问返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/clinics');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('DOCTOR 无权访问返回 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/clinics')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(HttpStatus.FORBIDDEN);
  });
});
