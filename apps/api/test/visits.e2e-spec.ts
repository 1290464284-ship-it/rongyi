import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import * as crypto from 'crypto';

describe('Visits (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let doctorId: string;
  let patientId: string;
  let appointmentId: string;

  const tables = [
    'UsedRefreshToken','FirstExamFollowUp','FirstExamTooth','FirstExamTrack','FirstExam',
    'ChargeItem','DebtPayment','Refund','TreatmentPlanItem','TreatmentPlan',
    'PrescriptionItem','Prescription','Imaging','MedicalRecord',
    'MemberCardLog','MemberPointLog','MemberCard',
    'ProcessingOrder','PurchaseOrder','TreatmentCatalog','Treatment',
    'Visit','Appointment','ToothRecord','Registration','WechatMessage','OperationLog',
    'Patient','User',
  ];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash('123456', 10);
    const dId = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(dId, 'docv', hash, '陈医生', 'DOCTOR', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run('boss-001', 'boss', hash, '老板', 'BOSS', new Date().toISOString(), new Date().toISOString());

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: '123456' });
    token = res.body.access_token;

    const pRes = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '孙七', gender: 'FEMALE', phone: '13800138888' });
    patientId = pRes.body.id;

    const aRes = await request(app.getHttpServer())
      .post('/api/appointments').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, startTime: '2026-08-02T10:00:00.000Z', endTime: '2026-08-02T10:30:00.000Z', type: 'FIRST_VISIT' });
    appointmentId = aRes.body.id;
  });

  afterAll(async () => { await app.close(); });

  it('POST /visits - 从预约创建就诊', () => {
    return request(app.getHttpServer())
      .post('/api/visits').set('Authorization', `Bearer ${token}`)
      .send({ appointmentId, patientId, doctorId, chiefComplaint: '牙痛' })
      .expect(201)
      .expect((res) => { expect(res.body.status).toBe('IN_PROGRESS'); });
  });

  it('GET /visits - 查询列表', () => {
    return request(app.getHttpServer())
      .get(`/api/visits?patientId=${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body.total).toBe(1); });
  });

  it('未带 token 返回 401', () => {
    return request(app.getHttpServer()).get('/api/visits').expect(401);
  });
});
