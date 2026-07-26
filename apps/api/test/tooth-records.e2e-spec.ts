import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

describe('ToothRecords (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
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
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)').run('boss-001', 'boss', hash, '老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: TEST_USER_PASSWORD });
    token = extractAccessToken(res);

    const pRes = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '周八', gender: 'MALE', phone: '13900139999' });
    patientId = pRes.body.id;
  });

  afterAll(async () => { await app.close(); });

  it('POST /tooth-records - 创建牙位记录（16号牙龋齿）', () => {
    return request(app.getHttpServer())
      .post('/api/tooth-records').set('Authorization', `Bearer ${token}`)
      .send({ patientId, toothNumber: 16, currentStatus: 'DECAYED', conditions: ['DECAY'], remark: '远中邻面龋' })
      .expect(201)
      .expect((res) => {
        expect(res.body.toothNumber).toBe(16);
        expect(res.body.currentStatus).toBe('DECAYED');
      });
  });

  it('POST /tooth-records - 同牙位再写入为更新', () => {
    return request(app.getHttpServer())
      .post('/api/tooth-records').set('Authorization', `Bearer ${token}`)
      .send({ patientId, toothNumber: 16, currentStatus: 'FILLED', conditions: ['FILLING'] })
      .expect(201)
      .expect((res) => { expect(res.body.currentStatus).toBe('FILLED'); });
  });

  it('GET /tooth-records - 按患者查询', () => {
    return request(app.getHttpServer())
      .get(`/api/tooth-records?patientId=${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body.items.length).toBeGreaterThanOrEqual(1); });
  });

  it('DELETE /tooth-records/:toothNumber - 删除牙位记录', () => {
    return request(app.getHttpServer())
      .delete(`/api/tooth-records/16?patientId=${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => { expect(res.body).toBeDefined(); });
  });

  it('未带 token 返回 401', () => {
    return request(app.getHttpServer()).get('/api/tooth-records').expect(401);
  });
});
