import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from '../test-helpers';

describe('Member Card Workflow (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let patientId: string;
  let cardId: string;

  const tables = [
    'UsedRefreshToken', 'MemberCardLog', 'MemberPointLog', 'MemberCard',
    'Patient', 'User', 'OperationLog',
  ];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'rec_member', hash, '会员卡测试前台', 'RECEPTIONIST', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?,?,?,?,?,?,1,?,?)')
      .run(pId, 'PMEMBER', '会员卡测试患者', 'MALE', '13800000000', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());
    patientId = pId;

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'rec_member', password: TEST_USER_PASSWORD });
    token = extractAccessToken(res);
  });

  afterAll(async () => { await app.close(); });

  describe('会员卡完整流程', () => {
    it('步骤1: 创建患者（已在 beforeAll 中完成）', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('会员卡测试患者');
    });

    it('步骤2: 创建会员卡（办卡）', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/patient/${patientId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.CREATED);
      expect(res.body.patientId).toBe(patientId);
      expect(Number(res.body.balance)).toBe(0);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.cardNo).toMatch(/^MC/);
      cardId = res.body.id;
    });

    it('步骤2: 同一患者不能重复创建会员卡', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/patient/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('步骤3: 充值', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/recharge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 1000 })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.balance)).toBe(1000);
      expect(Number(res.body.totalRecharge)).toBe(1000);
    });

    it('步骤3: 多次充值累计正确', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/recharge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 500 })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.balance)).toBe(1500);
      expect(Number(res.body.totalRecharge)).toBe(1500);
    });

    it('步骤3: 充值金额为0返回400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/recharge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 0 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('步骤3: 充值金额为负数返回400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/recharge`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: -100 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('步骤4: 消费（使用余额）', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/consume`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 300, remark: '补牙费用' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.balance)).toBe(1200);
      expect(Number(res.body.totalConsume)).toBe(300);
    });

    it('步骤4: 消费金额不能为0', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/consume`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 0 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('步骤4: 余额不足返回400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/consume`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 10000 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('步骤4: 增加积分', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/points`)
        .set('Authorization', `Bearer ${token}`)
        .send({ points: 100, remark: '消费赠送' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.points)).toBe(100);
    });

    it('步骤4: 多次增加积分累计正确', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/points`)
        .set('Authorization', `Bearer ${token}`)
        .send({ points: 50, remark: '活动赠送' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.points)).toBe(150);
    });

    it('步骤4: 扣减积分（使用积分消费）', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/points/deduct`)
        .set('Authorization', `Bearer ${token}`)
        .send({ points: 30, remark: '兑换礼品' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.points)).toBe(120);
    });

    it('步骤4: 积分不足返回400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/points/deduct`)
        .set('Authorization', `Bearer ${token}`)
        .send({ points: 10000 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('步骤5: 查询会员卡信息', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/member-cards/patient/${patientId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      expect(res.body).toBeDefined();
      expect(res.body.id).toBe(cardId);
      expect(res.body.patientId).toBe(patientId);
      expect(res.body.cardNo).toMatch(/^MC/);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('步骤5: 查询会员卡列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/member-cards')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      expect(Number(res.body.total)).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('步骤6: 查询余额变动记录', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/member-cards/${cardId}/logs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);

      const rechargeLogs = res.body.filter((log: any) => log.type === 'RECHARGE');
      expect(rechargeLogs.length).toBe(2);

      const consumeLogs = res.body.filter((log: any) => log.type === 'CONSUME');
      expect(consumeLogs.length).toBe(1);
    });

    it('步骤6: 查询积分变动记录', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/member-cards/${cardId}/point-logs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);

      const addLogs = res.body.filter((log: any) => log.type === 'ADD');
      expect(addLogs.length).toBe(2);

      const deductLogs = res.body.filter((log: any) => log.type === 'DEDUCT');
      expect(deductLogs.length).toBe(1);
    });

    it('步骤7: 验证余额变动记录的完整性', async () => {
      const logs = await request(app.getHttpServer())
        .get(`/api/member-cards/${cardId}/logs`)
        .set('Authorization', `Bearer ${token}`);

      let balance = 0;
      const sortedLogs = [...logs.body].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      for (const log of sortedLogs) {
        if (log.type === 'RECHARGE') {
          balance += Number(log.amount);
        } else if (log.type === 'CONSUME') {
          balance += Number(log.amount);
        } else if (log.type === 'REFUND') {
          balance += Number(log.amount);
        }
        expect(Number(log.balanceAfter)).toBe(balance);
      }

      const cardInfo = await request(app.getHttpServer())
        .get(`/api/member-cards/patient/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(Number(cardInfo.body.balance)).toBe(balance);
    });

    it('步骤7: 验证积分变动记录的完整性', async () => {
      const logs = await request(app.getHttpServer())
        .get(`/api/member-cards/${cardId}/point-logs`)
        .set('Authorization', `Bearer ${token}`);

      let points = 0;
      const sortedLogs = [...logs.body].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      for (const log of sortedLogs) {
        points += Number(log.points);
        expect(Number(log.balanceAfter)).toBe(points);
      }

      const cardInfo = await request(app.getHttpServer())
        .get(`/api/member-cards/patient/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(Number(cardInfo.body.points)).toBe(points);
    });

    it('步骤7: 验证会员卡总充值和总消费', async () => {
      const cardInfo = await request(app.getHttpServer())
        .get(`/api/member-cards/patient/${patientId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(Number(cardInfo.body.totalRecharge)).toBe(1500);
      expect(Number(cardInfo.body.totalConsume)).toBe(300);
      expect(Number(cardInfo.body.balance)).toBe(1200);
      expect(Number(cardInfo.body.points)).toBe(120);
    });
  });

  describe('边界情况验证', () => {
    it('充值到不存在的会员卡返回404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/member-cards/not-exist-id/recharge')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 100 });
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('消费到不存在的会员卡返回404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/member-cards/not-exist-id/consume')
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 100 });
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('为不存在的患者创建会员卡返回404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/member-cards/patient/not-exist-id')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('未带token访问返回401', async () => {
      const res = await request(app.getHttpServer()).get('/api/member-cards');
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('退款功能', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/refund`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 200, remark: '取消项目退款' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.balance)).toBe(1400);
      expect(Number(res.body.totalConsume)).toBe(100);
    });

    it('退款金额不能为0', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/member-cards/${cardId}/refund`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: 0 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});