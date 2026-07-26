import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';
import * as crypto from 'crypto';

describe('Treatments (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let doctorId: string;
  let patientId: string;

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

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    const dId = crypto.randomUUID();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)').run(dId, 'doct', hash, '刘医生', 'DOCTOR', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?,?,?,?,?,?,1,?,?)').run(pId, 'PTRT', '吴九', 'FEMALE', '13600136666', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());
    patientId = pId;

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'doct', password: TEST_USER_PASSWORD });
    token = extractAccessToken(res);
  });

  afterAll(async () => { await app.close(); });

  it('POST /treatments - 创建治疗', () => {
    return request(app.getHttpServer())
      .post('/api/treatments').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, code: 'D1110', name: '树脂补牙', category: '修复', price: 300, teethNumbers: [16, 17] })
      .expect(201)
      .expect((res) => { expect(res.body.status).toBe('PLANNED'); });
  });

  it('GET /treatments - 按患者查询', () => {
    return request(app.getHttpServer())
      .get(`/api/treatments?patientId=${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body.total).toBe(1); });
  });

  it('GET /treatments - 按牙位查询', () => {
    return request(app.getHttpServer())
      .get(`/api/treatments?patientId=${patientId}&toothNumber=16`).set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body.total).toBe(1); });
  });

  it('未带 token 返回 401', () => {
    return request(app.getHttpServer()).get('/api/treatments').expect(401);
  });
});
