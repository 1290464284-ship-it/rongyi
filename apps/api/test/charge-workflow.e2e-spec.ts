/**
 * 收费完整流程 E2E 测试
 *
 * 流程：
 *   主收费单：创建患者 → 创建收费单（多项目）→ 组合支付（微信+支付宝）→ 验证状态 → 退款
 *   欠费流程：创建第二张收费单 → 部分支付 → 创建欠费记录 → 结清欠费 → 验证欠费状态
 *   统计验证：调用统计接口验证数据一致性
 *
 * 测试之间共享状态，按顺序执行（jest maxWorkers=1）。
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

describe('Charge Workflow (e2e) - 收费完整流程', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let bossUserId: string;

  // 主流程实体
  let patientId: string;
  let mainChargeId: string;

  // 欠费流程实体
  let debtChargeId: string;
  let debtId: string;

  const tables = [
    'UsedRefreshToken', 'IdempotencyRecord',
    'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FirstExam',
    'DebtPayment', 'Refund', 'ChargeItem', 'DebtRecord', 'Charge',
    'TreatmentPlanItem', 'TreatmentPlan',
    'PrescriptionItem', 'Prescription',
    'Imaging', 'MedicalRecord',
    'MemberCardLog', 'MemberPointLog', 'MemberCard',
    'ProcessingOrder', 'PurchaseOrder', 'TreatmentCatalog', 'Treatment',
    'Visit', 'Appointment', 'ToothRecord', 'Registration', 'WechatMessage', 'OperationLog',
    'Patient', 'User',
  ];

  beforeAll(async () => {
    process.env.TEST_DB_MEMORY = '1';
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    bossUserId = crypto.randomUUID();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(bossUserId, 'boss_charge_wf', hash, '收费流程老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());

    const res = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss_charge_wf', password: TEST_USER_PASSWORD });
    token = extractAccessToken(res);
  });

  afterAll(async () => { await app.close(); });

  it('步骤1：POST /patients - 创建患者', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '收费流程患者', gender: 'MALE', phone: '13722220001' })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    patientId = res.body.id;
  });

  it('步骤2：POST /charge-v2 - 创建收费单（包含多个项目）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/charge-v2').set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        doctorId: bossUserId,
        items: [
          { name: '树脂补牙', category: '修复', price: 300, quantity: 1, teethNumbers: ['16'] },
          { name: '超声波洁牙', category: '预防', price: 200, quantity: 1, teethNumbers: [] },
        ],
      })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('UNPAID');
    expect(Number(res.body.totalAmount)).toBe(500);
    expect(Number(res.body.paidAmount)).toBe(0);
    expect(res.body.items).toHaveLength(2);
    mainChargeId = res.body.id;
  });

  it('步骤3a：PATCH /charge-v2/:id/pay - 微信支付 200（部分支付）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/charge-v2/${mainChargeId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 200, payMethod: 'WECHAT' })
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('PARTIAL');
    expect(Number(res.body.paidAmount)).toBe(200);
  });

  it('步骤3b：PATCH /charge-v2/:id/pay - 支付宝付清余款 300（多种支付方式组合）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/charge-v2/${mainChargeId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 300, payMethod: 'ALIPAY' })
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('PAID');
    expect(Number(res.body.paidAmount)).toBe(500);
  });

  it('步骤4：验证收费单状态为 PAID', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/charge-v2/${mainChargeId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('PAID');
    expect(Number(res.body.totalAmount)).toBe(500);
    expect(Number(res.body.paidAmount)).toBe(500);
    expect(Number(res.body.refundedAmount)).toBe(0);
  });

  it('步骤4b：超额支付返回 400（状态机校验）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/charge-v2/${mainChargeId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 0.01, payMethod: 'CASH' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  // ============ 欠费流程 ============
  it('步骤5a：POST /charge-v2 - 创建第二张收费单用于欠费场景', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/charge-v2').set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        doctorId: bossUserId,
        items: [
          { name: '根管治疗', category: '牙体牙髓', price: 800, quantity: 1, teethNumbers: ['36'] },
          { name: '全冠修复', category: '修复', price: 200, quantity: 1, teethNumbers: ['36'] },
        ],
      })
      .expect(HttpStatus.CREATED);
    expect(Number(res.body.totalAmount)).toBe(1000);
    debtChargeId = res.body.id;
  });

  it('步骤5b：PATCH /charge-v2/:id/pay - 部分支付 400（现金）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/charge-v2/${debtChargeId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 400, payMethod: 'CASH' })
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('PARTIAL');
  });

  it('步骤5c：POST /charge-v2/debts/from-charge - 创建欠费记录', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/charge-v2/debts/from-charge').set('Authorization', `Bearer ${token}`)
      .send({ chargeId: debtChargeId, patientId, totalAmount: 1000, debtAmount: 600, remark: '分期付款' })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.chargeId).toBe(debtChargeId);
    expect(res.body.status).toBe('UNPAID');
    expect(Number(res.body.debtAmount)).toBe(600);
    debtId = res.body.id;
  });

  it('步骤5d：POST /charge-v2/debts/from-charge - 重复创建欠费返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/charge-v2/debts/from-charge').set('Authorization', `Bearer ${token}`)
      .send({ chargeId: debtChargeId, patientId, totalAmount: 1000, debtAmount: 600 })
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  it('步骤6：POST /charge-v2/debts/:id/pay - 结清欠费', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/charge-v2/debts/${debtId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 600, payMethod: 'WECHAT', remark: '结清欠费' })
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('PAID');
    expect(Number(res.body.debtAmount)).toBe(0);
    expect(Number(res.body.paidAmount)).toBe(1000);
  });

  it('步骤6b：欠费结清后再次还款返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/charge-v2/debts/${debtId}/pay`).set('Authorization', `Bearer ${token}`)
      .send({ amount: 100, payMethod: 'CASH' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  // ============ 退款流程 ============
  it('步骤7：POST /refunds - 全额退款（主收费单）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/refunds').set('Authorization', `Bearer ${token}`)
      .send({ chargeId: mainChargeId, patientId, amount: 500, reason: '患者取消治疗，全额退款' })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(Number(res.body.amount)).toBe(500);
  });

  it('步骤7b：验证退款后收费单状态为 REFUNDED', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/charge-v2/${mainChargeId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('REFUNDED');
    expect(Number(res.body.refundedAmount)).toBe(500);
  });

  it('步骤7c：退款金额超过可退金额返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/refunds').set('Authorization', `Bearer ${token}`)
      .send({ chargeId: mainChargeId, patientId, amount: 100, reason: '超额退款' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  // ============ 统计验证 ============
  it('步骤8a：GET /stats/charges - 验证收费统计数据', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stats/charges').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body).toBeDefined();
    expect(typeof res.body).toBe('object');
  });

  it('步骤8b：GET /stats/dashboard - 验证仪表盘统计数据', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/stats/dashboard').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body).toBeDefined();
    expect(typeof res.body).toBe('object');
  });

  it('步骤8c：GET /charge-v2 - 验证收费单列表包含两张收费单', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/charge-v2').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('步骤8d：GET /charge-v2/debts - 验证欠费列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/charge-v2/debts').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const debt = res.body.items.find((d: { id: string }) => d.id === debtId);
    expect(debt).toBeDefined();
    expect(debt.status).toBe('PAID');
  });

  it('步骤8e：GET /refunds - 验证退款列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/refunds').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('未带 token 返回 401', async () => {
    await request(app.getHttpServer()).get('/api/charge-v2').expect(HttpStatus.UNAUTHORIZED);
  });
});
