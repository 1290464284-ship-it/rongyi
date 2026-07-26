import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';
import { resetTestMode, _isTestMode } from '../src/db/database';

describe('Inventory Modules (e2e) - 库存管理完整业务流程', () => {
  let app: INestApplication;
  let db: DbService;
  let bossToken: string;
  let receptionistToken: string;

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
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)').run(
      crypto.randomUUID(), 'boss_inv_mod', hash, '库存模块老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString()
    );
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)').run(
      crypto.randomUUID(), 'recep_inv_mod', hash, '库存模块前台', 'RECEPTIONIST', 'test-clinic-001', new Date().toISOString(), new Date().toISOString()
    );

    const bossRes = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'boss_inv_mod', password: TEST_USER_PASSWORD });
    bossToken = extractAccessToken(bossRes);

    const recepRes = await request(app.getHttpServer()).post('/api/auth/login').send({ username: 'recep_inv_mod', password: TEST_USER_PASSWORD });
    receptionistToken = extractAccessToken(recepRes);
  });

  afterAll(async () => {
    await app.close();
    resetTestMode();
    (_isTestMode as unknown as boolean) = false;
    delete process.env.TEST_DB_MEMORY;
  });

  describe('库存物品管理', () => {
    let createdItemId: string;

    it('POST /inventory/items - 创建库存物品', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'INV-MOD-001',
          name: '牙科专用消毒湿巾',
          category: '耗材',
          unit: '包',
          stock: 200,
          minStock: 30,
          price: 45,
          spec: '100片/包',
          location: 'B区-05货架',
        })
        .expect(HttpStatus.CREATED);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('牙科专用消毒湿巾');
      expect(Number(res.body.stock)).toBe(200);
      expect(Number(res.body.minStock)).toBe(30);
      createdItemId = res.body.id;
    });

    it('GET /inventory/items - 查询库存列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /inventory/items/:id - 查询库存详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/inventory/items/${createdItemId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.id).toBe(createdItemId);
      expect(res.body.name).toBe('牙科专用消毒湿巾');
    });

    it('PATCH /inventory/items/:id - 更新库存物品信息', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/inventory/items/${createdItemId}`).set('Authorization', `Bearer ${bossToken}`)
        .send({ name: '更新后的消毒湿巾', price: 48, minStock: 40 })
        .expect(HttpStatus.OK);
      expect(res.body.name).toBe('更新后的消毒湿巾');
      expect(Number(res.body.price)).toBe(48);
      expect(Number(res.body.minStock)).toBe(40);
    });
  });

  describe('库存入库流程', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'INV-IN-001',
          name: '一次性口罩',
          category: '耗材',
          unit: '盒',
          stock: 100,
          minStock: 20,
          price: 30,
        });
      itemId = res.body.id;
    });

    it('POST /inventory/transactions - 入库操作', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'IN', quantity: 50, unitPrice: 28, remark: '采购入库' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(150);
    });

    it('入库后库存数量正确增加', async () => {
      const beforeRes = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`);
      const beforeStock = Number(beforeRes.body.stock);

      await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'IN', quantity: 30, remark: '补充入库' })
        .expect(HttpStatus.CREATED);

      const afterRes = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`);
      const afterStock = Number(afterRes.body.stock);

      expect(afterStock).toBe(beforeStock + 30);
    });
  });

  describe('库存出库流程', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'INV-OUT-001',
          name: '医用手套',
          category: '耗材',
          unit: '盒',
          stock: 80,
          minStock: 15,
          price: 60,
        });
      itemId = res.body.id;
    });

    it('POST /inventory/transactions - 出库操作', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 20, remark: '诊室领用' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(60);
    });

    it('出库后库存数量正确减少', async () => {
      const beforeRes = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`);
      const beforeStock = Number(beforeRes.body.stock);

      await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 15, remark: '日常消耗' })
        .expect(HttpStatus.CREATED);

      const afterRes = await request(app.getHttpServer())
        .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${bossToken}`);
      const afterStock = Number(afterRes.body.stock);

      expect(afterStock).toBe(beforeStock - 15);
    });

    it('出库数量超过库存报错', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'OUT', quantity: 9999, remark: '超额出库' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(res.body.message).toBeDefined();
    });
  });

  describe('库存调整流程', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'INV-ADJ-001',
          name: '调整测试物品',
          category: '耗材',
          unit: '件',
          stock: 100,
          minStock: 10,
          price: 100,
        });
      itemId = res.body.id;
    });

    it('POST /inventory/transactions - 库存调整（增加）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'ADJUST', quantity: 150, remark: '盘点调整-增加' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(150);
    });

    it('POST /inventory/transactions - 库存调整（减少）', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .send({ itemId, type: 'ADJUST', quantity: 80, remark: '盘点调整-减少' })
        .expect(HttpStatus.CREATED);
      expect(Number(res.body.stock)).toBe(80);
    });
  });

  describe('低库存预警', () => {
    it('GET /inventory/items/low-stock - 查询低库存预警列表', async () => {
      await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'INV-LOW-001',
          name: '低库存预警测试',
          category: '耗材',
          unit: '个',
          stock: 5,
          minStock: 20,
          price: 10,
        });

      const res = await request(app.getHttpServer())
        .get('/api/inventory/items/low-stock').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      const lowItems = res.body as Array<{ name: string; stock: number; minStock: number }>;
      expect(lowItems.some(i => i.name === '低库存预警测试')).toBe(true);
      expect(lowItems.every(i => Number(i.stock) <= Number(i.minStock))).toBe(true);
    });
  });

  describe('库存流水查询', () => {
    let itemId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${bossToken}`)
        .send({
          code: 'INV-TXN-001',
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
    });

    it('GET /inventory/transactions - 查询库存流水', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/transactions').set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('GET /inventory/transactions?itemId=xxx - 按物品过滤流水', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/inventory/transactions?itemId=${itemId}`).set('Authorization', `Bearer ${bossToken}`)
        .expect(HttpStatus.OK);
      expect(Array.isArray(res.body)).toBe(true);
      const txns = res.body as Array<{ itemId: string }>;
      expect(txns.every(t => t.itemId === itemId)).toBe(true);
    });
  });

  describe('权限验证', () => {
    it('RECEPTIONIST 可以查询库存列表', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory/items').set('Authorization', `Bearer ${receptionistToken}`)
        .expect(HttpStatus.OK);
      expect(res.body.items).toBeDefined();
    });

    it('RECEPTIONIST 可以进行库存操作', async () => {
      const itemRes = await request(app.getHttpServer())
        .post('/api/inventory/items').set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          code: 'INV-RECEP-001',
          name: '前台创建物品',
          category: '耗材',
          unit: '个',
          stock: 10,
          price: 5,
        })
        .expect(HttpStatus.CREATED);

      await request(app.getHttpServer())
        .post('/api/inventory/transactions').set('Authorization', `Bearer ${receptionistToken}`)
        .send({ itemId: itemRes.body.id, type: 'OUT', quantity: 2, remark: '前台出库' })
        .expect(HttpStatus.CREATED);
    });

    it('未带 token 返回 401', async () => {
      await request(app.getHttpServer()).get('/api/inventory/items').expect(HttpStatus.UNAUTHORIZED);
    });
  });
});