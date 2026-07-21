import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { _isTestMode } from '../src/db/database';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

describe('Member Cards (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let patientId: string;
  let cardId: string;

  const tables = [
    'MemberCardLog', 'MemberPointLog', 'MemberCard',
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

    const hash = await bcrypt.hash('REDACTED', 10);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(
      crypto.randomUUID(), 'rec_member', hash, '会员卡测试前台', 'RECEPTIONIST', new Date().toISOString(), new Date().toISOString()
    );

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(
      pId, 'PMEMBER', '会员卡测试患者', 'MALE', '13800000000', new Date().toISOString(), new Date().toISOString()
    );
    patientId = pId;

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'rec_member', password: 'REDACTED' });
    token = res.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  describe('会员卡创建', () => {
    it('POST /member-cards/patient/:patientId - 创建会员卡成功', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/patient/${patientId}`).set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(res.body.patientId).toBe(patientId);
      expect(Number(res.body.balance)).toBe(0);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.cardNo).toMatch(/^MC/);
      cardId = res.body.id;
    });

    it('POST /member-cards/patient/:patientId - 同一患者不能重复创建', async () => {
      await request(app.getHttpServer())
        .post(`/api/member-cards/patient/${patientId}`).set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('充值功能', () => {
    it('POST /member-cards/:id/recharge - 正常充值', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/recharge`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 1000 })
        .expect(201);
      expect(Number(res.body.balance)).toBe(1000);
      expect(Number(res.body.totalRecharge)).toBe(1000);
    });

    it('POST /member-cards/:id/recharge - 多次充值累计正确', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/recharge`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 500 })
        .expect(201);
      expect(Number(res.body.balance)).toBe(1500);
      expect(Number(res.body.totalRecharge)).toBe(1500);
    });

    it('POST /member-cards/:id/recharge - 充值金额为0返回400', async () => {
      await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/recharge`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 0 })
        .expect(400);
    });

    it('POST /member-cards/:id/recharge - 充值金额为负数返回400', async () => {
      await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/recharge`).set('Authorization', `Bearer ${token}`)
        .send({ amount: -100 })
        .expect(400);
    });
  });

  describe('消费功能', () => {
    it('POST /member-cards/:id/consume - 正常消费', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/consume`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 300, remark: '补牙费用' })
        .expect(201);
      expect(Number(res.body.balance)).toBe(1200);
      expect(Number(res.body.totalConsume)).toBe(300);
    });

    it('POST /member-cards/:id/consume - 消费金额不能为0', async () => {
      await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/consume`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 0 })
        .expect(400);
    });

    it('POST /member-cards/:id/consume - 余额不足返回400', async () => {
      await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/consume`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 10000 })
        .expect(400);
    });
  });

  describe('退款功能', () => {
    it('POST /member-cards/:id/refund - 正常退款', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/refund`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 200, remark: '取消项目退款' })
        .expect(201);
      expect(Number(res.body.balance)).toBe(1400);
      expect(Number(res.body.totalConsume)).toBe(100);
    });

    it('POST /member-cards/:id/refund - 退款金额不能为0', async () => {
      await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/refund`).set('Authorization', `Bearer ${token}`)
        .send({ amount: 0 })
        .expect(400);
    });
  });

  describe('积分功能', () => {
    it('POST /member-cards/:id/points - 增加积分', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/points`).set('Authorization', `Bearer ${token}`)
        .send({ points: 100, remark: '消费赠送' })
        .expect(201);
      expect(Number(res.body.points)).toBe(100);
    });

    it('POST /member-cards/:id/points - 多次增加累计正确', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/points`).set('Authorization', `Bearer ${token}`)
        .send({ points: 50, remark: '活动赠送' })
        .expect(201);
      expect(Number(res.body.points)).toBe(150);
    });

    it('POST /member-cards/:id/points/deduct - 扣减积分', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/points/deduct`).set('Authorization', `Bearer ${token}`)
        .send({ points: 30, remark: '兑换礼品' })
        .expect(201);
      expect(Number(res.body.points)).toBe(120);
    });

    it('POST /member-cards/:id/points/deduct - 积分不足返回400', async () => {
      await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/points/deduct`).set('Authorization', `Bearer ${token}`)
        .send({ points: 10000 })
        .expect(400);
    });
  });

  describe('查询功能', () => {
    it('GET /member-cards/patient/:patientId - 获取患者会员卡', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/member-cards/patient/${patientId}`).set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toBeDefined();
      expect(res.body.id).toBe(cardId);
    });

    it('GET /member-cards/:id/logs - 获取余额变动日志', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/member-cards/${cardId}/logs`).set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(4);
    });

    it('GET /member-cards/:id/point-logs - 获取积分变动日志', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/member-cards/${cardId}/point-logs`).set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('GET /member-cards - 分页查询', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/member-cards').set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Number(res.body.total)).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
});
