import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

/**
 * 随访管理模块 HTTP E2E 测试。
 * 覆盖 GET /api/follow-ups、GET /api/follow-ups/:id、POST /api/follow-ups、
 * PATCH /api/follow-ups/:id、DELETE /api/follow-ups/:id、POST /api/follow-ups/:id/complete，
 * 并验证未登录返回 401。
 *
 * 注意：
 * 1. FollowUp 表有 patientId 外键，需先创建患者。
 * 2. FollowUpsController 允许 BOSS/DOCTOR/RECEPTIONIST 三种角色访问。
 * 3. complete 端点会将状态置为 COMPLETED 并记录 result。
 * 4. remove 端点执行软删除（deletedAt + status=CANCELLED）。
 * 5. FollowUp 表无 type/itemId/resultId 等列（DTO 中有但表 schema 无），
 *    create 请求仅发送表实际拥有的字段（patientId/planDate/content/assigneeId）。
 */
describe('Communication / Follow-ups (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let doctorToken: string;
  let patientId: string;
  let createdFollowUpId: string;

  const tablesForCleanup = [
    'UsedRefreshToken', 'AuditLog', 'OperationLog',
    'FollowUp', 'Patient', 'User',
  ];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const table of tablesForCleanup) {
      try { db.exec(`DELETE FROM "${table}"`); } catch { /* ok */ }
    }

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, now, now);

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'doctor', hash, '医生', 'DOCTOR', 'test-clinic-001', now, now);

    const docLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'doctor', password: TEST_USER_PASSWORD });
    doctorToken = extractAccessToken(docLogin);

    // 先创建患者（FollowUp.patientId 外键依赖）
    const patientRes = await request(app.getHttpServer())
      .post('/api/patients')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ name: '随访测试患者', gender: 'MALE', phone: '13800138001' });
    patientId = patientRes.body.id;
  });

  afterAll(async () => { await app.close(); });

  it('POST /api/follow-ups 创建随访', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .post('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        patientId,
        planDate: tomorrow,
        content: '术后第一次回访',
      });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.patientId).toBe(patientId);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.content).toBe('术后第一次回访');
    createdFollowUpId = res.body.id;
  });

  it('POST /api/follow-ups 校验失败返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ content: '缺少 patientId 和 planDate' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('GET /api/follow-ups 获取随访列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.items).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/follow-ups/:id 获取随访详情', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/follow-ups/${createdFollowUpId}`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.id).toBe(createdFollowUpId);
    expect(res.body.patientId).toBe(patientId);
  });

  it('PATCH /api/follow-ups/:id 更新随访', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/follow-ups/${createdFollowUpId}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ content: '更新后的回访内容', status: 'IN_PROGRESS' });
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.content).toBe('更新后的回访内容');
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('POST /api/follow-ups/:id/complete 完成随访', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/follow-ups/${createdFollowUpId}/complete`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ result: '患者恢复良好，无异常' });
    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.result).toBe('患者恢复良好，无异常');
    expect(res.body.completedAt).toBeDefined();
  });

  it('DELETE /api/follow-ups/:id 软删除随访', async () => {
    // 先创建一个待删除的随访
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createRes = await request(app.getHttpServer())
      .post('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ patientId, planDate: tomorrow, content: '待删除随访' });
    const targetId = createRes.body.id;

    const res = await request(app.getHttpServer())
      .delete(`/api/follow-ups/${targetId}`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(HttpStatus.OK);

    // 删除后列表中不应再包含该记录（软删除过滤）
    const list = await request(app.getHttpServer())
      .get('/api/follow-ups')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(list.body.items.some((f: { id: string }) => f.id === targetId)).toBe(false);
  });

  it('未带 token 访问返回 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/follow-ups');
    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
