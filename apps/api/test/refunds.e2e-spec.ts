import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';
import { _isTestMode } from '../src/db/database';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

describe('Refunds (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let bossUserId: string;
  let patientId: string;
  let chargeId: string;

  const tables = [
    'IdempotencyRecord', 'Refund', 'ChargeItem', 'Charge',
    'Patient', 'User', 'OperationLog',
  ];

  beforeAll(async () => {
    process.env.TEST_DB_MEMORY = '1';
    (_isTestMode as any) = true;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    bossUserId = crypto.randomUUID();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)').run(
      bossUserId, 'boss_refund', hash, '退款测试老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString()
    );

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?,?,?,?,?,?,1,?,?)').run(
      pId, 'PREFUND', '退款测试患者', 'FEMALE', '13900000000', 'test-clinic-001', new Date().toISOString(), new Date().toISOString()
    );
    patientId = pId;

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss_refund', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(res);

    const chargeRes = await request(app.getHttpServer())
      .post('/api/charge-v2').set('Authorization', `Bearer ${bossToken}`)
      .send({
        patientId,
        doctorId: bossUserId,
        items: [{ name: '根管治疗', category: '牙体牙髓', price: 2000, quantity: 1, teethNumbers: ['36'] }],
      });
    chargeId = chargeRes.body.id;

    await request(app.getHttpServer())
      .patch(`/api/charge-v2/${chargeId}/pay`).set('Authorization', `Bearer ${bossToken}`)
      .send({ amount: 2000, payMethod: 'CASH' });
  });

  afterAll(async () => { await app.close(); });

  describe('退款创建', () => {
    it('POST /refunds - 正常退款', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/refunds').set('Authorization', `Bearer ${bossToken}`)
        .send({ chargeId, patientId, amount: 500, reason: '患者取消部分项目' })
        .expect(201);
      expect(Number(res.body.amount)).toBe(500);
      expect(res.body.id).toBeDefined();
    });

    it('POST /refunds - 退款后收费单退款金额正确', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/charge-v2/${chargeId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(Number(res.body.refundedAmount)).toBe(500);
    });

    it('POST /refunds - 退款金额不能超过已付金额', async () => {
      const overRes = await request(app.getHttpServer())
        .post('/api/refunds').set('Authorization', `Bearer ${bossToken}`)
        .send({ chargeId, patientId, amount: 10000, reason: '超额退款' })
        .expect(400);
      expect(overRes.status).toBe(400);
    });

    it('POST /refunds - 退款金额必须大于0', async () => {
      const zeroRes = await request(app.getHttpServer())
        .post('/api/refunds').set('Authorization', `Bearer ${bossToken}`)
        .send({ chargeId, patientId, amount: 0, reason: '零元退款' })
        .expect(400);
      expect(zeroRes.status).toBe(400);
    });

    it('POST /refunds - 不存在的收费单返回404', async () => {
      const notFoundRes = await request(app.getHttpServer())
        .post('/api/refunds').set('Authorization', `Bearer ${bossToken}`)
        .send({ chargeId: 'nonexistent-id', patientId, amount: 100, reason: '测试' })
        .expect(404);
      expect(notFoundRes.status).toBe(404);
    });
  });

  describe('退款查询', () => {
    let refundId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/refunds').set('Authorization', `Bearer ${bossToken}`)
        .send({ chargeId, patientId, amount: 200, reason: '第二次退款' });
      refundId = res.body.id;
    });

    it('GET /refunds - 分页查询退款记录', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/refunds').set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(Number(res.body.total)).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('GET /refunds - 按患者筛选', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/refunds?patientId=${patientId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(Number(res.body.total)).toBeGreaterThanOrEqual(2);
    });

    it('GET /refunds - 按收费单筛选', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/refunds?chargeId=${chargeId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(Number(res.body.total)).toBeGreaterThanOrEqual(2);
    });

    it('GET /refunds/:id - 获取退款详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/refunds/${refundId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(res.body.id).toBe(refundId);
      expect(Number(res.body.amount)).toBe(200);
    });

    it('GET /refunds/:id - 不存在的退款单返回404', async () => {
      const notFoundRes = await request(app.getHttpServer())
        .get('/api/refunds/nonexistent-id').set('Authorization', `Bearer ${bossToken}`)
        .expect(404);
      expect(notFoundRes.status).toBe(404);
    });
  });

  describe('幂等性测试', () => {
    let idemChargeId: string;

    beforeAll(async () => {
      const chargeRes = await request(app.getHttpServer())
        .post('/api/charge-v2').set('Authorization', `Bearer ${bossToken}`)
        .send({
          patientId,
          doctorId: bossUserId,
          items: [{ name: '洗牙', category: '牙周', price: 300, quantity: 1 }],
        });
      idemChargeId = chargeRes.body.id;
      await request(app.getHttpServer())
        .patch(`/api/charge-v2/${idemChargeId}/pay`).set('Authorization', `Bearer ${bossToken}`)
        .send({ amount: 300, payMethod: 'CASH' });
    });

    it('POST /refunds - 相同 requestId 不重复退款', async () => {
      const requestId = crypto.randomUUID();

      const res1 = await request(app.getHttpServer())
        .post('/api/refunds').set('Authorization', `Bearer ${bossToken}`)
        .send({ chargeId: idemChargeId, patientId, amount: 100, reason: '幂等性测试', requestId })
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post('/api/refunds').set('Authorization', `Bearer ${bossToken}`)
        .send({ chargeId: idemChargeId, patientId, amount: 100, reason: '幂等性测试', requestId })
        .expect(201);

      expect(Number(res1.body.amount)).toBe(Number(res2.body.amount));
      expect(res1.body.id).toBe(res2.body.id);
    });
  });
});
