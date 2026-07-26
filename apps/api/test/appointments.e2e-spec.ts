import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, randomFutureISO, addMinutesISO, extractAccessToken } from './test-helpers';

describe('Appointments (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;

  const baseTime = randomFutureISO();
  const baseEnd = addMinutesISO(baseTime, 30);

  const tables = [
    'UsedRefreshToken', 'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FirstExam',
    'ChargeItem', 'DebtPayment', 'Refund',
    'TreatmentPlanItem', 'TreatmentPlan', 'PrescriptionItem', 'Prescription',
    'Imaging', 'MedicalRecord', 'MemberCardLog', 'MemberPointLog', 'MemberCard',
    'ProcessingOrder', 'PurchaseOrder', 'TreatmentCatalog', 'Treatment',
    'Visit', 'Appointment', 'ToothRecord', 'Registration', 'WechatMessage', 'OperationLog',
    'Patient', 'User',
  ];

  async function login() {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: TEST_USER_PASSWORD });
    return extractAccessToken(res);
  }

  async function createPatient(name: string, phone: string) {
    const res = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name, gender: 'MALE', phone });
    return res.body.id as string;
  }

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    const dId = require('crypto').randomUUID();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)').run(dId, 'doc1', hash, '王医生', 'DOCTOR', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;

    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)').run('boss-001', 'boss', hash, '老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());

    token = await login();
    patientId = await createPatient('赵六', '13700137000');
  });

  afterAll(async () => { await app.close(); });

  it('POST /api/appointments 创建预约', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/appointments').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, startTime: baseTime, endTime: baseEnd, type: 'FIRST_VISIT' });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('BOOKED');
    expect(res.body.type).toBe('FIRST_VISIT');
    appointmentId = res.body.id;
  });

  it('POST 同医生同时段冲突检测返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/appointments').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, startTime: addMinutesISO(baseTime, 15), endTime: addMinutesISO(baseTime, 45), type: 'RETURN' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('GET /api/appointments 查询列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/appointments').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/appointments 按医生筛选', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/appointments?doctorId=${doctorId}`).set('Authorization', `Bearer ${token}`);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/appointments/:id 详情', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.id).toBe(appointmentId);
  });

  it('PATCH 状态流转 BOOKED -> ARRIVED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARRIVED' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.status).toBe('ARRIVED');
  });

  it('PATCH 状态流转 ARRIVED -> IN_CHAIR', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_CHAIR' });
    expect(res.body.status).toBe('IN_CHAIR');
  });

  it('PATCH 非法状态流转 IN_CHAIR -> ARRIVED 返回 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARRIVED' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('PATCH 状态流转 IN_CHAIR -> COMPLETED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' });
    expect(res.body.status).toBe('COMPLETED');
  });

  it('未带 token 返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/appointments');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
