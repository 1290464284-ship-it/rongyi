import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import * as crypto from 'crypto';

describe('Imaging (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let patientId: string;
  let doctorId: string;
  let imagingId: string;

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

    const hash = await bcrypt.hash('0801', 10);
    const uid = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(uid, 'boss', hash, '老板', 'BOSS', new Date().toISOString(), new Date().toISOString());
    doctorId = uid;

    const pId = crypto.randomUUID();
    db.prepare('INSERT INTO Patient (id, code, name, gender, phone, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(pId, 'P0001', '测试患者', 'MALE', '13800000001', new Date().toISOString(), new Date().toISOString());
    patientId = pId;

    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss', password: '0801' });
    token = login.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  it('POST /api/imaging 创建影像记录', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/imaging').set('Authorization', `Bearer ${token}`)
      .send({ patientId, doctorId, type: 'PANORAMIC', title: '术前全景片', imageUrl: 'http://example.com/panoramic.jpg', description: '术前评估', takenAt: new Date().toISOString() });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.type).toBe('PANORAMIC');
    expect(res.body.title).toBe('术前全景片');
    imagingId = res.body.id;
  });

  it('GET /api/imaging 查询影像列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/imaging').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('GET /api/imaging 按类型筛选', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/imaging').query({ type: 'PANORAMIC' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.items.every((i: any) => i.type === 'PANORAMIC')).toBe(true);
  });

  it('GET /api/imaging/:id 查询单个影像', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/imaging/${imagingId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.id).toBe(imagingId);
    expect(res.body.title).toBe('术前全景片');
  });

  it('PATCH /api/imaging/:id 更新影像', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/imaging/${imagingId}`).set('Authorization', `Bearer ${token}`)
      .send({ title: '术后全景片', description: '术后复查' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.title).toBe('术后全景片');
    expect(res.body.description).toBe('术后复查');
  });

  it('DELETE /api/imaging/:id 删除影像', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/imaging/${imagingId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
  });

  it('GET /api/imaging/:id 删除后查询返回404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/imaging/${imagingId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});
