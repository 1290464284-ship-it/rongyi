import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from '../test-helpers';

describe('Patient Workflow (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let patientId: string;

  const tables = [
    'UsedRefreshToken', 'FirstExamFollowUp', 'FirstExamTooth', 'FirstExamTrack', 'FirstExam',
    'ChargeItem', 'DebtPayment', 'Refund',
    'TreatmentPlanItem', 'TreatmentPlan', 'PrescriptionItem', 'Prescription',
    'Imaging', 'MedicalRecord', 'MemberCardLog', 'MemberPointLog', 'MemberCard',
    'ProcessingOrder', 'PurchaseOrder', 'TreatmentCatalog', 'Treatment',
    'Visit', 'Appointment', 'ToothRecord', 'Registration', 'WechatMessage', 'OperationLog',
    'Patient', 'User',
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
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run('boss-001', 'boss', hash, '老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());

    const login = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: TEST_USER_PASSWORD });
    token = extractAccessToken(login);
  });

  afterAll(async () => { await app.close(); });

  describe('患者管理完整流程', () => {
    it('步骤1: 创建患者（含身份证加密）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/patients').set('Authorization', `Bearer ${token}`)
        .send({
          name: '李明',
          gender: 'MALE',
          phone: '13800138123',
          idCard: '110101199001011234',
          birthDate: '1990-01-01',
          address: '北京市朝阳区建国路88号',
          occupation: '工程师',
          tags: ['VIP', '老患者'],
          allergies: ['青霉素'],
          medicalHistory: ['高血压'],
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      expect(res.body.code).toMatch(/^P\d+$/);
      expect(res.body.name).toBe('李明');
      expect(res.body.idCard).toBe('110101********1234');
      expect(res.body.phone).toBe('138****8123');
      expect(res.body.tags).toEqual(expect.arrayContaining(['VIP', '老患者']));
      expect(res.body.allergies).toEqual(['青霉素']);
      expect(res.body.medicalHistory).toEqual(['高血压']);
      patientId = res.body.id;
    });

    it('步骤2: 更新患者信息', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/patients/${patientId}`).set('Authorization', `Bearer ${token}`)
        .send({
          name: '李晓明',
          address: '上海市浦东新区陆家嘴环路958号',
          occupation: '高级工程师',
          tags: ['VIP', '老患者', '企业客户'],
        });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('李晓明');
      expect(res.body.address).toBe('上海市浦东新区陆家嘴环路958号');
      expect(res.body.occupation).toBe('高级工程师');
      expect(res.body.tags).toEqual(expect.arrayContaining(['VIP', '老患者', '企业客户']));
    });

    it('步骤3: 查询患者列表（分页、筛选）', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/patients?page=1&pageSize=10&keyword=李')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(10);
      expect(res.body.items[0].name).toBe('李晓明');
    });

    it('步骤3: 查询患者列表（按手机号筛选）', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/patients?keyword=13800138123')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].name).toBe('李晓明');
    });

    it('步骤4: 查询患者详情（含关联数据）', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBe(patientId);
      expect(res.body.name).toBe('李晓明');
      expect(res.body.phone).toBe('138****8123');
      expect(res.body.idCard).toBe('110101********1234');
      expect(res.body.address).toBe('上海市浦东新区陆家嘴环路958号');
      expect(res.body.occupation).toBe('高级工程师');
      expect(res.body.birthDate).toBe('1990-01-01');
    });

    it('步骤4: 获取完整身份证号（BOSS权限）', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}/full-id-card`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.idCard).toBe('110101199001011234');
    });

    it('步骤5: 删除患者（软删除）', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.NO_CONTENT);

      const row = db.prepare('SELECT deletedAt, active FROM Patient WHERE id = ?').get(patientId) as any;
      expect(row.deletedAt).not.toBeNull();
      expect(row.active).toBe(0);
    });

    it('步骤5: 软删除后列表中不可见', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/patients?keyword=李')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBe(0);
    });

    it('步骤6: 恢复患者（重新创建或取消删除）', async () => {
      // 恢复原始 code（软删除时追加了 _deleted_ 后缀）
      const row = db.prepare('SELECT code FROM Patient WHERE id = ?').get(patientId) as any;
      const originalCode = (row.code as string).replace(/_deleted_.*$/, '');
      db.prepare('UPDATE Patient SET deletedAt = NULL, active = 1, code = ? WHERE id = ?').run(originalCode, patientId);

      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('李晓明');
      expect(res.body.active).toBe(1);
    });

    it('步骤7: 验证数据完整性', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.id).toBe(patientId);
      expect(res.body.code).toMatch(/^P\d+$/);
      expect(res.body.name).toBe('李晓明');
      expect(res.body.gender).toBe('MALE');
      expect(res.body.birthDate).toBe('1990-01-01');
      expect(res.body.address).toBe('上海市浦东新区陆家嘴环路958号');
      expect(res.body.occupation).toBe('高级工程师');
      expect(res.body.tags).toEqual(expect.arrayContaining(['VIP', '老患者', '企业客户']));
      expect(res.body.allergies).toEqual(['青霉素']);
      expect(res.body.medicalHistory).toEqual(['高血压']);
    });
  });

  describe('边界情况验证', () => {
    it('创建患者缺少必填字段返回400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/patients').set('Authorization', `Bearer ${token}`)
        .send({ gender: 'MALE', phone: '13800138000' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('创建患者手机号格式错误返回400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/patients').set('Authorization', `Bearer ${token}`)
        .send({ name: '测试', gender: 'MALE', phone: '123456' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('更新不存在的患者返回404', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/patients/not-exist-id').set('Authorization', `Bearer ${token}`)
        .send({ name: '更新测试' });
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('未带token访问返回401', async () => {
      const res = await request(app.getHttpServer()).get('/api/patients');
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});