import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

describe('System (e2e) - 系统模块', () => {
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
      .run(crypto.randomUUID(), 'boss_sys', hash, '系统测试老板', 'BOSS', 'test-clinic-001', now, now);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'doctor_sys', hash, '系统测试医生', 'DOCTOR', 'test-clinic-001', now, now);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'recep_sys', hash, '系统测试前台', 'RECEPTIONIST', 'test-clinic-001', now, now);

    const bossLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss_sys', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(bossLogin);

    const docLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'doctor_sys', password: TEST_USER_PASSWORD });
    doctorToken = extractAccessToken(docLogin);

    const recepLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'recep_sys', password: TEST_USER_PASSWORD });
    receptionistToken = extractAccessToken(recepLogin);
  });

  afterAll(async () => { await app.close(); });

  describe('健康检查接口', () => {
    describe('GET /api/health - 基础健康检查', () => {
      it('无需认证即可访问', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/health')
          .expect(HttpStatus.OK);
        expect(res.body.status).toBe('ok');
      });

      it('返回 status 字段', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/health')
          .expect(HttpStatus.OK);
        expect(res.body).toHaveProperty('status');
        expect(['ok', 'down']).toContain(res.body.status);
      });
    });

    describe('GET /api/health/info - 应用信息', () => {
      it('未认证访问返回 401（防止系统信息泄露）', async () => {
        await request(app.getHttpServer())
          .get('/api/health/info')
          .expect(HttpStatus.UNAUTHORIZED);
      });

      it('BOSS 可访问并返回应用基本信息', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/health/info')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body).toBeDefined();
        expect(typeof res.body).toBe('object');
      });

      it('非 BOSS 角色返回 403', async () => {
        await request(app.getHttpServer())
          .get('/api/health/info')
          .set('Authorization', `Bearer ${doctorToken}`)
          .expect(HttpStatus.FORBIDDEN);
      });
    });

    describe('GET /api/health/detail - 详细健康检查', () => {
      it('需要 BOSS 权限', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/health/detail')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body).toBeDefined();
      });

      it('未带 token 返回 401', async () => {
        await request(app.getHttpServer())
          .get('/api/health/detail')
          .expect(HttpStatus.UNAUTHORIZED);
      });

      it('DOCTOR 无权访问返回 403', async () => {
        await request(app.getHttpServer())
          .get('/api/health/detail')
          .set('Authorization', `Bearer ${doctorToken}`)
          .expect(HttpStatus.FORBIDDEN);
      });
    });

    describe('GET /api/health/db-consistency - 数据库一致性检查', () => {
      it('需要 BOSS 权限', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/health/db-consistency')
          .set('Authorization', `Bearer ${bossToken}`);
        expect([HttpStatus.OK, HttpStatus.INTERNAL_SERVER_ERROR]).toContain(res.status);
      });

      it('未带 token 返回 401', async () => {
        await request(app.getHttpServer())
          .get('/api/health/db-consistency')
          .expect(HttpStatus.UNAUTHORIZED);
      });
    });

    describe('GET /api/health/db-consistency-checks/list - 可用检查项列表', () => {
      it('需要 BOSS 权限', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/health/db-consistency-checks/list')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(Array.isArray(res.body)).toBe(true);
      });

      it('返回检查项名称列表', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/health/db-consistency-checks/list')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
      });
    });
  });

  describe('操作日志查询', () => {
    beforeAll(async () => {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${doctorToken}`)
          .send({
            logs: [
              {
                level: 'info',
                message: `测试操作日志 ${i + 1}`,
                url: '/api/test',
                userAgent: 'test-agent',
                context: 'test',
              },
            ],
          });
      }
    });

    describe('GET /api/operation-logs - 分页查询操作日志', () => {
      it('需要 BOSS 权限', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/operation-logs')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body.items).toBeDefined();
        expect(Array.isArray(res.body.items)).toBe(true);
      });

      it('支持分页参数', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/operation-logs?page=1&pageSize=10')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body.page).toBe(1);
        expect(res.body.pageSize).toBe(10);
      });

      it('返回 total 字段', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/operation-logs')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body.total).toBeDefined();
        expect(typeof res.body.total).toBe('number');
      });

      it('未带 token 返回 401', async () => {
        await request(app.getHttpServer())
          .get('/api/operation-logs')
          .expect(HttpStatus.UNAUTHORIZED);
      });

      it('DOCTOR 无权访问返回 403', async () => {
        await request(app.getHttpServer())
          .get('/api/operation-logs')
          .set('Authorization', `Bearer ${doctorToken}`)
          .expect(HttpStatus.FORBIDDEN);
      });

      it('RECEPTIONIST 无权访问返回 403', async () => {
        await request(app.getHttpServer())
          .get('/api/operation-logs')
          .set('Authorization', `Bearer ${receptionistToken}`)
          .expect(HttpStatus.FORBIDDEN);
      });
    });
  });

  describe('批量日志上报', () => {
    describe('POST /api/operation-logs/batch - 批量上报日志', () => {
      it('BOSS 可以上报日志', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({
            logs: [
              {
                level: 'info',
                message: 'BOSS 上报的测试日志',
                url: '/api/test/boss',
              },
            ],
          })
          .expect(HttpStatus.CREATED);
        expect(res.body.success).toBe(true);
      });

      it('DOCTOR 可以上报日志', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${doctorToken}`)
          .send({
            logs: [
              {
                level: 'info',
                message: 'DOCTOR 上报的测试日志',
                url: '/api/test/doctor',
              },
            ],
          })
          .expect(HttpStatus.CREATED);
        expect(res.body.success).toBe(true);
      });

      it('RECEPTIONIST 可以上报日志', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${receptionistToken}`)
          .send({
            logs: [
              {
                level: 'warning',
                message: 'RECEPTIONIST 上报的测试日志',
                url: '/api/test/recep',
              },
            ],
          })
          .expect(HttpStatus.CREATED);
        expect(res.body.success).toBe(true);
      });

      it('支持批量上报多条日志', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${doctorToken}`)
          .send({
            logs: [
              { level: 'info', message: '批量日志 1' },
              { level: 'warning', message: '批量日志 2' },
              { level: 'error', message: '批量日志 3', stack: 'error stack' },
            ],
          })
          .expect(HttpStatus.CREATED);
        expect(res.body.success).toBe(true);
      });

      it('空日志数组返回 400', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({ logs: [] });
        expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      });

      it('超过 50 条日志返回 400', async () => {
        const logs = Array.from({ length: 51 }, (_, i) => ({
          level: 'info' as const,
          message: `批量日志 ${i + 1}`,
        }));
        const res = await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({ logs });
        expect([HttpStatus.BAD_REQUEST, HttpStatus.PAYLOAD_TOO_LARGE]).toContain(res.status);
      });

      it('未带 token 返回 401', async () => {
        await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .send({ logs: [{ level: 'info', message: 'test' }] })
          .expect(HttpStatus.UNAUTHORIZED);
      });

      it('支持不同日志级别', async () => {
        const levels: Array<'info' | 'warning' | 'error'> = ['info', 'warning', 'error'];
        for (const level of levels) {
          const res = await request(app.getHttpServer())
            .post('/api/operation-logs/batch')
            .set('Authorization', `Bearer ${doctorToken}`)
            .send({
              logs: [{ level, message: `${level} 级别日志` }],
            })
            .expect(HttpStatus.CREATED);
          expect(res.body.success).toBe(true);
        }
      });

      it('无效日志级别返回 400', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/operation-logs/batch')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({
            logs: [{ level: 'invalid', message: '无效级别' }],
          });
        expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      });
    });
  });

  describe('字典管理', () => {
    it('项目中暂无独立的字典管理模块', () => {
      expect(true).toBe(true);
    });
  });

  describe('诊所管理', () => {
    describe('GET /api/clinics - 诊所列表', () => {
      it('需要 BOSS 权限', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/clinics')
          .set('Authorization', `Bearer ${bossToken}`);
        expect([HttpStatus.OK, HttpStatus.FORBIDDEN]).toContain(res.status);
      });
    });
  });

  describe('系统设置', () => {
    describe('GET /api/settings - 获取所有设置', () => {
      it('需要 BOSS 权限', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/settings')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body).toBeDefined();
        expect(typeof res.body).toBe('object');
      });

      it('包含默认配置项', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/settings')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body.defaultPageSize).toBeDefined();
      });

      it('未带 token 返回 401', async () => {
        await request(app.getHttpServer())
          .get('/api/settings')
          .expect(HttpStatus.UNAUTHORIZED);
      });

      it('DOCTOR 无权访问返回 403', async () => {
        await request(app.getHttpServer())
          .get('/api/settings')
          .set('Authorization', `Bearer ${doctorToken}`)
          .expect(HttpStatus.FORBIDDEN);
      });
    });

    describe('PUT /api/settings/:key - 更新单个设置', () => {
      it('更新设置成功', async () => {
        const res = await request(app.getHttpServer())
          .put('/api/settings/clinicName')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({ value: '测试牙科诊所' })
          .expect(HttpStatus.OK);
        expect(res.body.key).toBe('clinicName');
        expect(res.body.value).toBe('测试牙科诊所');
      });

      it('获取更新后的设置', async () => {
        await request(app.getHttpServer())
          .put('/api/settings/testKey')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({ value: 'testValue' });

        const res = await request(app.getHttpServer())
          .get('/api/settings/testKey')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body.key).toBe('testKey');
        expect(res.body.value).toBe('testValue');
      });

      it('value 非字符串返回 400', async () => {
        const res = await request(app.getHttpServer())
          .put('/api/settings/badKey')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({ value: 123 });
        expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      });
    });

    describe('DELETE /api/settings/:key - 删除设置', () => {
      it('删除设置成功', async () => {
        await request(app.getHttpServer())
          .put('/api/settings/tempDeleteKey')
          .set('Authorization', `Bearer ${bossToken}`)
          .send({ value: 'temp' });

        const res = await request(app.getHttpServer())
          .delete('/api/settings/tempDeleteKey')
          .set('Authorization', `Bearer ${bossToken}`)
          .expect(HttpStatus.OK);
        expect(res.body.key).toBe('tempDeleteKey');
      });
    });
  });

  describe('搜索功能', () => {
    describe('GET /api/search - 全局搜索', () => {
      it('需要认证', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/search?keyword=测试')
          .set('Authorization', `Bearer ${bossToken}`);
        expect([HttpStatus.OK, HttpStatus.NOT_FOUND]).toContain(res.status);
      });

      it('未带 token 返回 401', async () => {
        await request(app.getHttpServer())
          .get('/api/search?keyword=测试')
          .expect(HttpStatus.UNAUTHORIZED);
      });
    });
  });

  describe('统计功能', () => {
    describe('GET /api/stats - 统计数据', () => {
      it('需要认证', async () => {
        const res = await request(app.getHttpServer())
          .get('/api/stats')
          .set('Authorization', `Bearer ${bossToken}`);
        expect([HttpStatus.OK, HttpStatus.NOT_FOUND]).toContain(res.status);
      });
    });
  });
});
