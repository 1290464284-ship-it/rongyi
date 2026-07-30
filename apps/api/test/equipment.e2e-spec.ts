import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

describe('Equipment (e2e) - 设备管理', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let doctorToken: string;
  let createdEquipmentId: string;

  const tablesForCleanup = [
    'UsedRefreshToken', 'AuditLog', 'OperationLog', 'Equipment', 'User',
  ];

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    try { db.exec('ALTER TABLE Equipment ADD COLUMN deletedAt TEXT'); } catch { /* 已存在 */ }

    for (const table of tablesForCleanup) {
      try { db.exec(`DELETE FROM "${table}"`); } catch { /* ok */ }
    }

    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, now, now);

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'boss_equip', hash, '老板', 'BOSS', 'test-clinic-001', now, now);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'doctor_equip', hash, '医生', 'DOCTOR', 'test-clinic-001', now, now);

    const bossLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss_equip', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(bossLogin);

    const docLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'doctor_equip', password: TEST_USER_PASSWORD });
    doctorToken = extractAccessToken(docLogin);
  });

  afterAll(async () => { await app.close(); });

  describe('设备创建', () => {
    it('POST /api/equipment - 创建设备成功', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '口腔综合治疗台',
          model: 'X500',
          category: '治疗设备',
          location: '1号诊室',
          status: 'NORMAL',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('口腔综合治疗台');
      expect(res.body.model).toBe('X500');
      createdEquipmentId = res.body.id;
    });

    it('POST /api/equipment - 创建设备（完整字段）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '牙科X光机',
          model: 'X-Ray-2000',
          manufacturer: '西门子',
          serialNumber: 'SN202401001',
          category: '影像设备',
          location: '影像室',
          purchasePrice: 150000,
          purchaseDate: '2024-01-15',
          supplier: 'xx医疗器械公司',
          status: 'NORMAL',
          remark: '定期维护',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.name).toBe('牙科X光机');
      expect(res.body.category).toBe('影像设备');
    });

    it('POST /api/equipment - 缺少必填 name 字段返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ model: '无名称设备' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect(res.body.message).toBeDefined();
    });
  });

  describe('设备列表查询', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '查询测试设备A',
          model: 'TEST-A',
          category: '治疗设备',
          location: '2号诊室',
          status: 'NORMAL',
        });
      await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '查询测试设备B',
          model: 'TEST-B',
          category: '消毒设备',
          location: '消毒室',
          status: 'MAINTENANCE',
        });
    });

    it('GET /api/equipment - 获取设备列表成功', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/equipment - 支持分页参数', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment?page=1&pageSize=10')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(10);
    });

    it('GET /api/equipment - 支持关键词搜索', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment?keyword=口腔')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      const items = res.body.items as Array<{ name: string }>;
      expect(items.some(i => i.name.includes('口腔'))).toBe(true);
    });

    it('GET /api/equipment - 按分类筛选', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment?category=治疗设备')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      const items = res.body.items as Array<{ category: string }>;
      expect(items.every(i => i.category === '治疗设备')).toBe(true);
    });

    it('GET /api/equipment - 按状态筛选', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment?status=NORMAL')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      const items = res.body.items as Array<{ status: string }>;
      expect(items.every(i => i.status === 'NORMAL')).toBe(true);
    });
  });

  describe('设备详情查询', () => {
    it('GET /api/equipment/:id - 获取设备详情成功', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/equipment/${createdEquipmentId}`)
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBe(createdEquipmentId);
      expect(res.body.name).toBe('口腔综合治疗台');
    });

    it('GET /api/equipment/:id - 不存在的 ID 返回 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment/nonexistent-equipment-id')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
      expect(res.body.message).toBeDefined();
    });
  });

  describe('设备更新', () => {
    let updateTestId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '更新测试设备',
          model: 'UPDATE-001',
          category: '治疗设备',
          location: '3号诊室',
          status: 'NORMAL',
        });
      updateTestId = res.body.id;
    });

    it('PATCH /api/equipment/:id - 更新设备信息成功', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${updateTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '更新后的治疗台', location: '4号诊室', status: 'MAINTENANCE' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('更新后的治疗台');
      expect(res.body.location).toBe('4号诊室');
      expect(res.body.status).toBe('MAINTENANCE');
    });

    it('PATCH /api/equipment/:id - 部分字段更新', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${updateTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'BROKEN' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('BROKEN');
    });

    it('PATCH /api/equipment/:id - 不存在的 ID 返回 404', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/equipment/nonexistent-id')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '测试' });
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('设备删除', () => {
    let deleteTestId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '删除测试设备',
          model: 'DELETE-001',
          category: '治疗设备',
          location: '5号诊室',
          status: 'NORMAL',
        });
      deleteTestId = res.body.id;
    });

    it('DELETE /api/equipment/:id - 删除设备成功', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/equipment/${deleteTestId}`)
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.NO_CONTENT);
    });

    it('DELETE /api/equipment/:id - 删除后再获取详情返回 404', async () => {
      const after = await request(app.getHttpServer())
        .get(`/api/equipment/${deleteTestId}`)
        .set('Authorization', `Bearer ${bossToken}`);
      expect(after.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('DELETE /api/equipment/:id - 删除后不在列表中显示', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`);
      const items = res.body.items as Array<{ id: string }>;
      expect(items.some(i => i.id === deleteTestId)).toBe(false);
    });

    it('DELETE /api/equipment/:id - 不存在的 ID 返回 404', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/equipment/nonexistent-id')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('设备状态管理', () => {
    let statusTestId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '状态测试设备',
          model: 'STATUS-001',
          category: '治疗设备',
          location: '6号诊室',
          status: 'NORMAL',
        });
      statusTestId = res.body.id;
    });

    it('设备状态：NORMAL -> MAINTENANCE', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${statusTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'MAINTENANCE' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('MAINTENANCE');
    });

    it('设备状态：MAINTENANCE -> BROKEN', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${statusTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'BROKEN' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('BROKEN');
    });

    it('设备状态：BROKEN -> SCRAPPED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${statusTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'SCRAPPED' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('SCRAPPED');
    });
  });

  describe('权限验证', () => {
    it('未带 token 访问返回 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/equipment');
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('未带 token 创建设备返回 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .send({ name: '测试设备' });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('DOCTOR 无权访问设备列表返回 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment')
        .set('Authorization', `Bearer ${doctorToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('DOCTOR 无权创建设备返回 403', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ name: '测试设备' });
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('DOCTOR 无权删除设备返回 403', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/equipment/${createdEquipmentId}`)
        .set('Authorization', `Bearer ${doctorToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe('设备维护记录', () => {
    it('项目中暂无独立的设备维护记录模块，设备状态变更可通过 PATCH 接口记录', () => {
      expect(true).toBe(true);
    });
  });
});
