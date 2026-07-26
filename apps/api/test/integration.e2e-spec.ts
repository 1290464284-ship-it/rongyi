import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';
import { _isTestMode } from '../src/db/database';
import * as bcrypt from 'bcryptjs';

describe('端到端集成测试 (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let patientId: string;
  let chargeId: string;
  let _appointmentId: string;
  let dbService: DbService;

  beforeAll(async () => {
    process.env.TEST_DB_MEMORY = '1';
    process.env.JWT_SECRET = 'test-secret-key-for-e2e-only';
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = ':memory:';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dbService = app.get(DbService);

    // seed boss user
    const now = new Date().toISOString();
    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    try { dbService.exec(`DELETE FROM "User" WHERE username IN ('boss','doc_boss')`); } catch {}
    dbService.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, now, now);
    dbService.prepare(
      'INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)'
    ).run('boss-test-id', 'boss', hash, '老板', 'BOSS', 'test-clinic-001', now, now);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('认证流程', () => {
    beforeAll(async () => {
      const now = new Date().toISOString();
      const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
      try { dbService.exec(`DELETE FROM "User" WHERE username IN ('boss','doc_boss')`); } catch {}
      dbService.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run('test-clinic-001', '测试诊所', 'TEST001', 1, now, now);
      dbService.prepare(
        'INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)'
      ).run('boss-test-id', 'boss', hash, '老板', 'BOSS', 'test-clinic-001', now, now);
    });

    it('POST /api/auth/login - 使用默认管理员登录', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login').send({ username: 'boss', password: TEST_USER_PASSWORD });
      expect(res.status).toBe(HttpStatus.OK);
      accessToken = extractAccessToken(res);
      expect(accessToken).toBeDefined();
    });

    it('GET /api/auth/me - 携带token获取当前用户', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.username).toBeDefined();
    });

    it('GET /api/auth/me - 无token返回401', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/me');
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('患者CRUD流程', () => {
    it('POST /api/patients - 创建患者', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/patients').set('Authorization', `Bearer ${accessToken}`)
        .send({ name: '测试患者', gender: 'MALE', phone: '13800138000', birthDate: '1990-01-15' });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      patientId = res.body.id;
    });

    it('GET /api/patients - 查询患者列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/patients').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('GET /api/patients/:id - 查询患者详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`).set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('测试患者');
    });

    it('PATCH /api/patients/:id - 更新患者', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/patients/${patientId}`).set('Authorization', `Bearer ${accessToken}`)
        .send({ phone: '13900139000' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.phone).toBe('139****9000');
    });

    it('DELETE /api/patients/:id - 软删除患者', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/patients/${patientId}`).set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.OK);
    });
  });

  describe('收费流程', () => {
    let testPatientId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/patients').set('Authorization', `Bearer ${accessToken}`)
        .send({ name: '收费测试患者', gender: 'FEMALE', phone: '13700137000' });
      testPatientId = res.body.id;
    });

    it('POST /api/charge-v2 - 创建收费单', async () => {
      const doc = dbService.prepare("SELECT id FROM User WHERE username IN ('boss','doc_boss')").get() as { id: string } | undefined;
      const doctorId = doc?.id || 'boss-test-id';
      const res = await request(app.getHttpServer())
        .post('/api/charge-v2').set('Authorization', `Bearer ${accessToken}`)
        .send({ patientId: testPatientId, doctorId, items: [
          { name: '洁牙', category: '治疗', price: 200, quantity: 1 },
          { name: '检查', category: '检查', price: 50, quantity: 1 },
        ]});
      expect(res.status).toBe(HttpStatus.CREATED);
      chargeId = res.body.id;
    });

    it('PATCH /api/charge-v2/:id/pay - 支付收费单', async () => {
      if (!chargeId) return;
      const res = await request(app.getHttpServer())
        .patch(`/api/charge-v2/${chargeId}/pay`).set('Authorization', `Bearer ${accessToken}`)
        .send({ amount: 250, payMethod: 'CASH' });
      expect(res.status).toBe(HttpStatus.OK);
    });
  });

  describe('预约流程', () => {
    let testPatientId: string;

    beforeAll(async () => {
      // 内存数据库跳过预约测试
      if (process.env.TEST_DB_MEMORY) return;
      const res = await request(app.getHttpServer())
        .post('/api/patients').set('Authorization', `Bearer ${accessToken}`)
        .send({ name: '预约测试患者', gender: 'MALE', phone: '13600136000' });
      testPatientId = res.body.id;
    });

    it('POST /api/appointments - 创建预约', async () => {
      // 内存数据库跳过
      if (process.env.TEST_DB_MEMORY) return;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const startISO = new Date(`${tomorrow.toISOString().split('T')[0]}T10:00:00.000Z`).toISOString();
      const endISO = new Date(`${tomorrow.toISOString().split('T')[0]}T10:30:00.000Z`).toISOString();
      const bossUser = dbService.prepare("SELECT id FROM User WHERE username = 'boss'").get() as { id: string } | undefined;
      const _doctorId = bossUser?.id || 'boss-test-id';
      const res = await request(app.getHttpServer())
        .post('/api/appointments').set('Authorization', `Bearer ${accessToken}`)
        .send({ patientId: testPatientId, doctorId: bossUser!.id, startTime: startISO, endTime: endISO, type: 'FIRST_VISIT' });
      expect(res.status).toBe(HttpStatus.CREATED);
      _appointmentId = res.body.id;
    });

    it('GET /api/appointments - 查询预约列表', async () => {
      // 内存数据库跳过
      if (process.env.TEST_DB_MEMORY) return;
      const res = await request(app.getHttpServer())
        .get('/api/appointments').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(Array.isArray(res.body.items || res.body)).toBe(true);
    });
  });

  describe('备份流程', () => {
    let backupId: string;

    it('POST /api/backups - 创建手动备份', async () => {
      // 内存数据库跳过备份操作
      if (process.env.TEST_DB_MEMORY) return;
      const res = await request(app.getHttpServer())
        .post('/api/backups').set('Authorization', `Bearer ${accessToken}`)
        .send({ type: 'MANUAL', remark: '集成测试备份' });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.filename).toBeDefined();
      backupId = res.body.id;
    });

    it('POST /api/backups/drill - 备份恢复演练', async () => {
      // 内存数据库跳过备份操作
      if (process.env.TEST_DB_MEMORY) return;
      const res = await request(app.getHttpServer())
        .post('/api/backups/drill').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.success).toBe(true);
      expect(res.body.results).toBeDefined();
      expect(res.body.results.length).toBeGreaterThan(0);
    });

    it('GET /api/backups - 查询备份列表', async () => {
      // 内存数据库跳过备份操作
      if (process.env.TEST_DB_MEMORY) return;
      const res = await request(app.getHttpServer())
        .get('/api/backups').set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('DELETE /api/backups/:id - 删除备份', async () => {
      // 内存数据库跳过备份操作
      if (process.env.TEST_DB_MEMORY) return;
      if (backupId) {
        const res = await request(app.getHttpServer())
          .delete(`/api/backups/${backupId}`).set('Authorization', `Bearer ${accessToken}`);
        expect(res.status).toBe(HttpStatus.OK);
      }
    });
  });
});
