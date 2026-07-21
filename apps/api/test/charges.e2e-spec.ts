import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { _isTestMode } from '../src/db/database';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

describe('Charges (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let patientId: string;
  let doctorId: string;
  let chargeId: string;

  const tables = [
    'UsedRefreshToken','FirstExamFollowUp','FirstExamTooth','FirstExamTrack','FirstExam',
    'ChargeItem','DebtPayment','Refund','TreatmentPlanItem','TreatmentPlan',
    'PrescriptionItem','Prescription','Imaging','MedicalRecord',
    'MemberCardLog','MemberPointLog','MemberCard',
    'ProcessingOrder','PurchaseOrder','TreatmentCatalog','Treatment',
    'Visit','Appointment','ToothRecord','Registration','WechatMessage','OperationLog',
    'Patient','User','Charge',
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

    const hash = await bcrypt.hash('REDACTED', 10);
    const dId = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(dId, 'doc_charge', hash, '收费测试医生', 'DOCTOR', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(pId, 'PCHARGE', '收费测试患者', 'MALE', '13700000000', new Date().toISOString(), new Date().toISOString());
    patientId = pId;

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'doc_charge', password: 'REDACTED' });
    token = res.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  it('POST /charge-v2 - 创建收费单', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/api/charge-v2').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, items: [
        { name: '树脂补牙', category: '修复', price: 300, quantity: 1, teethNumbers: [16] },
        { name: '超声波洁牙', category: '预防', price: 150, quantity: 1, teethNumbers: [] },
      ]})
      .expect(201);
    expect(res1.body.patientId).toBe(patientId);
    expect(res1.body.status).toBe('UNPAID');
    chargeId = res1.body.id;

    // 二次创建，total 应为 2
    await request(app.getHttpServer())
      .post('/api/charge-v2').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, items: [
        { name: '检查', category: '检查', price: 50, quantity: 1, teethNumbers: [] },
      ]}).expect(201);
  });

  it('POST /charges - 空明细返回 400', () => {
    return request(app.getHttpServer())
      .post('/api/charge-v2').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, items: [] })
      .expect(400);
  });

  it('GET /charges - 分页查询', () => {
    return request(app.getHttpServer())
      .get('/api/charge-v2').set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body.total).toBeGreaterThanOrEqual(1); });
  });

  it('GET /charges/:id - 获取详情', () => {
    return request(app.getHttpServer())
      .get(`/api/charge-v2/${chargeId}`).set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body.id).toBe(chargeId); });
  });

  it('PATCH /charges/:id/pay - 部分支付', () => {
    return request(app.getHttpServer())
      .patch(`/api/charge-v2/${chargeId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 200, payMethod: 'WECHAT' })
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('PARTIAL');
        expect(Number(res.body.paidAmount)).toBe(200);
      });
  });

  it('PATCH /charges/:id/pay - 付清余款', () => {
    return request(app.getHttpServer())
      .patch(`/api/charge-v2/${chargeId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 250, payMethod: 'ALIPAY' })
      .expect(200)
      .expect((res) => { expect(res.body.status).toBe('PAID'); });
  });

  it('PATCH /charges/:id/pay - 超额支付返回 400', () => {
    // 已经付清 (PAID)，再付应返回 400
    return request(app.getHttpServer())
      .patch(`/api/charge-v2/${chargeId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 0.01, payMethod: 'CASH' })
      .expect(400);
  });
});
