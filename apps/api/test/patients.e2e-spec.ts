import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';

describe('Patients (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;

  const tablesForCleanup = [
    'UsedRefreshToken', 'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FirstExam',
    'ChargeItem', 'DebtPayment', 'Refund',
    'TreatmentPlanItem', 'TreatmentPlan',
    'PrescriptionItem', 'Prescription',
    'Imaging', 'MedicalRecord',
    'MemberCardLog', 'MemberPointLog', 'MemberCard',
    'ProcessingOrder', 'PurchaseOrder',
    'TreatmentCatalog', 'Treatment',
    'Visit', 'Appointment', 'ToothRecord', 'Registration',
    'WechatMessage', 'OperationLog',
    'Patient', 'User',
  ];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const table of tablesForCleanup) {
      try { db.exec(`DELETE FROM "${table}"`); } catch { /* ok */ }
    }

    const hash = await bcrypt.hash('123456', 10);
    db.prepare(
      'INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)'
    ).run('boss-001', 'boss', hash, '老板', 'BOSS', new Date().toISOString(), new Date().toISOString());

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: '123456' });
    token = login.body.access_token;
  });

  afterAll(async () => { await app.close(); });

  it('POST /api/patients 创建患者', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '张三', gender: 'MALE', phone: '13800138000' });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.code).toMatch(/^P\d+$/);
    expect(res.body.name).toBe('张三');
  });

  it('GET /api/patients 分页+搜索', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/patients?page=1&pageSize=10&keyword=张')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].name).toBe('张三');
  });

  it('GET /api/patients/:id 详情', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/patients')
      .set('Authorization', `Bearer ${token}`);
    const id = list.body.items[0].id;
    const res = await request(app.getHttpServer())
      .get(`/api/patients/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.name).toBe('张三');
  });

  it('PATCH /api/patients/:id 更新', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/patients')
      .set('Authorization', `Bearer ${token}`);
    const id = list.body.items[0].id;
    const res = await request(app.getHttpServer())
      .patch(`/api/patients/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '13900139000', address: '上海市浦东新区' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.phone).toBe('13900139000');
  });

  it('POST /api/patients 重复手机号允许创建（家人共用）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '李四', gender: 'FEMALE', phone: '13900139000' });
    expect(res.status).toBe(HttpStatus.CREATED);
  });

  it('未带token访问返回401', async () => {
    const res = await request(app.getHttpServer()).get('/api/patients');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
