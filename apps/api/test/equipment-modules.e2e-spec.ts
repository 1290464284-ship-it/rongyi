import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

describe('Equipment Modules (e2e) - 设备管理完整业务流程', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let doctorToken: string;

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
      .run(crypto.randomUUID(), 'boss_equip_mod', hash, '设备模块老板', 'BOSS', 'test-clinic-001', now, now);
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(crypto.randomUUID(), 'doctor_equip_mod', hash, '设备模块医生', 'DOCTOR', 'test-clinic-001', now, now);

    const bossLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss_equip_mod', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(bossLogin);

    const docLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'doctor_equip_mod', password: TEST_USER_PASSWORD });
    doctorToken = extractAccessToken(docLogin);
  });

  afterAll(async () => { await app.close(); });

  describe('设备登记', () => {
    let createdEquipmentId: string;

    it('POST /equipment - 创建设备', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '口腔综合治疗台',
          model: 'DentalPro-X5',
          category: '治疗设备',
          location: '1号诊室',
          status: 'NORMAL',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('口腔综合治疗台');
      expect(res.body.model).toBe('DentalPro-X5');
      expect(res.body.category).toBe('治疗设备');
      expect(res.body.status).toBe('NORMAL');
      createdEquipmentId = res.body.id;
    });

    it('POST /equipment - 创建基础设备（必填字段）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '超声波洁牙机',
          model: 'UltraClean-2000',
          category: '治疗设备',
          location: '2号诊室',
          status: 'NORMAL',
        });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect(res.body.name).toBe('超声波洁牙机');
    });

    it('POST /equipment - 缺少必填 name 返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ model: '无名称设备' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect(res.body.message).toBeDefined();
    });

    it('GET /equipment/:id - 查询设备详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/equipment/${createdEquipmentId}`)
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.id).toBe(createdEquipmentId);
      expect(res.body.name).toBe('口腔综合治疗台');
      expect(res.body.model).toBe('DentalPro-X5');
    });
  });

  describe('设备列表查询', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '查询测试设备A',
          model: 'QUERY-A',
          category: '影像设备',
          location: '影像室',
          status: 'NORMAL',
        });
      await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '查询测试设备B',
          model: 'QUERY-B',
          category: '消毒设备',
          location: '消毒室',
          status: 'MAINTENANCE',
        });
    });

    it('GET /equipment - 查询设备列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /equipment - 支持分页参数', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment?page=1&pageSize=10')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(10);
    });

    it('GET /equipment - 支持关键词搜索', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment?keyword=查询测试')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
      const items = res.body.items as Array<{ name: string }>;
      expect(items.some(i => i.name.includes('查询测试'))).toBe(true);
    });

    it('GET /equipment - 按名称关键词搜索', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment?name=查询测试设备A')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      const items = res.body.items as Array<{ name: string }>;
      expect(items.some(i => i.name === '查询测试设备A')).toBe(true);
    });

    it('GET /equipment - 结果包含所有字段', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      const item = res.body.items[0] as Record<string, unknown>;
      expect(item.id).toBeDefined();
      expect(item.name).toBeDefined();
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
    });
  });

  describe('设备维护记录', () => {
    let equipmentId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '维护测试设备',
          model: 'MAINT-001',
          category: '治疗设备',
          location: '3号诊室',
          status: 'NORMAL',
        });
      equipmentId = res.body.id;
    });

    it('设备进入维护状态', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${equipmentId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'MAINTENANCE' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('MAINTENANCE');
    });

    it('维护完成后恢复正常状态', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${equipmentId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'NORMAL' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('NORMAL');
    });

    it('更新设备位置信息', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${equipmentId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          location: '4号诊室',
        });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.location).toBe('4号诊室');
    });
  });

  describe('设备状态变更', () => {
    let statusTestId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '状态变更测试设备',
          model: 'STATUS-TEST',
          category: '治疗设备',
          location: '4号诊室',
          status: 'NORMAL',
        });
      statusTestId = res.body.id;
    });

    it('NORMAL -> MAINTENANCE', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${statusTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'MAINTENANCE' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('MAINTENANCE');
    });

    it('MAINTENANCE -> BROKEN', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${statusTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'BROKEN' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('BROKEN');
    });

    it('BROKEN -> SCRAPPED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${statusTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ status: 'SCRAPPED' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('SCRAPPED');
    });

    it('查询设备详情验证状态变更', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/equipment/${statusTestId}`)
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('SCRAPPED');
    });
  });

  describe('设备更新与删除', () => {
    let updateTestId: string;
    let deleteTestId: string;

    beforeAll(async () => {
      const updateRes = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '更新测试设备',
          model: 'UPDATE-EQ',
          category: '治疗设备',
          location: '5号诊室',
          status: 'NORMAL',
        });
      updateTestId = updateRes.body.id;

      const deleteRes = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({
          name: '删除测试设备',
          model: 'DELETE-EQ',
          category: '辅助设备',
          location: '仓库',
          status: 'NORMAL',
        });
      deleteTestId = deleteRes.body.id;
    });

    it('PATCH /equipment/:id - 更新设备信息', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/equipment/${updateTestId}`)
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '更新后的设备名称', location: '6号诊室', purchasePrice: 120000 });
      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.name).toBe('更新后的设备名称');
      expect(res.body.location).toBe('6号诊室');
      expect(Number(res.body.purchasePrice)).toBe(120000);
    });

    it('DELETE /equipment/:id - 删除设备', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/equipment/${deleteTestId}`)
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.OK);
    });

    it('删除后查询详情返回 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/equipment/${deleteTestId}`)
        .set('Authorization', `Bearer ${bossToken}`);
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('删除后不在列表中显示', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`);
      const items = res.body.items as Array<{ id: string }>;
      expect(items.some(i => i.id === deleteTestId)).toBe(false);
    });
  });

  describe('权限验证', () => {
    it('未带 token 返回 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/equipment');
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
        .send({ name: '医生创建设备', model: 'DR-EQ' });
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });

    it('DOCTOR 无权删除设备返回 403', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/equipment')
        .set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '医生删除测试', model: 'DR-DEL', status: 'NORMAL' });

      const res = await request(app.getHttpServer())
        .delete(`/api/equipment/${createRes.body.id}`)
        .set('Authorization', `Bearer ${doctorToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });
});