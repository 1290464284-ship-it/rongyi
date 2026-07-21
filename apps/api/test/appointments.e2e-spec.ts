import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';

describe('Appointments (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;

  const baseTime = '2026-08-01T09:00:00.000Z';
  const baseEnd = '2026-08-01T09:30:00.000Z';

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
      .post('/api/auth/login').send({ username: 'boss', password: '123456' });
    return res.body.access_token as string;
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

    const hash = await bcrypt.hash('123456', 10);
    const dId = require('crypto').randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(dId, 'doc1', hash, '王医生', 'DOCTOR', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;

    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run('boss-001', 'boss', hash, '老板', 'BOSS', new Date().toISOString(), new Date().toISOString());

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
      .send({ patientId, doctorId, startTime: '2026-08-01T09:15:00.000Z', endTime: '2026-08-01T09:45:00.000Z', type: 'RETURN' });
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
