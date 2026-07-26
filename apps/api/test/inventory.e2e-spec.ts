import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';
import { resetTestMode, _isTestMode } from '../src/db/database';

describe('Inventory (e2e) - 库存管理', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let bossUserId: string;
  let supplierId: string;

  const cleanTables = [
    'InventoryTransaction', 'InventoryItem', 'Supplier',
    'User', 'OperationLog', 'UsedRefreshToken',
  ];

  beforeAll(async () => {
    resetTestMode();
    (_isTestMode as unknown as boolean) = true;
    process.env.TEST_DB_MEMORY = '1';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of cleanTables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    bossUserId = crypto.randomUUID();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)').run(
      bossUserId, 'boss_inv', hash, '库存测试老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString()
    );

    supplierId = crypto.randomUUID();
    db.prepare('INSERT INTO Supplier (id, name, contactPerson, phone, address, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)').run(
      supplierId, '测试供应商A', '张三', '13800000001', '测试地址1', 'test-clinic-001', new Date().toISOString(), new Date().toISOString()
    );

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss_inv', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(res);
  });

  afterAll(async () => {
    await app.close();
    resetTestMode();
    (_isTestMode as unknown as boolean) = false;
    delete process.env.TEST_DB_MEMORY;
  });

  describe('供应商管理', () => {
    it('POST /suppliers - 创建供应商', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/suppliers').set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '新建供应商', contactPerson: '李四', phone: '13900000001' })
        .expect(HttpStatus.CREATED);
      expect(res.body.name).toBe('新建供应商');
      expect(res.body.id).toBeDefined();
    });

    it('GET /suppliers - 查询供应商列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/suppliers').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body.items) || Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /suppliers/:id - 查询单个供应商', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/suppliers/${supplierId}`).set('Authorization', `Bearer ${bossToken}`);
      expect([HttpStatus.OK, HttpStatus.NOT_FOUND]).toContain(res.status);
    });
  });

  describe('库存项创建', () => {
    it('POST /inventory/items - 创建库存项成功', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'TEST-001',
          name: '一次性手套',
          category: '耗材',
          unit: '盒',
          stock: 100,
          minStock: 10,
          price: 25.5,
          supplierId,
        })
        .expect(HttpStatus.CREATED);
      expect(res.body.name).toBe('一次性手套');
      expect(Number(res.body.stock)).toBe(100);
      expect(res.body.id).toBeDefined();
    });

    it('POST /inventory/items - 缺少必填字段返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({ category: '耗材' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(res.body.message).toBeDefined();
    });
  });

  describe('库存列表查询', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'QUERY-TEST',
          name: '查询测试物品',
          category: '耗材',
          unit: '个',
          stock: 50,
          minStock: 5,
          price: 10,
        });
      itemId = res.body.id;
    });

    it('GET /inventory/items - 查询库存列表成功', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total).toBeDefined();
    });

    it('GET /inventory/items - 支持分页参数', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/items?page=1&pageSize=10').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(10);
    });

    it('GET /inventory/items - 支持关键词搜索', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/items?keyword=查询测试').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      const items = res.body.items as Array<{ name: string }>;
      expect(items.some(i => i.name.includes('查询测试'))).toBe(true);
    });

    it('GET /inventory/items/:id - 查询单个库存项详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.id).toBe(itemId);
      expect(res.body.name).toBe('查询测试物品');
    });

    it('GET /inventory/items/:id - 不存在的 ID 返回 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/items/nonexistent-id').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.NOT_FOUND);
      expect(res.body.message).toBeDefined();
    });
  });

  describe('库存入库', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'STOCK-IN',
          name: '入库测试物品',
          category: '耗材',
          unit: '支',
          stock: 50,
          minStock: 20,
          price: 80,
        });
      itemId = res.body.id;
    });

    it('POST /inventory/transactions - 入库操作成功', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'IN', quantity: 30, unitPrice: 75, remark: '采购入库' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(80);
    });

    it('POST /inventory/transactions - 入库后库存数量正确增加', async () => {
      const beforeRes = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`);
      const beforeStock = Number(beforeRes.body.stock);

      await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'IN', quantity: 20, remark: '补充入库' })
        .expect(HttpStatus.CREATED);

      const afterRes = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`);
      const afterStock = Number(afterRes.body.stock);

      expect(afterStock).toBe(beforeStock + 20);
    });
  });

  describe('库存出库', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'STOCK-OUT',
          name: '出库测试物品',
          category: '耗材',
          unit: '瓶',
          stock: 100,
          minStock: 10,
          price: 50,
        });
      itemId = res.body.id;
    });

    it('POST /inventory/transactions - 出库操作成功', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 25, remark: '诊室领用' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(75);
    });

    it('POST /inventory/transactions - 出库数量超过库存时报错', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 9999, remark: '超额出库' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(res.body.message).toBeDefined();
    });

    it('POST /inventory/transactions - 出库后库存数量正确减少', async () => {
      const beforeRes = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`);
      const beforeStock = Number(beforeRes.body.stock);

      await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 10, remark: '日常消耗' })
        .expect(HttpStatus.CREATED);

      const afterRes = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`);
      const afterStock = Number(afterRes.body.stock);

      expect(afterStock).toBe(beforeStock - 10);
    });
  });

  describe('库存调整', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'STOCK-ADJUST',
          name: '调整测试物品',
          category: '耗材',
          unit: '箱',
          stock: 50,
          minStock: 5,
          price: 200,
        });
      itemId = res.body.id;
    });

    it('POST /inventory/transactions - 库存调整（增加）成功', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'ADJUST', quantity: 200, remark: '盘点调整-增加' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(200);
    });

    it('POST /inventory/transactions - 库存调整（减少）成功', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'ADJUST', quantity: 80, remark: '盘点调整-减少' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(80);
    });

    it('POST /inventory/transactions - 库存调整为 0 成功', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'ADJUST', quantity: 0, remark: '清零调整' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(0);
    });
  });

  describe('库存流水查询', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'TXN-TEST',
          name: '流水测试物品',
          category: '耗材',
          unit: '个',
          stock: 100,
          minStock: 10,
          price: 15,
        });
      itemId = res.body.id;

      await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'IN', quantity: 50, remark: '测试入库' });
      await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 30, remark: '测试出库' });
      await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'ADJUST', quantity: 150, remark: '测试调整' });
    });

    it('GET /inventory/transactions - 查询全部库存流水', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('GET /inventory/transactions - 按物品 ID 过滤流水', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/inventory/transactions?itemId=${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      const txns = res.body as Array<{ itemId: string; type: string }>;
      expect(txns.length).toBeGreaterThanOrEqual(3);
      expect(txns.every(t => t.itemId === itemId)).toBe(true);
    });

    it('GET /inventory/transactions - 包含入库、出库、调整三种类型', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/inventory/transactions?itemId=${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      const txns = res.body as Array<{ type: string }>;
      const types = new Set(txns.map(t => t.type));
      expect(types.has('IN')).toBe(true);
      expect(types.has('OUT')).toBe(true);
      expect(types.has('ADJUST')).toBe(true);
    });
  });

  describe('低库存预警', () => {
    it('GET /inventory/items/low-stock - 查询低库存预警列表', async () => {
      await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'LOW-STOCK',
          name: '低库存测试品',
          category: '耗材',
          unit: '个',
          stock: 2,
          minStock: 10,
          price: 5,
        });

      const res = await request(app.getHttpServer())
        .get('/api/inventory/items/low-stock').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      const lowItems = res.body as Array<{ name: string; stock: number; minStock: number }>;
      expect(lowItems.some(i => i.name === '低库存测试品')).toBe(true);
      expect(lowItems.every(i => Number(i.stock) <= Number(i.minStock))).toBe(true);
    });
  });

  describe('库存更新与删除', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'UPDATE-DEL',
          name: '更新删除测试品',
          category: '耗材',
          unit: '个',
          stock: 10,
          price: 10,
        });
      itemId = res.body.id;
    });

    it('PATCH /inventory/items/:id - 更新库存项信息', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '更新后的名称', price: 99, minStock: 20 })
        .expect(HttpStatus.OK);
      expect(res.body.name).toBe('更新后的名称');
      expect(Number(res.body.price)).toBe(99);
      expect(Number(res.body.minStock)).toBe(20);
    });

    it('DELETE /inventory/items/:id - 软删除库存项', async () => {
      await request(app.getHttpServer())
        .delete(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);

      const item = db.prepare('SELECT deletedAt FROM InventoryItem WHERE id = ?').get(itemId) as { deletedAt: string | null };
      expect(item.deletedAt).not.toBeNull();
    });

    it('DELETE /inventory/items/:id - 删除后列表中不再显示', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      const items = res.body.items as Array<{ id: string }>;
      expect(items.some(i => i.id === itemId)).toBe(false);
    });
  });

  describe('权限验证', () => {
    it('未带 token 访问返回 401', async () => {
      await request(app.getHttpServer())
        .get('/api/inventory/items')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('未带 token 创建库存项返回 401', async () => {
      await request(app.getHttpServer())
        .post('/api/inventory/items')
        .send({ name: '测试', category: '耗材', unit: '个' })
        .expect(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('无效操作类型', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'INVALID-TYPE',
          name: '无效类型测试',
          category: '耗材',
          unit: '个',
          stock: 10,
          price: 10,
        });
      itemId = res.body.id;
    });

    it('POST /inventory/transactions - 无效操作类型返回 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'INVALID', quantity: 10 })
        .expect(HttpStatus.BAD_REQUEST);
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});
