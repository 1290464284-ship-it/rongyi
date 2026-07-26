import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

describe('System Modules (e2e) - 系统管理完整业务流程', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let doctorToken: string;
  let receptionistToken: string;

  const tablesForCleanup = [
    'UsedRefreshToken', 'AuditLog', 'OperationLog', 'User',
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
      .run(crypto.randomUUID(), 'boss_sys_mod', hash, '系统模块老板', 'BOSS', 'test-clinic-001', now, now);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'doctor_sys_mod', hash, '系统模块医生', 'DOCTOR', 'test-clinic-001', now, now);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'recep_sys_mod', hash, '系统模块前台', 'RECEPTIONIST', 'test-clinic-001', now, now);

    const bossLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss_sys_mod', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(bossLogin);

    const docLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'doctor_sys_mod', password: TEST_USER_PASSWORD });
    doctorToken = extractAccessToken(docLogin);

    const recepLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'recep_sys_mod', password: TEST_USER_PASSWORD });
    receptionistToken = extractAccessToken(recepLogin);
  });

  afterAll(async () => { await app.close(); });

  describe('用户管理', () => {
    let createdUserId: string;

    it('POST /auth/users - 创建用户', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/users')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          username: 'new_user_test',
          password: 'Test1234',
          name: '新创建的测试用户',
          role: 'DOCTOR',
          phone: '13900000001',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      expect(res.body.username).toBe('new_user_test');
      expect(res.body.name).toBe('新创建的测试用户');
      expect(res.body.role).toBe('DOCTOR');
      expect(res.body.phone).toBe('13900000001');
      createdUserId = res.body.id;
    });

    it('POST /auth/users - 创建前台用户', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/users')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          username: 'new_recep_test',
          password: 'Test1234',
          name: '新创建的前台用户',
          role: 'RECEPTIONIST',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.role).toBe('RECEPTIONIST');
    });

    it('GET /auth/users - 查询用户列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/users')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /auth/users?role=DOCTOR - 按角色筛选用户', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/users?role=DOCTOR')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      const users = res.body.items as Array<{ role: string }>;
      expect(users.every(u => u.role === 'DOCTOR')).toBe(true);
    });

    it('PATCH /auth/users/:id - 更新用户信息', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/auth/users/${createdUserId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '更新后的用户名称', phone: '13900000002' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('更新后的用户名称');
      expect(res.body.phone).toBe('13900000002');
    });

    it('PATCH /auth/users/:id - 修改用户角色', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/auth/users/${createdUserId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ role: 'RECEPTIONIST' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.role).toBe('RECEPTIONIST');
    });

    it('PATCH /auth/users/:id - 禁用用户', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/auth/users/${createdUserId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ active: false });
      expect(res.status).toBe(HttpStatus.OK);
    });

    it('禁用用户无法登录', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'new_user_test', password: 'Test1234' });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('DELETE /auth/users/:id - 删除用户', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/auth/users')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          username: 'delete_user_test',
          password: 'Test1234',
          name: '删除测试用户',
          role: 'DOCTOR',
        });

      const res = await request(app.getHttpServer())
        .delete(`/api/auth/users/${createRes.body.id}`)
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
    });
  });

  describe('角色权限验证', () => {
    it('BOSS 可以访问用户列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/users')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
    });

    it('DOCTOR 无权访问用户列表返回 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/users')
        .set('Authorization', `Bearer ${doctorToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('RECEPTIONIST 无权访问用户列表返回 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/users')
        .set('Authorization', `Bearer ${receptionistToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('DOCTOR 无权创建用户返回 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/users')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ username: 'doctor_create', password: 'Test1234', name: '医生创建', role: 'DOCTOR' });
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('DOCTOR 无权删除用户返回 403', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/auth/users')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ username: 'doctor_delete_test', password: 'Test1234', name: '医生删除测试', role: 'DOCTOR' });

      const res = await request(app.getHttpServer())
        .delete(`/api/auth/users/${createRes.body.id}`)
        .set('Authorization', `Bearer ${doctorToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('未带 token 返回 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/users');
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('操作日志', () => {
    beforeAll(async () => {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${doctorToken}`)
          .send({
            logs: [
              {
                level: i === 0 ? 'info' : i === 1 ? 'warning' : 'error',
                message: `测试操作日志 ${i + 1}`,
                url: `/api/test/log/${i + 1}`,
                userAgent: 'test-e2e-agent',
                context: 'system-modules-test',
              },
            ],
          });
      }
    });

    it('GET /operation-logs - 查询操作日志列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/operation-logs')
        .set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('GET /operation-logs - 支持分页参数', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/operation-logs?page=1&pageSize=10')
        .set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(10);
    });

    it('POST /operation-logs/batch - 批量上报日志', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/operation-logs/batch')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          logs: [
            { level: 'info', message: 'BOSS 操作日志测试' },
            { level: 'warning', message: 'BOSS 警告日志测试' },
          ],
        })
        .expect(HttpStatus.CREATED);
      expect(res.body.success).toBe(true);
    });

    it('POST /operation-logs/batch - DOCTOR 可以上报日志', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/operation-logs/batch')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          logs: [{ level: 'info', message: 'DOCTOR 操作日志' }],
        })
        .expect(HttpStatus.CREATED);
      expect(res.body.success).toBe(true);
    });

    it('POST /operation-logs/batch - RECEPTIONIST 可以上报日志', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/operation-logs/batch')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          logs: [{ level: 'info', message: 'RECEPTIONIST 操作日志' }],
        })
        .expect(HttpStatus.CREATED);
      expect(res.body.success).toBe(true);
    });

    it('DOCTOR 无权查询操作日志返回 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/operation-logs')
        .set('Authorization', `Bearer ${doctorToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('RECEPTIONIST 无权查询操作日志返回 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/operation-logs')
        .set('Authorization', `Bearer ${receptionistToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('空日志数组返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/operation-logs/batch')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ logs: [] });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('无效日志级别返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/operation-logs/batch')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          logs: [{ level: 'invalid', message: '无效级别日志' }],
        });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('当前用户信息', () => {
    it('GET /auth/me - 获取当前用户信息', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.username).toBe('boss_sys_mod');
      expect(res.body.name).toBe('系统模块老板');
      expect(res.body.role).toBe('BOSS');
    });

    it('DOCTOR 获取当前用户信息', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.username).toBe('doctor_sys_mod');
      expect(res.body.role).toBe('DOCTOR');
    });

    it('RECEPTIONIST 获取当前用户信息', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.username).toBe('recep_sys_mod');
      expect(res.body.role).toBe('RECEPTIONIST');
    });
  });

  describe('修改密码', () => {
    it('POST /auth/change-password - BOSS 修改密码', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          oldPassword: TEST_USER_PASSWORD,
          newPassword: 'NewPass654',
        });
      expect(res.status).toBe(HttpStatus.OK);
    });

    it('修改密码后新密码可登录', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'boss_sys_mod', password: 'NewPass654' });
      expect(res.status).toBe(HttpStatus.OK);
    });

    it('修改密码后旧密码不可登录', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'boss_sys_mod', password: TEST_USER_PASSWORD });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('错误旧密码返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          oldPassword: 'wrongpassword',
          newPassword: 'NewPass123',
        });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});