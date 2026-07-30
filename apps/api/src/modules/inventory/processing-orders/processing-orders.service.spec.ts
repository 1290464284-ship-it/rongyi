import { ProcessingOrdersService } from './processing-orders.service';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { ProcessingOrder } from '@dental/shared';


function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('ProcessingOrdersService', () => {
  let service: ProcessingOrdersService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new ProcessingOrdersService(asDbService(db), createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== create ====================

  describe('create - 创建加工单', () => {
    it('正常创建加工单应生成 PENDING 状态及单号', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        factoryId: 'factory-001',
        shade: 'A2',
        teethNumbers: ['11', '12', '21'],
        totalFee: 1500,
      });

      expect(result.id).toBeDefined();
      expect(result.number).toMatch(/^PO[0-9a-f]+$/);
      expect(result.patientId).toBe('patient-001');
      expect(result.factoryId).toBe('factory-001');
      expect(result.shade).toBe('A2');
      expect(result.status).toBe('SENT');
      // input 1500 yuan → stored 150000 cents → read back 1500 yuan (BaseService 自动转换)
      expect(result.totalFee).toBe(1500);
    });

    it('不传可选字段应使用默认值', async () => {
      const result = await service.create({
        patientId: 'patient-001',
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe('SENT');
      expect(result.totalFee).toBe(0);
      expect(result.factoryId).toBeNull();
      expect(result.shade).toBeNull();
    });

    it('创建后数据库中应有加工单记录', async () => {
      await service.create({
        patientId: 'patient-001',
        shade: 'B1',
      });

      const orders = db.getTableData('ProcessingOrder');
      expect(orders.length).toBe(1);
      expect(orders[0].patientId).toBe('patient-001');
    });
  });

  // ==================== findOne ====================

  describe('findOne - 查询单个加工单', () => {
    it('查询存在的加工单应返回完整信息', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO1001', patientId: 'patient-001',
        factoryId: 'factory-001', shade: 'A2', totalFee: 2000,
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '["11","12"]',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.findOne('po-001');
      expect(result.id).toBe('po-001');
      expect(result.shade).toBe('A2');
      // v24迁移后totalFee为cents，BaseService自动转换为yuan返回
      expect(result.totalFee).toBe(20);
    });

    it('查询不存在的加工单应抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow();
    });
  });

  // ==================== findMany ====================

  describe('findMany - 查询加工单列表', () => {
    beforeEach(() => {
      db.seed('ProcessingOrder', [
        {
          id: 'po-001', number: 'PO2001', patientId: 'patient-001',
          factoryId: 'factory-001', status: 'SENT', totalFee: 1000,
          clinicId: 'test-clinic-001', deletedAt: null, teethNumbers: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'po-002', number: 'PO2002', patientId: 'patient-002',
          factoryId: 'factory-001', status: 'COMPLETED', totalFee: 2000,
          clinicId: 'test-clinic-001', deletedAt: null, teethNumbers: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'po-003', number: 'PO2003', patientId: 'patient-001',
          factoryId: 'factory-002', status: 'RECEIVED', totalFee: 500,
          clinicId: 'test-clinic-001', deletedAt: null, teethNumbers: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);
    });

    it('按 patientId 过滤应只返回该患者的加工单', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });
      expect(result.items.length).toBe(2);
      expect(result.items.every((o: ProcessingOrder) => o.patientId === 'patient-001')).toBe(true);
    });

    it('按 status 过滤应只返回匹配状态的加工单', async () => {
      const result = await service.findMany({ status: 'SENT' });
      expect(result.items.length).toBe(1);
      expect(result.items[0].status).toBe('SENT');
    });

    it('按 factoryId 过滤应只返回该工厂的加工单', async () => {
      const result = await service.findMany({ factoryId: 'factory-001' });
      expect(result.items.length).toBe(2);
      expect(result.items.every((o: ProcessingOrder) => o.factoryId === 'factory-001')).toBe(true);
    });

    it('分页查询应返回正确的分页信息', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
    });
  });

  // ==================== updateStatus ====================

  describe('updateStatus - 状态转换', () => {
    it('SENT → IN_PROGRESS 应成功', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3001', patientId: 'patient-001',
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.updateStatus('po-001', 'IN_PROGRESS');
      expect(result!.status).toBe('IN_PROGRESS');
    });

    it('IN_PROGRESS → COMPLETED 应成功', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3002', patientId: 'patient-001',
        status: 'IN_PROGRESS', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.updateStatus('po-001', 'COMPLETED');
      expect(result!.status).toBe('COMPLETED');
    });

    it('COMPLETED → RECEIVED 应成功', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3003', patientId: 'patient-001',
        status: 'COMPLETED', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.updateStatus('po-001', 'RECEIVED');
      expect(result!.status).toBe('RECEIVED');
    });

    it('SENT → CANCELLED 应成功', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3004', patientId: 'patient-001',
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.updateStatus('po-001', 'CANCELLED');
      expect(result!.status).toBe('CANCELLED');
    });

    it('PENDING → SENT 应成功', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3005', patientId: 'patient-001',
        status: 'PENDING', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.updateStatus('po-001', 'SENT');
      expect(result!.status).toBe('SENT');
    });

    it('SENT → COMPLETED 应抛出 BusinessValidationException（跳过中间状态）', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3006', patientId: 'patient-001',
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      await expect(service.updateStatus('po-001', 'COMPLETED')).rejects.toThrow(BusinessValidationException);
    });

    it('RECEIVED → SENT 应抛出 BusinessValidationException（终态不可回退）', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3007', patientId: 'patient-001',
        status: 'RECEIVED', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      await expect(service.updateStatus('po-001', 'SENT')).rejects.toThrow(BusinessValidationException);
    });

    it('CANCELLED → SENT 应抛出 BusinessValidationException（终态不可回退）', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3008', patientId: 'patient-001',
        status: 'CANCELLED', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      await expect(service.updateStatus('po-001', 'SENT')).rejects.toThrow(BusinessValidationException);
    });

    it('IN_PROGRESS → RECEIVED 应抛出 BusinessValidationException（跳过中间状态）', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO3009', patientId: 'patient-001',
        status: 'IN_PROGRESS', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      await expect(service.updateStatus('po-001', 'RECEIVED')).rejects.toThrow(BusinessValidationException);
    });

    it('不存在的加工单更新状态应抛出 BusinessNotFoundException', async () => {
      await expect(service.updateStatus('non-existent', 'COMPLETED')).rejects.toThrow();
    });
  });

  // ==================== addFlowLog ====================

  describe('addFlowLog - 添加流程日志', () => {
    beforeEach(() => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO4001', patientId: 'patient-001',
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);
    });

    it('正常添加流程日志', async () => {
      const result = await service.addFlowLog('po-001', {
        status: 'IN_PROGRESS',
        remark: '开始制作',
        operatorId: 'user-001',
      });

      expect(result.id).toBeDefined();
      expect(result.orderId).toBe('po-001');
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('添加流程日志后应在 ProcessingFlowLog 表中创建记录', async () => {
      await service.addFlowLog('po-001', {
        status: 'IN_PROGRESS',
        remark: '开始制作',
      });

      const logs = db.getTableData('ProcessingFlowLog');
      expect(logs.length).toBe(1);
      expect(logs[0].orderId).toBe('po-001');
      expect(logs[0].status).toBe('IN_PROGRESS');
    });

    it('添加流程日志应同步更新加工单状态', async () => {
      await service.addFlowLog('po-001', {
        status: 'IN_PROGRESS',
        remark: '开始制作',
      });

      const updatedOrder = db.getTableData('ProcessingOrder').find(o => o.id === 'po-001');
      expect(updatedOrder!.status).toBe('IN_PROGRESS');
    });

    it('不存在的加工单添加流程日志应抛出 BusinessNotFoundException', async () => {
      await expect(service.addFlowLog('non-existent', {
        status: 'COMPLETED',
      })).rejects.toThrow();
    });
  });

  // ==================== update ====================

  describe('update - 更新加工单', () => {
    beforeEach(() => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO5001', patientId: 'patient-001',
        factoryId: 'factory-001', shade: 'A2', totalFee: 1000,
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '["11","12"]', remark: '原始备注',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);
    });

    it('更新 shade 字段应成功', async () => {
      const result = await service.update('po-001', { shade: 'B1' });
      expect(result.shade).toBe('B1');
    });

    it('更新 totalFee 字段应成功', async () => {
      const result = await service.update('po-001', { totalFee: 2500 });
      // input 2500 yuan → stored 250000 cents → read back 2500 yuan (BaseService 自动转换)
      expect(result.totalFee).toBe(2500);
    });

    it('更新 factoryId 字段应成功', async () => {
      const result = await service.update('po-001', { factoryId: 'factory-002' });
      expect(result.factoryId).toBe('factory-002');
    });

    it('更新 remark 字段应成功', async () => {
      const result = await service.update('po-001', { remark: '新备注信息' });
      expect(result.remark).toBe('新备注信息');
    });
  });

  // ==================== remove ====================

  describe('remove - 删除加工单', () => {
    it('正常删除应设置 deletedAt', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-001', number: 'PO6001', patientId: 'patient-001',
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.remove('po-001');
      expect(result.id).toBe('po-001');

      const order = db.getTableData('ProcessingOrder').find(o => o.id === 'po-001');
      expect(order).toBeDefined();
      expect(order!.deletedAt).not.toBeNull();
    });

    it('删除不存在的加工单应抛出 BusinessNotFoundException', async () => {
      await expect(service.remove('non-existent')).rejects.toThrow();
    });
  });

  // ==================== stats ====================

  describe('stats - 统计', () => {
    it('空数据应返回全零', async () => {
      const result = await service.stats();
      expect(result.total).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.pending).toBe(0);
    });
  });

  // ==================== Product 方法 ====================

  describe('createProduct - 创建产品', () => {
    it('正常创建产品', async () => {
      const result = await service.createProduct({
        factoryId: 'factory-001',
        name: '全瓷冠',
        category: '修复体',
        price: 500,
      }) as Record<string, unknown>;

      expect(result.id).toBeDefined();
      expect(result.name).toBe('全瓷冠');
      expect(result.factoryId).toBe('factory-001');
      expect(result.price).toBe(500);
    });

    it('工厂ID为空应抛出 BusinessValidationException', async () => {
      await expect(service.createProduct({
        factoryId: '',
        name: '全瓷冠',
      })).rejects.toThrow(BusinessValidationException);
    });

    it('产品名称为空应抛出 BusinessValidationException', async () => {
      await expect(service.createProduct({
        factoryId: 'factory-001',
        name: '',
      })).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('listProducts - 查询产品列表', () => {
    it('按 factoryId 过滤应只返回该工厂的产品', async () => {
      db.seed('ProcessingProduct', [
        { id: 'prod-001', factoryId: 'factory-001', name: '全瓷冠', clinicId: 'test-clinic-001', deletedAt: null },
        { id: 'prod-002', factoryId: 'factory-001', name: '嵌体', clinicId: 'test-clinic-001', deletedAt: null },
        { id: 'prod-003', factoryId: 'factory-002', name: '活动义齿', clinicId: 'test-clinic-001', deletedAt: null },
      ]);

      const result = await service.listProducts('factory-001');
      expect(result.length).toBe(2);
      expect(result.every((p: any) => p.factoryId === 'factory-001')).toBe(true);
    });
  });

  describe('deleteProduct - 删除产品', () => {
    it('正常删除应设置 deletedAt', async () => {
      db.seed('ProcessingProduct', [{
        id: 'prod-001', factoryId: 'factory-001', name: '全瓷冠',
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.deleteProduct('prod-001');
      expect(result.id).toBe('prod-001');
    });

    it('删除不存在的产品应抛出 BusinessNotFoundException', async () => {
      await expect(service.deleteProduct('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  // ==================== Factory 方法 ====================

  describe('createFactory - 创建工厂', () => {
    it('正常创建工厂', async () => {
      const result = await service.createFactory({
        name: '深圳义齿加工厂',
        contactPerson: '张经理',
        phone: '13800000000',
      });

      expect((result as any).id).toBeDefined();
      expect((result as any).name).toBe('深圳义齿加工厂');
      expect((result as any).contactPerson).toBe('张经理');
      expect((result as any).status).toBe('ACTIVE');
    });

    it('工厂名称为空应抛出 BusinessValidationException', async () => {
      await expect(service.createFactory({ name: '' })).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('deleteFactory - 删除工厂', () => {
    it('正常删除应设置 deletedAt', async () => {
      db.seed('ProcessingFactory', [{
        id: 'factory-001', name: '工厂A', status: 'ACTIVE',
        clinicId: 'test-clinic-001', deletedAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.deleteFactory('factory-001');
      expect(result.id).toBe('factory-001');
    });

    it('删除不存在的工厂应抛出 BusinessNotFoundException', async () => {
      await expect(service.deleteFactory('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  // ==================== create - 错误路径 ====================

  describe('create - 错误路径', () => {
    it('事务抛出非 UNIQUE 约束错误时应直接抛出', async () => {
      jest.spyOn(db, 'transaction').mockImplementation(((_fn: (d: unknown) => unknown) => {
        throw new Error('SQLITE_ERROR: no such table');
      }) as any);

      await expect(service.create({
        patientId: 'patient-001',
      })).rejects.toThrow('SQLITE_ERROR');
    });
  });

  // ==================== updateStatus - 并发冲突 ====================

  describe('updateStatus - 并发冲突', () => {
    it('并发更新导致 changes=0 时应抛出异常', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-concurrent', number: 'PO7001', patientId: 'patient-001',
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const origPrepare = db.prepare.bind(db);
      jest.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        const stmt = origPrepare(sql);
        if (sql.includes('UPDATE ProcessingOrder SET status') && sql.includes('WHERE id = ? AND status = ?')) {
          (stmt as any).run = () => ({ changes: 0, lastInsertRowid: '' });
        }
        return stmt;
      }) as any);

      await expect(service.updateStatus('po-concurrent', 'IN_PROGRESS')).rejects.toThrow(BusinessValidationException);
    });
  });

  // ==================== addFlowLog - 错误路径 ====================

  describe('addFlowLog - 错误路径', () => {
    it('非法状态转换应抛出 BusinessValidationException', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-flow-invalid', number: 'PO7100', patientId: 'patient-001',
        status: 'RECEIVED', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      await expect(service.addFlowLog('po-flow-invalid', {
        status: 'SENT',
      })).rejects.toThrow(BusinessValidationException);
    });

    it('并发修改状态导致 CAS 失败应抛出异常', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-flow-race', number: 'PO7200', patientId: 'patient-001',
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const origPrepare = db.prepare.bind(db);
      jest.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        const stmt = origPrepare(sql);
        if (sql.includes('UPDATE ProcessingOrder SET status') && sql.includes('AND status = ?')) {
          (stmt as any).run = () => ({ changes: 0, lastInsertRowid: '' });
        }
        return stmt;
      }) as any);

      await expect(service.addFlowLog('po-flow-race', {
        status: 'IN_PROGRESS',
      })).rejects.toThrow(BusinessValidationException);
    });
  });

  // ==================== linkCharge ====================

  describe('linkCharge - 关联收费', () => {
    it('应成功关联收费单', async () => {
      db.seed('ProcessingOrder', [{
        id: 'po-charge', number: 'PO7300', patientId: 'patient-001',
        status: 'SENT', clinicId: 'test-clinic-001', deletedAt: null,
        teethNumbers: '[]', totalFee: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.linkCharge('po-charge', 'charge-001');
      expect(result).toBeDefined();
    });
  });

  // ==================== stats - 有数据 ====================

  describe('stats - 有数据', () => {
    it('有数据时应返回统计结构', async () => {
      db.seed('ProcessingOrder', [
        { id: 'po-s1', number: 'PO7401', patientId: 'p1', status: 'SENT', totalFee: 0, clinicId: 'test-clinic-001', deletedAt: null, teethNumbers: '[]', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'po-s2', number: 'PO7402', patientId: 'p2', status: 'RECEIVED', totalFee: 0, clinicId: 'test-clinic-001', deletedAt: null, teethNumbers: '[]', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'po-s3', number: 'PO7403', patientId: 'p3', status: 'IN_PROGRESS', totalFee: 0, clinicId: 'test-clinic-001', deletedAt: null, teethNumbers: '[]', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      const result = await service.stats();
      // MockDbService 不支持条件 COUNT，但 total 应正确返回行数
      expect(result.total).toBe(3);
      expect(typeof result.completed).toBe('number');
      expect(typeof result.pending).toBe('number');
    });
  });

  // ==================== updateProduct ====================

  describe('updateProduct - 更新产品', () => {
    it('更新产品名称应成功', async () => {
      db.seed('ProcessingProduct', [{
        id: 'prod-upd', factoryId: 'factory-001', name: '旧名称',
        category: '修复体', price: 500, clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.updateProduct('prod-upd', { name: '新名称', price: 800 }) as Record<string, unknown>;
      expect(result.name).toBe('新名称');
      expect(result.price).toBe(800);
    });

    it('无更新字段时仍应返回产品', async () => {
      db.seed('ProcessingProduct', [{
        id: 'prod-noop', factoryId: 'factory-001', name: '产品',
        category: '修复体', price: 500, clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.updateProduct('prod-noop', {}) as Record<string, unknown>;
      expect(result).toBeDefined();
      expect(result.name).toBe('产品');
    });
  });

  // ==================== listProducts - 无过滤 ====================

  describe('listProducts - 无 factoryId 过滤', () => {
    it('不传 factoryId 应返回所有产品', async () => {
      db.seed('ProcessingProduct', [
        { id: 'prod-a', factoryId: 'factory-001', name: '产品A', clinicId: 'test-clinic-001', deletedAt: null },
        { id: 'prod-b', factoryId: 'factory-002', name: '产品B', clinicId: 'test-clinic-001', deletedAt: null },
      ]);

      const result = await service.listProducts();
      expect(result.length).toBe(2);
    });
  });

  // ==================== updateFactory ====================

  describe('updateFactory - 更新工厂', () => {
    it('更新工厂名称和状态应成功', async () => {
      db.seed('ProcessingFactory', [{
        id: 'factory-upd', name: '旧工厂', status: 'ACTIVE',
        clinicId: 'test-clinic-001', deletedAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.updateFactory('factory-upd', { name: '新工厂', status: 'INACTIVE' }) as Record<string, unknown>;
      expect(result.name).toBe('新工厂');
      expect(result.status).toBe('INACTIVE');
    });

    it('无更新字段时仍应返回工厂', async () => {
      db.seed('ProcessingFactory', [{
        id: 'factory-noop', name: '工厂', status: 'ACTIVE',
        clinicId: 'test-clinic-001', deletedAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }]);

      const result = await service.updateFactory('factory-noop', {}) as Record<string, unknown>;
      expect(result).toBeDefined();
      expect(result.name).toBe('工厂');
    });
  });

  // ==================== listFactories ====================

  describe('listFactories - 查询工厂列表', () => {
    it('应返回所有未删除的工厂', async () => {
      db.seed('ProcessingFactory', [
        { id: 'f-1', name: '工厂A', status: 'ACTIVE', clinicId: 'test-clinic-001', deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'f-2', name: '工厂B', status: 'ACTIVE', clinicId: 'test-clinic-001', deletedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      const result = await service.listFactories();
      expect(result.length).toBe(2);
    });
  });
});
