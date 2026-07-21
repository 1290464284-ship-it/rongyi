import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import * as crypto from 'crypto';

describe('TreatmentPlans (e2e)', () => {
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
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash('123456', 10);
    const dId = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(dId, 'doc_plan', hash, '赵医生', 'DOCTOR', new Date().toISOString(), new Date().toISOString());
    doctorId = dId;

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(pId, 'PPLAN', '孙小红', 'FEMALE', '13900139001', new Date().toISOString(), new Date().toISOString());
    patientId = pId;

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'doc_plan', password: '123456' });
    token = res.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  it('POST /treatment-plans - 创建治疗计划', () => {
    return request(app.getHttpServer())
      .post('/api/treatment-plans').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, name: '正畸治疗方案', items: [
        { code: 'T001', name: '超声波洁牙', category: '预防', price: 150, quantity: 1, teethNumbers: [] },
        { code: 'T002', name: '树脂补牙', category: '修复', price: 300, quantity: 2, teethNumbers: [16, 26] },
      ]})
      .expect(201)
      .expect((res) => { expect(res.body.name).toBe('正畸治疗方案'); });
  });

  it('POST /treatment-plans - 空明细返回 400', () => {
    return request(app.getHttpServer())
      .post('/api/treatment-plans').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, name: '空计划', items: [] })
      .expect(400);
  });

  it('GET /treatment-plans - 分页查询', () => {
    return request(app.getHttpServer())
      .get('/api/treatment-plans').set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body.total).toBe(1); });
  });

  it('未带 token 返回 401', () => {
    return request(app.getHttpServer()).get('/api/treatment-plans').expect(401);
  });
});
