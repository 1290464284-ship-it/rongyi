import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { _isTestMode } from '../src/db/database';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

describe('Charge V2 - Combos & Payment Methods & Debts (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let userId: string;
  let patientId: string;
  let chargeId: string;
  let comboId: string;
  let paymentMethodId: string;
  let debtId: string;

  const tables = [
    'ChargeItem', 'Charge', 'ChargeCombo', 'PaymentMethod',
    'DebtRecord', 'DebtPayment',
    'Patient', 'User', 'OperationLog',
  ];

  beforeAll(async () => {
    process.env.TEST_DB_MEMORY = '1';
    _isTestMode = true;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash('123456', 10);
    userId = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(
      userId, 'doc_charge2', hash, '收费测试医生2', 'DOCTOR', new Date().toISOString(), new Date().toISOString()
    );

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(
      pId, 'PCHARGE2', '收费测试患者2', 'MALE', '13600000000', new Date().toISOString(), new Date().toISOString()
    );
    patientId = pId;

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'doc_charge2', password: '123456' });
    token = res.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  describe('收费组合管理', () => {
    it('POST /charge-v2/combos - 创建收费组合', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/charge-v2/combos').set('Authorization', `Bearer ${token}`)
        .send({
          name: '洁牙套餐',
          category: '预防保健',
          items: [{ itemName: '洁牙', price: 200, quantity: 1 }],
        })
        .expect(201);
      expect(res.body.id).toBeDefined();
      comboId = res.body.id;
    });

    it('GET /charge-v2/combos - 获取组合列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/charge-v2/combos').set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('PATCH /charge-v2/combos/:id - 更新收费组合', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/charge-v2/combos/${comboId}`).set('Authorization', `Bearer ${token}`)
        .send({ name: '洁牙套餐(升级版)', isPublic: true })
        .expect(200);
      expect(res.body.id).toBe(comboId);
    });

    it('DELETE /charge-v2/combos/:id - 删除收费组合', async () => {
      const tempRes = await request(app.getHttpServer())
        .post('/api/charge-v2/combos').set('Authorization', `Bearer ${token}`)
        .send({ name: '临时组合', category: '临时', items: [{ itemName: '临时项目', price: 100, quantity: 1 }] });
      const tempId = tempRes.body.id;

      await request(app.getHttpServer())
        .delete(`/api/charge-v2/combos/${tempId}`).set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('缴费方式管理', () => {
    it('POST /charge-v2/payment-methods - 创建缴费方式', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/charge-v2/payment-methods').set('Authorization', `Bearer ${token}`)
        .send({ name: '微信支付', code: 'WECHAT' })
        .expect(201);
      expect(res.body.id).toBeDefined();
      paymentMethodId = res.body.id;
    });

    it('GET /charge-v2/payment-methods - 获取缴费方式列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/charge-v2/payment-methods').set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('PATCH /charge-v2/payment-methods/:id - 更新缴费方式', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/charge-v2/payment-methods/${paymentMethodId}`).set('Authorization', `Bearer ${token}`)
        .send({ name: '微信支付(公众号)' })
        .expect(200);
      expect(res.body.id).toBe(paymentMethodId);
    });

    it('PATCH /charge-v2/payment-methods/:id/toggle - 启用/禁用缴费方式', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/charge-v2/payment-methods/${paymentMethodId}/toggle`).set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.id).toBe(paymentMethodId);
    });

    it('DELETE /charge-v2/payment-methods/:id - 删除缴费方式', async () => {
      const tempRes = await request(app.getHttpServer())
        .post('/api/charge-v2/payment-methods').set('Authorization', `Bearer ${token}`)
        .send({ name: '临时方式', code: 'TEMP' });
      const tempId = tempRes.body.id;

      await request(app.getHttpServer())
        .delete(`/api/charge-v2/payment-methods/${tempId}`).set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('欠费管理', () => {
    beforeAll(async () => {
      const chargeRes = await request(app.getHttpServer())
        .post('/api/charge-v2').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          doctorId: userId,
          items: [{ name: '正畸治疗', category: '正畸', price: 5000, quantity: 1, teethNumbers: [] }],
        });
      chargeId = chargeRes.body.id;
    });

    it('POST /charge-v2/debts/from-charge - 从收费单创建欠费记录', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/charge-v2/debts/from-charge').set('Authorization', `Bearer ${token}`)
        .send({ chargeId, patientId, totalAmount: 5000, debtAmount: 3000 })
        .expect(201);
      expect(res.body.id).toBeDefined();
      debtId = res.body.id;
    });

    it('POST /charge-v2/debts/from-charge - 同一收费单不能重复创建欠费', async () => {
      await request(app.getHttpServer())
        .post('/api/charge-v2/debts/from-charge').set('Authorization', `Bearer ${token}`)
        .send({ chargeId, patientId, totalAmount: 5000, debtAmount: 3000 })
        .expect(400);
    });

    it('GET /charge-v2/debts - 获取欠费列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/charge-v2/debts').set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /charge-v2/debts/stats - 获取欠费统计', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/charge-v2/debts/stats').set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.totalDebt).toBeGreaterThanOrEqual(3000);
    });

    it('GET /charge-v2/debts/:id - 获取欠费详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/charge-v2/debts/${debtId}`).set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.id).toBe(debtId);
      expect(Number(res.body.debtAmount)).toBe(3000);
    });

    it('POST /charge-v2/debts/:id/pay - 部分还款', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/charge-v2/debts/${debtId}/pay`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 1000 })
        .expect(200);
      expect(res.body.paid).toBe(1000);
    });

    it('POST /charge-v2/debts/:id/pay - 还清余款', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/charge-v2/debts/${debtId}/pay`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 2000 })
        .expect(200);
      expect(res.body.paid).toBe(3000);
    });

    it('POST /charge-v2/debts/:id/pay - 超额还款返回400', async () => {
      await request(app.getHttpServer())
        .post(`/api/charge-v2/debts/${debtId}/pay`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 100 })
        .expect(400);
    });
  });

  describe('收费幂等性测试', () => {
    let testChargeId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/charge-v2').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          doctorId: userId,
          items: [{ name: '补牙', category: '修复', price: 800, quantity: 1, teethNumbers: [26] }],
        });
      testChargeId = res.body.id;
    });

    it('PATCH /charge-v2/:id/pay - 相同 requestId 不重复支付', async () => {
      const requestId = crypto.randomUUID();

      const res1 = await request(app.getHttpServer())
        .patch(`/api/charge-v2/${testChargeId}/pay`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 400, payMethod: 'CASH', requestId })
        .expect(200);

      const res2 = await request(app.getHttpServer())
        .patch(`/api/charge-v2/${testChargeId}/pay`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 400, payMethod: 'CASH', requestId })
        .expect(200);

      expect(res1.body.id).toBe(res2.body.id);
      expect(Number(res1.body.paidAmount)).toBe(Number(res2.body.paidAmount));
    });
  });
});
