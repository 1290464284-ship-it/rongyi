import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import * as crypto from 'crypto';

describe('Prescriptions (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let patientId: string;
  let doctorId: string;

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
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(dId, 'doc_rx', hash, '处方测试医生', 'DOCTOR', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(pId, 'PRX001', '处方测试患者', 'MALE', '13800000001', new Date().toISOString(), new Date().toISOString());
    patientId = pId;

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'doc_rx', password: '123456' });
    token = res.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  it('POST /prescriptions - 创建处方', () => {
    return request(app.getHttpServer())
      .post('/api/prescriptions').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, items: [
        { drugName: '阿莫西林', spec: '0.5g*24', dosage: '1片', frequency: '每日3次', days: 7, quantity: 21, unit: '片' },
      ]})
      .expect(201)
      .expect((res) => { expect(res.body.patientId).toBe(patientId); });
  });

  it('GET /prescriptions - 分页查询', () => {
    return request(app.getHttpServer())
      .get('/api/prescriptions').set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body.total).toBe(1); });
  });

  it('POST /prescriptions - 空明细返回 400', () => {
    return request(app.getHttpServer())
      .post('/api/prescriptions').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, items: [] })
      .expect(400);
  });
});
