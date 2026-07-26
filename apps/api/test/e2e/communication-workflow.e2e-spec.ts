import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from '../test-helpers';

describe('Communication Workflow (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let patientId: string;
  let followUpId: string;
  let doctorId: string;

  const tables = [
    'UsedRefreshToken', 'AuditLog', 'OperationLog',
    'FollowUp', 'WechatMessage', 'SmsLog',
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

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, now, now);

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);

    const dId = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(dId, 'doc_comm', hash, '李医生', 'DOCTOR', 'test-clinic-001', now, now);
    doctorId = dId;

    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run('boss-001', 'boss', hash, '老板', 'BOSS', 'test-clinic-001', now, now);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss', password: TEST_USER_PASSWORD });
    token = extractAccessToken(login);

    const pRes = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '随访测试患者', gender: 'MALE', phone: '13800138001' });
    patientId = pRes.body.id;
  });

  afterAll(async () => { await app.close(); });

  describe('通讯完整流程', () => {
    it('步骤1: 创建患者（已在 beforeAll 中完成）', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('随访测试患者');
    });

    it('步骤2: 创建随访计划', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const res = await request(app.getHttpServer())
        .post('/api/follow-ups').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          planDate: tomorrow,
          content: '术后第一次回访，询问恢复情况',
          type: '电话随访',
          assigneeId: doctorId,
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      expect(res.body.patientId).toBe(patientId);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.content).toBe('术后第一次回访，询问恢复情况');
      expect(res.body.type).toBe('电话随访');
      followUpId = res.body.id;
    });

    it('步骤2: 创建随访计划 - 验证必填字段', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/follow-ups').set('Authorization', `Bearer ${token}`)
        .send({ content: '缺少 patientId 和 planDate' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('步骤3: 更新随访消息（发送前准备）', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/follow-ups/${followUpId}`).set('Authorization', `Bearer ${token}`)
        .send({
          content: '更新后的随访内容：术后第二天回访',
          status: 'IN_PROGRESS',
        });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.content).toBe('更新后的随访内容：术后第二天回访');
      expect(res.body.status).toBe('IN_PROGRESS');
    });

    it('步骤4: 完成随访', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/follow-ups/${followUpId}/complete`).set('Authorization', `Bearer ${token}`)
        .send({ result: '患者恢复良好，无异常，继续观察' });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.result).toBe('患者恢复良好，无异常，继续观察');
      expect(res.body.completedAt).toBeDefined();
    });

    it('步骤5: 发送微信消息', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/wechat/send').set('Authorization', `Bearer ${token}`)
        .send({
          patientId,
          content: '您好，感谢您的就诊，如有任何问题请随时联系我们！',
          type: 'text',
          remark: '就诊感谢消息',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      expect(res.body.patientId).toBe(patientId);
      expect(res.body.content).toBe('您好，感谢您的就诊，如有任何问题请随时联系我们！');
      expect(res.body.type).toBe('text');
      expect(res.body.status).toBeDefined();
    });

    it('步骤5: 发送批量微信消息', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/wechat/send-batch').set('Authorization', `Bearer ${token}`)
        .send({
          patientIds: [patientId],
          content: '温馨提示：定期复查有助于保持口腔健康',
          type: 'text',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.count).toBeDefined();
    });

    it('步骤6: 查询微信消息记录', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/wechat')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('步骤6: 按患者筛选微信消息', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/wechat?patientId=${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('步骤6: 查询随访列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/follow-ups')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.total).toBe(1);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('步骤6: 查询随访详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/follow-ups/${followUpId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBe(followUpId);
      expect(res.body.patientId).toBe(patientId);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.result).toBe('患者恢复良好，无异常，继续观察');
    });

    it('步骤7: 验证消息关联', async () => {
      const wechatRes = await request(app.getHttpServer())
        .get(`/api/wechat?patientId=${patientId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(wechatRes.body.total).toBeGreaterThanOrEqual(1);

      const wechatMsg = wechatRes.body.items.find((msg: any) => msg.patientId === patientId);
      expect(wechatMsg).toBeDefined();
      expect(wechatMsg.content).toBeDefined();
      expect(wechatMsg.createdAt).toBeDefined();

      const followUpRes = await request(app.getHttpServer())
        .get(`/api/follow-ups/${followUpId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(followUpRes.body.patientId).toBe(patientId);
      expect(followUpRes.body.status).toBe('COMPLETED');
    });
  });

  describe('边界情况验证', () => {
    it('创建随访缺少必填字段返回400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/follow-ups').set('Authorization', `Bearer ${token}`)
        .send({ content: '缺少必填字段' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('发送微信消息缺少内容返回400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/wechat/send').set('Authorization', `Bearer ${token}`)
        .send({ patientId });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('查询不存在的随访返回404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/follow-ups/not-exist-id')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('未带token访问返回401', async () => {
      const res = await request(app.getHttpServer()).get('/api/follow-ups');
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);

      const wechatRes = await request(app.getHttpServer()).get('/api/wechat');
      expect(wechatRes.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('删除随访（软删除）', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const createRes = await request(app.getHttpServer())
        .post('/api/follow-ups').set('Authorization', `Bearer ${token}`)
        .send({ patientId, planDate: tomorrow, content: '待删除随访' });
      const targetId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .delete(`/api/follow-ups/${targetId}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(HttpStatus.OK);

      const listRes = await request(app.getHttpServer())
        .get('/api/follow-ups').set('Authorization', `Bearer ${token}`);
      expect(listRes.body.items.some((f: any) => f.id === targetId)).toBe(false);
    });
  });
});