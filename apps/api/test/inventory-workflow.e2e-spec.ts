/**
 * 库存完整流程 E2E 测试
 *
 * 流程：
 *   创建供应商 → 创建库存物品 → 创建采购订单 → 采购入库（收货）→ 库存调整 →
 *   创建加工单（需患者+加工厂）→ 出库 → 库存预警检查 → 验证库存变动记录
 *
 * 测试之间共享状态，按顺序执行（jest maxWorkers=1）。
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { DbService } from '../src/db/db.service';
import { TEST_USER_PASSWORD, extractAccessToken } from './test-helpers';

describe('Inventory Workflow (e2e) - 库存完整流程', () => {
  let app: INestApplication;
  let db: DbService;
  let token: string;
  let bossUserId: string;

  // 流程中共享的业务实体 ID
  let supplierId: string;
  let itemId: string;
  let purchaseOrderId: string;
  let patientId: string;
  let factoryId: string;
  let processingOrderId: string;

  const tables = [
    'UsedRefreshToken', 'IdempotencyRecord',
    'ProcessingOrderItem', 'ProcessingFlowLog', 'ProcessingOrder',
    'ProcessingProduct', 'ProcessingFactory',
    'PurchaseOrderItem', 'PurchaseOrder',
    'InventoryTransaction', 'InventoryItem', 'Supplier',
    'TreatmentPlanItem', 'TreatmentPlan',
    'Visit', 'Appointment', 'ToothRecord', 'Registration',
    'MedicalRecord', 'OperationLog', 'AuditLog',
    'Patient', 'User',
  ];

  beforeAll(async () => {
    process.env.TEST_DB_MEMORY = '1';
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get(DbService);

    for (const t of tables) { try { db.exec(`DELETE FROM "${t}"`); } catch { /* ok */ } }

    const hash = await bcrypt.hash(TEST_USER_PASSWORD, 10);
    bossUserId = crypto.randomUUID();
    db.prepare('INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run('test-clinic-001', '测试诊所', 'TEST001', 1, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(bossUserId, 'boss_inv_wf', hash, '库存流程老板', 'BOSS', 'test-clinic-001', new Date().toISOString(), new Date().toISOString());

    const res = await request(app.getHttpServer())
      .post('/api/auth/login').send({ username: 'boss_inv_wf', password: TEST_USER_PASSWORD });
    token = extractAccessToken(res);
  });

  afterAll(async () => { await app.close(); });

  // ============ 供应商 ============
  it('步骤1：POST /suppliers - 创建供应商', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/suppliers').set('Authorization', `Bearer ${token}`)
      .send({ name: '库存流程供应商', contactPerson: '王经理', phone: '13833330001', address: '广州市天河区xxx路', remark: '主要耗材供应商' })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('库存流程供应商');
    supplierId = res.body.id;
  });

  // ============ 库存物品 ============
  it('步骤2：POST /inventory/items - 创建库存物品', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/items').set('Authorization', `Bearer ${token}`)
      .send({
        code: 'INV-WF-001',
        name: '光固化树脂',
        spec: '4g/支',
        category: '耗材',
        unit: '支',
        stock: 50,
        minStock: 20,
        price: 120,
        supplierId,
        location: 'A区-01货架',
      })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(Number(res.body.stock)).toBe(50);
    expect(Number(res.body.minStock)).toBe(20);
    itemId = res.body.id;
  });

  it('步骤2b：POST /inventory/items - 创建第二个低库存物品（用于预警测试）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/items').set('Authorization', `Bearer ${token}`)
      .send({
        code: 'INV-WF-LOW',
        name: '一次性吸唾管',
        category: '耗材',
        unit: '包',
        stock: 5,
        minStock: 30,
        price: 15,
      })
      .expect(HttpStatus.CREATED);
    expect(Number(res.body.stock)).toBeLessThanOrEqual(Number(res.body.minStock));
  });

  // ============ 采购入库 ============
  it('步骤3a：POST /purchase-orders - 创建采购订单', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/purchase-orders').set('Authorization', `Bearer ${token}`)
      .send({
        supplierId,
        remark: '库存流程采购',
        items: [{ itemId, name: '光固化树脂', spec: '4g/支', quantity: 30, unitPrice: 100 }],
      })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('PENDING');
    expect(Number(res.body.totalAmount)).toBe(3000);
    purchaseOrderId = res.body.id;
  });

  it('步骤3b：PATCH /purchase-orders/:id/receive - 采购入库（收货）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/purchase-orders/${purchaseOrderId}/receive`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('RECEIVED');
    // 验证库存已增加：50 + 30 = 80
    const itemRes = await request(app.getHttpServer())
      .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(Number(itemRes.body.stock)).toBe(80);
  });

  it('步骤3c：PATCH /purchase-orders/:id/receive - 重复收货返回 400（状态机校验）', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/purchase-orders/${purchaseOrderId}/receive`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  // ============ 库存调整 ============
  it('步骤4：POST /inventory/transactions - 库存调整（盘点调整为 75）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/transactions').set('Authorization', `Bearer ${token}`)
      .send({ itemId, type: 'ADJUST', quantity: 75, remark: '月末盘点调整' })
      .expect(HttpStatus.CREATED);
    expect(Number(res.body.stock)).toBe(75);
  });

  it('步骤4b：POST /inventory/transactions - 出库超过库存返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/transactions').set('Authorization', `Bearer ${token}`)
      .send({ itemId, type: 'OUT', quantity: 9999, remark: '超额出库' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  it('步骤4c：POST /inventory/transactions - 无效操作类型返回 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/transactions').set('Authorization', `Bearer ${token}`)
      .send({ itemId, type: 'INVALID', quantity: 10 })
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  // ============ 加工单 ============
  it('步骤5a：POST /patients - 创建患者（加工单依赖）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/patients').set('Authorization', `Bearer ${token}`)
      .send({ name: '库存流程患者', gender: 'MALE', phone: '13733330002' })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    patientId = res.body.id;
  });

  it('步骤5b：POST /processing-orders/factories - 创建加工厂', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/processing-orders/factories').set('Authorization', `Bearer ${token}`)
      .send({ name: '精益义齿加工中心', contactPerson: '李厂长', phone: '13833330003', address: '深圳市南山区' })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    factoryId = res.body.id;
  });

  it('步骤5c：POST /processing-orders - 创建加工单', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/processing-orders').set('Authorization', `Bearer ${token}`)
      .send({
        patientId,
        factoryId,
        doctorId: bossUserId,
        shade: 'A2',
        teethNumbers: ['16'],
        remark: '库存流程加工单',
        items: [
          { productName: '烤瓷牙冠', toothNumber: 16, quantity: 1, unitPrice: 1500 },
        ],
      })
      .expect(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.patientId).toBe(patientId);
    expect(res.body.factoryId).toBe(factoryId);
    expect(res.body.status).toBe('SENT');
    processingOrderId = res.body.id;
  });

  it('步骤5d：PATCH /processing-orders/:id/status - 加工单状态流转 SENT → IN_PROGRESS', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/processing-orders/${processingOrderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'IN_PROGRESS' })
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  it('步骤5e：PATCH /processing-orders/:id/status - 加工单状态流转 IN_PROGRESS → COMPLETED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/processing-orders/${processingOrderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' })
      .expect(HttpStatus.OK);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('步骤5f：PATCH /processing-orders/:id/status - 非法状态转换返回 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/processing-orders/${processingOrderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ status: 'SENT' })
      .expect(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
  });

  // ============ 出库 ============
  it('步骤6：POST /inventory/transactions - 出库 70 支（加工消耗）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/inventory/transactions').set('Authorization', `Bearer ${token}`)
      .send({ itemId, type: 'OUT', quantity: 70, remark: '加工单消耗' })
      .expect(HttpStatus.CREATED);
    // 75 - 70 = 5
    expect(Number(res.body.stock)).toBe(5);
  });

  // ============ 库存预警 ============
  it('步骤7：GET /inventory/items/low-stock - 库存预警检查', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/inventory/items/low-stock').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(Array.isArray(res.body)).toBe(true);
    const lowItems = res.body as Array<{ id: string; name: string; stock: number; minStock: number }>;
    // 主物品 stock=5 <= minStock=20，应出现在预警列表
    const mainItem = lowItems.find(i => i.id === itemId);
    expect(mainItem).toBeDefined();
    expect(Number(mainItem!.stock)).toBeLessThanOrEqual(Number(mainItem!.minStock));
    // 所有返回项都应满足 low stock 条件
    expect(lowItems.every(i => Number(i.stock) <= Number(i.minStock))).toBe(true);
  });

  // ============ 验证库存变动记录 ============
  it('步骤8a：GET /inventory/transactions - 验证库存变动记录（按物品过滤）', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/inventory/transactions?itemId=${itemId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(Array.isArray(res.body)).toBe(true);
    const txns = res.body as Array<{ type: string; quantity: number; remark: string }>;
    // 应包含：采购入库 IN(30)、调整 ADJUST(75)、出库 OUT(70)
    expect(txns.length).toBeGreaterThanOrEqual(3);
    const inTxn = txns.find(t => t.type === 'IN');
    const adjustTxn = txns.find(t => t.type === 'ADJUST');
    const outTxn = txns.find(t => t.type === 'OUT');
    expect(inTxn).toBeDefined();
    expect(Number(inTxn!.quantity)).toBe(30);
    expect(adjustTxn).toBeDefined();
    expect(Number(adjustTxn!.quantity)).toBe(75);
    expect(outTxn).toBeDefined();
    expect(Number(outTxn!.quantity)).toBe(70);
  });

  it('步骤8b：GET /inventory/transactions - 验证全部库存变动记录', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/inventory/transactions').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it('步骤8c：GET /inventory/items/:id - 验证物品最终库存为 5', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/inventory/items/${itemId}`).set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(Number(res.body.stock)).toBe(5);
    expect(res.body.name).toBe('光固化树脂');
  });

  it('步骤8d：GET /suppliers - 验证供应商列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/suppliers').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const supplier = res.body.items.find((s: { id: string }) => s.id === supplierId);
    expect(supplier).toBeDefined();
  });

  it('步骤8e：GET /purchase-orders - 验证采购订单列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/purchase-orders').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const po = res.body.items.find((p: { id: string }) => p.id === purchaseOrderId);
    expect(po).toBeDefined();
    expect(po.status).toBe('RECEIVED');
  });

  it('步骤8f：GET /processing-orders - 验证加工订单列表', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/processing-orders').set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    const order = res.body.items.find((o: { id: string }) => o.id === processingOrderId);
    expect(order).toBeDefined();
    expect(order.status).toBe('COMPLETED');
  });

  it('未带 token 返回 401', async () => {
    await request(app.getHttpServer()).get('/api/inventory/items').expect(HttpStatus.UNAUTHORIZED);
  });
});
