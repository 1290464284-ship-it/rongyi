import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import * as crypto from 'crypto';

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

    const hash = await bcrypt.hash('123456', 10);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run('boss-001', 'boss', hash, '老板', 'BOSS', new Date().toISOString(), new Date().toISOString());

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: '123456' });
    token = res.body.access_token;

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
      .expect(200);
  });

  it('DELETE /tooth-records/:toothNumber - 删除牙位记录', () => {
    return request(app.getHttpServer())
      .delete(`/api/tooth-records/16?patientId=${patientId}`).set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('未带 token 返回 401', () => {
    return request(app.getHttpServer()).get('/api/tooth-records').expect(401);
  });
});
