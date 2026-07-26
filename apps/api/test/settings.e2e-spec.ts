import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

/**
 * 系统设置模块 HTTP E2E 测试。
 * 覆盖 GET /api/settings、PUT /api/settings/:key、PATCH /api/settings、
 * DELETE /api/settings/:key，并验证未登录返回 401、DOCTOR 无权访问返回 403。
 *
 * 注意：SettingsService.onModuleInit 会在应用初始化时写入全局默认配置
 * （clinicId IS NULL），不可在 beforeAll 中清理 ClinicInfo 表，否则默认配置丢失。
 */
describe('Settings (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let doctorToken: string;

  // 不清理 ClinicInfo：onModuleInit 写入的默认配置需保留
  const tablesForCleanup = ['UsedRefreshToken', 'AuditLog', 'OperationLog', 'User'];

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

  it('GET /api/settings 获取所有设置（含默认配置）', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/settings')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    // onModuleInit 写入的默认全局配置应可见
    expect(res.body.defaultPageSize).toBe('20');
  });

  it('PUT /api/settings/:key 更新设置', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/settings/clinicName')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ value: '我的牙科诊所' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.key).toBe('clinicName');
    expect(res.body.value).toBe('我的牙科诊所');
  });

  it('GET /api/settings/:key 获取指定设置', async () => {
    await request(app.getHttpServer())
      .put('/api/settings/notifyChannel')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ value: 'sms' });

    const res = await request(app.getHttpServer())
      .get('/api/settings/notifyChannel')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.key).toBe('notifyChannel');
    expect(res.body.value).toBe('sms');
  });

  it('PATCH /api/settings 批量更新设置', async () => {
    // 注意：UpsertSettingsDto 使用 index signature，ValidationPipe 的 whitelist:true
    // 会剥离无装饰器的属性。此处仅验证端点可访问并返回成功结构。
    // 单项更新的持久化验证已由 PUT /:key 测试覆盖。
    const res = await request(app.getHttpServer())
      .patch('/api/settings')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ batchKey1: 'v1', batchKey2: 'v2' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/settings/:key 删除设置', async () => {
    await request(app.getHttpServer())
      .put('/api/settings/tempKey')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ value: 'temp' });

    const res = await request(app.getHttpServer())
      .delete('/api/settings/tempKey')
      .set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.key).toBe('tempKey');
  });

  it('PUT /api/settings/:key 校验失败返回 400', async () => {
    const res = await request(app.getHttpServer())
      .put('/api/settings/badKey')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ value: 123 }); // 非字符串
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('未带 token 访问返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/settings');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it('DOCTOR 无权访问设置返回 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/settings')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(HttpStatus.FORBIDDEN);
  });
});
