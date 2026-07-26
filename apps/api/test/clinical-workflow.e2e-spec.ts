/**
 * 临床就诊完整流程 E2E 测试
 *
 * 流程：创建患者 → 创建初诊记录 → 挂号 → 开始接诊（创建就诊） →
 *       创建病历 → 创建治疗记录 → 创建治疗计划 → 结束接诊 → 验证数据关联
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

describe('Clinical Workflow (e2e) - 临床就诊完整流程', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let doctorId: string;

  // 流程中共享的业务实体 ID
  let patientId: string;
  let firstExamId: string;
  let registrationId: string;
  let visitId: string;
  let medicalRecordId: string;
  let treatmentId: string;
  let treatmentPlanId: string;

  const tables = [
    'UsedRefreshToken', 'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FirstExam',
    'ChargeItem', 'DebtPayment', 'Refund',
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
    const dId = crypto.randomUUID();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(dId, 'doc_clinical_wf', hash, '临床流程医生', 'DOCTOR', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;

    const bId = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(bId, 'boss_clinical_wf', hash, '临床流程老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());

    const res = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss_clinical_wf', password: TEST_USER_PASSWORD });
    token = extractAccessToken(res);
  });

  afterAll(async () => { await app.close(); });

  it('步骤1：POST /patients - 创建患者', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '临床流程患者', gender: 'FEMALE', phone: '13711110001' })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('临床流程患者');
    patientId = res.body.id;
  });

  it('步骤2：POST /first-exams - 创建初诊记录', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/first-exams').set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        doctorId,
        chiefComplaint: '右上后牙冷热刺激痛一周',
        diagnosis: '16深龋',
        treatmentSuggestion: '16树脂充填',
      })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.patientId).toBe(patientId);
    expect(res.body.status).toBe('DRAFT');
    firstExamId = res.body.id;
  });

  it('步骤3：POST /registrations - 挂号', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/registrations').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, type: 'FIRST_VISIT', chiefComplaint: '右上后牙冷热刺激痛一周' })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('REGISTERED');
    expect(res.body.patientId).toBe(patientId);
    expect(res.body.doctorId).toBe(doctorId);
    registrationId = res.body.id;
  });

  it('步骤4：PATCH /registrations/:id/start-visit - 开始接诊（创建就诊记录）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/registrations/${registrationId}/start-visit`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.visitId).toBeDefined();
    visitId = res.body.visitId;
  });

  it('开始接诊后再次调用应幂等返回（visitId 不变）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/registrations/${registrationId}/start-visit`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.visitId).toBe(visitId);
  });

  it('步骤5：POST /medical-records - 创建病历（关联就诊）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/medical-records').set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        visitId,
        doctorId,
        chiefComplaint: '右上后牙冷热刺激痛一周',
        presentIllness: '患者一周前出现右上后牙冷热刺激痛，无自发痛',
        examination: '16合面深龋，探诊敏感，冷测+，叩诊-',
        diagnosis: '16深龋',
        treatmentPlan: '16树脂充填治疗',
        teethInvolved: ['16'],
      })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.patientId).toBe(patientId);
    expect(res.body.visitId).toBe(visitId);
    medicalRecordId = res.body.id;
  });

  it('步骤6：POST /treatments - 创建治疗记录（关联就诊）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/treatments').set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        visitId,
        doctorId,
        code: 'D2391',
        name: '树脂充填-后牙',
        category: '修复',
        price: 300,
        quantity: 1,
        teethNumbers: [16],
        remark: '16树脂充填',
      })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.patientId).toBe(patientId);
    treatmentId = res.body.id;
  });

  it('步骤7：POST /treatment-plans - 创建治疗计划（关联就诊）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/treatment-plans').set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        visitId,
        doctorId,
        name: '16树脂充填治疗方案',
        items: [
          { code: 'D2391', name: '树脂充填-后牙', category: '修复', price: 300, quantity: 1, teethNumbers: [16] },
          { code: 'D1110', name: '超声波洁牙', category: '预防', price: 150, quantity: 1, teethNumbers: [] },
        ],
      })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.patientId).toBe(patientId);
    treatmentPlanId = res.body.id;
  });

  it('步骤8：PATCH /visits/:id/complete - 结束接诊', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/visits/${visitId}/complete`).set('Authorization', `Bearer ${token}`)
      .send({ diagnosis: '16深龋，已完成树脂充填' })
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.endTime).toBeDefined();
  });

  it('步骤8b：PATCH /registrations/:id/complete - 完成挂号', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/registrations/${registrationId}/complete`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('步骤9：验证各步骤的数据关联正确性', async () => {
    // 9.1 患者详情
    const patientRes = await request(app.getHttpServer())
      .get(`/api/patients/${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(patientRes.body.id).toBe(patientId);

    // 9.2 初诊详情
    const examRes = await request(app.getHttpServer())
      .get(`/api/first-exams/${firstExamId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(examRes.body.patientId).toBe(patientId);
    expect(examRes.body.doctorId).toBe(doctorId);

    // 9.3 就诊详情
    const visitRes = await request(app.getHttpServer())
      .get(`/api/visits/${visitId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(visitRes.body.id).toBe(visitId);
    expect(visitRes.body.patientId).toBe(patientId);
    expect(visitRes.body.status).toBe('COMPLETED');

    // 9.4 挂号详情 - visitId 已回填
    const regRes = await request(app.getHttpServer())
      .get(`/api/registrations/${registrationId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(regRes.body.visitId).toBe(visitId);
    expect(regRes.body.status).toBe('COMPLETED');

    // 9.5 病历列表按患者查询 - 应包含刚创建的病历
    const recordsRes = await request(app.getHttpServer())
      .get(`/api/medical-records?patientId=${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(recordsRes.body.total).toBeGreaterThanOrEqual(1);
    const record = recordsRes.body.items.find((r: { id: string }) => r.id === medicalRecordId);
    expect(record).toBeDefined();
    expect(record.visitId).toBe(visitId);

    // 9.6 治疗记录按患者查询
    const treatmentsRes = await request(app.getHttpServer())
      .get(`/api/treatments?patientId=${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(treatmentsRes.body.total).toBeGreaterThanOrEqual(1);
    const treatment = treatmentsRes.body.items.find((t: { id: string }) => t.id === treatmentId);
    expect(treatment).toBeDefined();

    // 9.7 治疗计划按患者查询
    const plansRes = await request(app.getHttpServer())
      .get(`/api/treatment-plans?patientId=${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(plansRes.body.total).toBeGreaterThanOrEqual(1);
    const plan = plansRes.body.items.find((p: { id: string }) => p.id === treatmentPlanId);
    expect(plan).toBeDefined();
  });

  it('状态机校验：已完成的就诊不能再次完成', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/visits/${visitId}/complete`).set('Authorization', `Bearer ${token}`)
      .send({ diagnosis: '尝试重复完成' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  it('状态机校验：已完成的挂号不能再次开始接诊', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/registrations/${registrationId}/start-visit`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  it('未带 token 返回 401', async () => {
    await request(app.getHttpServer()).get('/api/visits').expect(HttpStatus.UNAUTHORIZED);
  });
});
