import { INestApplication, VersioningType, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import cookieParser = require('cookie-parser');
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { resetTestMode, setTestMode } from '../../src/db/database';

describe('Core Modules Smoke Test', () => {
  let app: INestApplication;
  let dbService: DbService;
  let authToken: string;
  const TEST_PASSWORD = '123456';
  const CLINIC_ID = 'test-clinic-smoke';

  function extractAccessToken(res: { headers: Record<string, unknown> }): string {
    const setCookie = res.headers['set-cookie'];
    if (!setCookie) throw new Error('登录响应中缺少 Set-Cookie 头');
    const cookies = Array.isArray(setCookie) ? (setCookie as string[]) : [setCookie as string];
    const tokenCookie = cookies.find((c) => c.startsWith('access_token='));
    if (!tokenCookie) throw new Error('Set-Cookie 中缺少 access_token');
    return tokenCookie.split('=')[1].split(';')[0];
  }

  beforeAll(async () => {
    resetTestMode();
    setTestMode(true);
    process.env.TEST_DB_MEMORY = '1';
    process.env.JWT_SECRET = 'TestJwtSecret2026ForDentalClinicApp0801abcXYZ9988';
    process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'api/v',
    });
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    dbService = app.get(DbService);

    dbService.prepare(
      'INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(CLINIC_ID, '测试诊所', 'SMOKE001', 1, new Date().toISOString(), new Date().toISOString());

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    dbService.prepare(
      'INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)'
    ).run(userId, 'smoke_boss', passwordHash, '烟雾测试管理员', 'BOSS', CLINIC_ID, new Date().toISOString(), new Date().toISOString());

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'smoke_boss', password: TEST_PASSWORD });

    authToken = extractAccessToken(loginRes);
  });

  afterAll(async () => {
    await app.close();
    resetTestMode();
    setTestMode(false);
    delete process.env.TEST_DB_MEMORY;
  });

  describe('用户认证模块', () => {
    it('应该能正常登录', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'smoke_boss', password: TEST_PASSWORD })
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.headers['set-cookie']).toBeDefined();
    });

    it('应该能获取当前用户信息', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', `access_token=${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('username', 'smoke_boss');
      expect(response.body).toHaveProperty('role', 'BOSS');
    });

    it('错误密码应该登录失败', async () => {
       
      const invalidPassword = 'wrong_password_123';
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'smoke_boss', password: invalidPassword })
        .expect(401);
      expect(response.body.message).toBeDefined();
    });
  });

  describe('患者模块', () => {
    let patientId: string;

    it('应该能创建患者', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Cookie', `access_token=${authToken}`)
        .send({
          name: '烟雾测试患者',
          gender: 'MALE',
          phone: '13800000001',
          birthDate: '1990-01-01',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', '烟雾测试患者');
      patientId = response.body.id;
    });

    it('应该能获取患者列表', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/patients')
        .set('Cookie', `access_token=${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
      expect(response.body.items.length).toBeGreaterThan(0);
    });

    it('应该能获取单个患者详情', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/patients/${patientId}`)
        .set('Cookie', `access_token=${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', patientId);
      expect(response.body).toHaveProperty('name', '烟雾测试患者');
    });

    it('应该能更新患者信息', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/patients/${patientId}`)
        .set('Cookie', `access_token=${authToken}`)
        .send({
          name: '烟雾测试患者-更新',
          remark: '烟雾测试备注',
        })
        .expect(200);

      expect(response.body).toHaveProperty('name', '烟雾测试患者-更新');
    });
  });

  describe('收费模块', () => {
    let patientId: string;
    let chargeId: string;

    beforeAll(async () => {
      const patientRes = await request(app.getHttpServer())
        .post('/api/v1/patients')
        .set('Cookie', `access_token=${authToken}`)
        .send({
          name: '收费测试患者',
          gender: 'FEMALE',
          phone: '13800000002',
          birthDate: '1995-06-15',
        });
      patientId = patientRes.body.id;
    });

    it('应该能创建收费单', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/charge-v2')
        .set('Cookie', `access_token=${authToken}`)
        .send({
          patientId,
          items: [
            { name: '挂号费', quantity: 1, price: 5000 },
            { name: '检查费', quantity: 1, price: 10000 },
          ],
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('totalAmount');
      expect(response.body.totalAmount).toBe(15000);
      chargeId = response.body.id;
    });

    it('应该能获取收费单列表', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/charge-v2')
        .set('Cookie', `access_token=${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('应该能获取单个收费单详情', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/charge-v2/${chargeId}`)
        .set('Cookie', `access_token=${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('id', chargeId);
      expect(response.body).toHaveProperty('patientId', patientId);
    });
  });
});
