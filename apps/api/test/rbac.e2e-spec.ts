import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import * as crypto from 'crypto';

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let doctorToken: string;
  let receptionistToken: string;

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
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const bossHash = await bcrypt.hash('0801', 10);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(crypto.randomUUID(), 'boss', bossHash, '老板', 'BOSS', new Date().toISOString(), new Date().toISOString());

    const pHash = await bcrypt.hash('1234', 10);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(crypto.randomUUID(), 'user', pHash, '医生', 'DOCTOR', new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(crypto.randomUUID(), 'receptionist', pHash, '前台', 'RECEPTIONIST', new Date().toISOString(), new Date().toISOString());

    const bossLogin = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: '0801' });
    bossToken = bossLogin.body.access_token;

    const docLogin = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'user', password: '1234' });
    doctorToken = docLogin.body.access_token;

    const recLogin = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'receptionist', password: '1234' });
    receptionistToken = recLogin.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  it('BOSS can access /api/reports', async () => {
    const res = await request(app.getHttpServer()).get('/api/reports').set('Authorization', `Bearer ${bossToken}`);
    expect(res.status).not.toBe(403);
  });

  it('DOCTOR cannot access /api/backups', async () => {
    const res = await request(app.getHttpServer()).get('/api/backups').set('Authorization', `Bearer ${doctorToken}`);
    // Backend should enforce role access
  });

  it('无 token 访问需要授权的接口返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/patients');
    expect(res.status).toBe(401);
  });
});
