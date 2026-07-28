import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { TEST_USER_PASSWORD, randomFutureISO, addMinutesISO, extractAccessToken } from '../test-helpers';

describe('Appointment Workflow (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let patientId: string;
  let doctorId: string;
  let chairId: string;
  let appointmentId: string;

  const tables = [
    'UsedRefreshToken', 'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FirstExam',
    'ChargeItem', 'DebtPayment', 'Refund',
    'TreatmentPlanItem', 'TreatmentPlan', 'PrescriptionItem', 'Prescription',
    'Imaging', 'MedicalRecord', 'MemberCardLog', 'MemberPointLog', 'MemberCard',
    'ProcessingOrder', 'PurchaseOrder', 'TreatmentCatalog', 'Treatment',
    'Visit', 'Appointment', 'ToothRecord', 'Registration', 'WechatMessage', 'OperationLog',
    'Chair', 'Equipment', 'Patient', 'User',
  ];

  const baseTime = randomFutureISO();
  const baseEnd = addMinutesISO(baseTime, 30);

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

    const dId = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(dId, 'doc_appt', hash, '王医生', 'DOCTOR', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;

    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run('boss-001', 'boss', hash, '老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());

    const login = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: TEST_USER_PASSWORD });
    token = extractAccessToken(login);

    const pRes = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '赵六', gender: 'MALE', phone: '13700137000' });
    patientId = pRes.body.id;

    const cId = crypto.randomUUID();
    db.prepare('INSERT INTO Chair (id, name, active, clinicId, createdAt) VALUES (?,?,?,?,?)')
      .run(cId, '1号牙椅', 1, 'test-clinic-001', new Date().toISOString());
    chairId = cId;
  });

  afterAll(async () => { await app.close(); });

  describe('预约完整流程', () => {
    it('步骤1: 创建患者（已在 beforeAll 中完成）', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('赵六');
    });

    it('步骤2: 创建医生（已在 beforeAll 中完成）', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/users')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      const users = Array.isArray(res.body.items) ? res.body.items : res.body;
      const doctor = users.find((u: any) => u.id === doctorId);
      expect(doctor).toBeDefined();
      expect(doctor.name).toBe('王医生');
      expect(doctor.role).toBe('DOCTOR');
    });

    it('步骤3: 创建椅位（已在 beforeAll 中完成）', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/chairs')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.items.some((c: any) => c.id === chairId)).toBe(true);
    });

    it('步骤4: 创建预约', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/appointments').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          doctorId,
          chairId,
          startTime: baseTime,
          endTime: baseEnd,
          type: 'FIRST_VISIT',
          remark: '新患者初诊',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('BOOKED');
      expect(res.body.type).toBe('FIRST_VISIT');
      expect(res.body.patientId).toBe(patientId);
      expect(res.body.doctorId).toBe(doctorId);
      expect(res.body.chairId).toBe(chairId);
      appointmentId = res.body.id;
    });

    it('步骤4: 创建预约 - 同医生同时段冲突检测', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/appointments').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          doctorId,
          startTime: addMinutesISO(baseTime, 15),
          endTime: addMinutesISO(baseTime, 45),
          type: 'RETURN',
        });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('步骤5: 修改预约（改约）', async () => {
      const newStartTime = addMinutesISO(baseTime, 60);
      const newEndTime = addMinutesISO(newStartTime, 30);
      const res = await request(app.getHttpServer())
        .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
        .send({
          startTime: newStartTime,
          endTime: newEndTime,
          remark: '改约至下午2点',
        });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.startTime).toBe(newStartTime);
      expect(res.body.endTime).toBe(newEndTime);
      expect(res.body.remark).toBe('改约至下午2点');
      expect(res.body.status).toBe('BOOKED');
    });

    it('步骤6: 取消预约', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
        .send({ status: 'CANCELLED' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('步骤6: 取消后重新预约', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/appointments').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          doctorId,
          chairId,
          startTime: addMinutesISO(baseTime, 120),
          endTime: addMinutesISO(baseTime, 150),
          type: 'RETURN',
          remark: '重新预约',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.status).toBe('BOOKED');
      appointmentId = res.body.id;
    });

    it('步骤7: 完成预约（状态流转）', async () => {
      const arrivedRes = await request(app.getHttpServer())
        .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
        .send({ status: 'ARRIVED' });
      expect(arrivedRes.status).toBe(HttpStatus.OK);
      expect(arrivedRes.body.status).toBe('ARRIVED');

      const inChairRes = await request(app.getHttpServer())
        .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
        .send({ status: 'IN_CHAIR' });
      expect(inChairRes.status).toBe(HttpStatus.OK);
      expect(inChairRes.body.status).toBe('IN_CHAIR');

      const completedRes = await request(app.getHttpServer())
        .patch(`/api/appointments/${appointmentId}`).set('Authorization', `Bearer ${token}`)
        .send({ status: 'COMPLETED' });
      expect(completedRes.status).toBe(HttpStatus.OK);
      expect(completedRes.body.status).toBe('COMPLETED');
    });

    it('步骤8: 查询预约列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/appointments')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBe(2);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('步骤8: 按患者筛选预约', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/appointments?patientId=${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBe(2);
    });

    it('步骤8: 按医生筛选预约', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/appointments?doctorId=${doctorId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBe(2);
    });

    it('步骤9: 查询预约详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/appointments/${appointmentId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBe(appointmentId);
      expect(res.body.patientId).toBe(patientId);
      expect(res.body.doctorId).toBe(doctorId);
      expect(res.body.chairId).toBe(chairId);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.type).toBe('RETURN');
    });

    it('步骤9: 验证预约状态流转的完整性', async () => {
      const row = db.prepare('SELECT status, createdAt, updatedAt FROM Appointment WHERE id = ?').get(appointmentId) as any;
      expect(row.status).toBe('COMPLETED');
      expect(row.createdAt).not.toBeNull();
      expect(row.updatedAt).not.toBeNull();
    });
  });

  describe('边界情况验证', () => {
    it('创建预约缺少必填字段返回400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/appointments').set('Authorization', `Bearer ${token}`)
        .send({ patientId });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('非法状态流转被拒绝', async () => {
      const newAppt = await request(app.getHttpServer())
        .post('/api/appointments').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          doctorId,
          startTime: addMinutesISO(baseTime, 300),
          endTime: addMinutesISO(baseTime, 330),
          type: 'FIRST_VISIT',
        });

      const res = await request(app.getHttpServer())
        .patch(`/api/appointments/${newAppt.body.id}`).set('Authorization', `Bearer ${token}`)
        .send({ status: 'COMPLETED' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('未带token访问返回401', async () => {
      const res = await request(app.getHttpServer()).get('/api/appointments');
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('删除预约（软删除）', async () => {
      const newAppt = await request(app.getHttpServer())
        .post('/api/appointments').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          doctorId,
          startTime: addMinutesISO(baseTime, 400),
          endTime: addMinutesISO(baseTime, 430),
          type: 'CONSULTATION',
        });
      expect(newAppt.status).toBe(HttpStatus.CREATED);
      expect(newAppt.body.id).toBeDefined();

      const res = await request(app.getHttpServer())
        .delete(`/api/appointments/${newAppt.body.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);

      const row = db.prepare('SELECT deletedAt FROM Appointment WHERE id = ?').get(newAppt.body.id) as any;
      expect(row.deletedAt).not.toBeNull();
    });
  });
});