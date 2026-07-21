import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { _isTestMode, resetTestMode } from '../src/db/database';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let bossUserId: string;
  let supplierId: string;

  const cleanTables = [
    'InventoryTransaction', 'InventoryItem', 'Supplier',
    'User', 'OperationLog',
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

    const hash = await bcrypt.hash('123456', 10);
    bossUserId = crypto.randomUUID();
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?)').run(
      bossUserId, 'boss_inv', hash, '库存测试老板', 'BOSS', new Date().toISOString(), new Date().toISOString()
    );

    supplierId = crypto.randomUUID();
    db.prepare('INSERT INTO Supplier (id, name, contactPerson, phone, address, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)').run(
      supplierId, '测试供应商A', '张三', '13800000001', '测试地址1', new Date().toISOString(), new Date().toISOString()
    );

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss_inv', password: '123456' });
    bossToken = res.body.access_token;
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
        .expect(201);
      expect(res.body.name).toBe('新建供应商');
      expect(res.body.id).toBeDefined();
    });

    it('GET /suppliers - 查询供应商列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/suppliers').set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(Array.isArray(res.body.items) || Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('库存项管理', () => {
    let itemId: string;

    it('POST /inventory/items - 创建库存项', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'ITEM001',
          name: '一次性手套',
          category: '耗材',
          unit: '盒',
          stock: 100,
          minStock: 10,
          price: 25.5,
          supplierId,
        })
        .expect(201);
      expect(res.body.name).toBe('一次性手套');
      expect(Number(res.body.stock)).toBe(100);
      itemId = res.body.id;
    });

    it('GET /inventory/items - 查询库存列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('GET /inventory/items/:id - 查询单个库存项', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(res.body.id).toBe(itemId);
      expect(res.body.name).toBe('一次性手套');
    });

    it('PATCH /inventory/items/:id - 更新库存项', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '一次性医用手套', price: 30 })
        .expect(200);
      expect(res.body.name).toBe('一次性医用手套');
      expect(Number(res.body.price)).toBe(30);
    });
  });

  describe('库存操作', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'ITEM002',
          name: '牙科钻头',
          category: '耗材',
          unit: '支',
          stock: 50,
          minStock: 20,
          price: 80,
        });
      itemId = res.body.id;
    });

    it('POST /inventory/transactions - 入库操作', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'IN', quantity: 30, unitPrice: 75, remark: '采购入库' })
        .expect(201);
      expect(Number(res.body.stock)).toBe(80);
    });

    it('POST /inventory/transactions - 出库操作', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 10, remark: '诊室领用' })
        .expect(201);
      expect(Number(res.body.stock)).toBe(70);
    });

    it('POST /inventory/transactions - 出库数量超过库存时报错', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 9999, remark: '超额出库' })
        .expect(400);
      expect(res.body.message).toBeDefined();
    });

    it('POST /inventory/transactions - 库存调整', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'ADJUST', quantity: 200, remark: '盘点调整' })
        .expect(201);
      expect(Number(res.body.stock)).toBe(200);
    });

    it('POST /inventory/transactions - 无效操作类型报错', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'INVALID', quantity: 10 })
        .expect(400);
    });

    it('GET /inventory/transactions - 查询库存流水', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('GET /inventory/items/low-stock - 查询低库存预警', async () => {
      await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'LOW001',
          name: '低库存测试品',
          category: '耗材',
          unit: '个',
          stock: 2,
          minStock: 10,
          price: 5,
        });

      const res = await request(app.getHttpServer())
        .get('/api/inventory/items/low-stock').set('Authorization', `Bearer ${bossToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      const lowItems = res.body as Array<{ name: string }>;
      expect(lowItems.some(i => i.name === '低库存测试品')).toBe(true);
    });
  });

  describe('采购订单', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'PO_ITEM',
          name: '采购测试耗材',
          category: '耗材',
          unit: '箱',
          stock: 0,
          minStock: 5,
          price: 200,
          supplierId,
        });
      itemId = res.body.id;
    });

    it('POST /purchase-orders - 创建采购订单', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/purchase-orders').set('Authorization', `Bearer ${bossToken}`)
        .send({
          supplierId,
          items: [{ itemId, name: '采购测试耗材', quantity: 10, unitPrice: 180 }],
          remark: '测试采购单',
        });
      expect([201, 200]).toContain(res.status);
      expect(res.body.id).toBeDefined();
    });

    it('GET /purchase-orders - 查询采购订单列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/purchase-orders').set('Authorization', `Bearer ${bossToken}`);
      expect([200, 201]).toContain(res.status);
    });
  });

  describe('库存删除', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'DEL_TEST',
          name: '待删除测试品',
          category: '耗材',
          unit: '个',
          stock: 10,
          price: 10,
        });
      itemId = res.body.id;
    });

    it('DELETE /inventory/items/:id - 软删除库存项', async () => {
      await request(app.getHttpServer())
        .delete(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(200);

      const item = db.prepare('SELECT deletedAt FROM InventoryItem WHERE id = ?').get(itemId) as { deletedAt: string | null };
      expect(item.deletedAt).not.toBeNull();
    });
  });
});
