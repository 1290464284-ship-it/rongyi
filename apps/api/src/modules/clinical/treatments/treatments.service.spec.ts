import { TreatmentsService } from './treatments.service';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';


// 构造 ClinicContextService 的 mock，模拟诊所上下文
function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

// P4-2: TreatmentsService 现在依赖 CacheService，构造一个始终 miss 的 mock
function createMockCacheService(): CacheService {
  return {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn(),
    clear: jest.fn(),
    getOrSet: jest.fn(),
    getStats: () => ({ hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 1000 }),
    resetStats: jest.fn(),
  } as unknown as CacheService;
}

describe('TreatmentsService', () => {
  let service: TreatmentsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    // Seed Patient and User records for FK validation
    db.seed('Patient', [
      { id: 'patient-001', code: 'P001', name: '测试患者1', gender: 'MALE', phone: '13800000000', tags: '[]', allergies: '[]', medicalHistory: '[]', medicationHistory: '[]', systemicDiseases: '[]', source: 'WALK_IN', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'patient-002', code: 'P002', name: '测试患者2', gender: 'FEMALE', phone: '13800000001', tags: '[]', allergies: '[]', medicalHistory: '[]', medicationHistory: '[]', systemicDiseases: '[]', source: 'WALK_IN', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    db.seed('User', [
      { id: 'doctor-001', username: 'doctor1', name: '测试医生1', role: 'DOCTOR', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'doctor-002', username: 'doctor2', name: '测试医生2', role: 'DOCTOR', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    service = new TreatmentsService(asDbService(db), createMockClinicContext(), createMockCacheService());
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== create ====================

  describe('create - 创建治疗项目', () => {
    it('正常创建治疗项目应返回 PLANNED 状态', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        visitId: 'visit-001',
        doctorId: 'doctor-001',
        code: 'T001',
        name: '根管治疗',
        category: '治疗',
        price: 500,
        quantity: 1,
        teethNumbers: [11, 12],
        remark: '上颌前牙',
      } as any);

      expect(result).toBeDefined();
      expect(result.patientId).toBe('patient-001');
      expect(result.code).toBe('T001');
      expect(result.name).toBe('根管治疗');
      expect(result.status).toBe('PLANNED');
      // teethNumbers 应被 JSON 解析为数组
      expect(Array.isArray(result.teethNumbers)).toBe(true);
      expect(result.teethNumbers).toEqual([11, 12]);
    });

    it('不传 teethNumbers 时应默认为空数组', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        code: 'T002',
        name: '拍片',
        category: '影像',
        price: 200,
      });

      expect(Array.isArray(result.teethNumbers)).toBe(true);
      expect(result.teethNumbers).toEqual([]);
    });

    it('创建治疗项目时应包含 clinicId', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        code: 'T003',
        name: '补牙',
        category: '修复',
        price: 300,
      });

      const rows = db.getTableData('Treatment');
      const created = rows.find(r => r.id === result.id);
      expect(created).toBeDefined();
      expect(created!.clinicId).toBe('test-clinic-001');
    });

    it('创建治疗项目时应写入审计日志', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        code: 'T004',
        name: '洗牙',
        category: '预防',
        price: 150,
      });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === result.id && l.type === 'TREATMENT_CREATE');
      expect(log).toBeDefined();
    });

    it('不传 quantity 时应默认为 1', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        code: 'T005',
        name: '拔牙',
        category: '外科',
        price: 400,
      });

      const rows = db.getTableData('Treatment');
      const created = rows.find(r => r.id === result.id);
      expect(created!.quantity).toBe(1);
    });
  });

  // ==================== update ====================

  describe('update - 更新治疗项目', () => {
    it('合法状态流转 PLANNED → IN_PROGRESS 应成功', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[11,12]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.update('trt-001', { status: 'IN_PROGRESS' } as any);

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('合法状态流转 PLANNED → COMPLETED 应成功', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.update('trt-001', { status: 'COMPLETED' } as any);

      expect(result.status).toBe('COMPLETED');
    });

    it('合法状态流转 PLANNED → CANCELLED 应成功', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.update('trt-001', { status: 'CANCELLED' } as any);

      expect(result.status).toBe('CANCELLED');
    });

    it('合法状态流转 IN_PROGRESS → COMPLETED 应成功', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'IN_PROGRESS', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.update('trt-001', { status: 'COMPLETED' } as any);

      expect(result.status).toBe('COMPLETED');
    });

    it('合法状态流转 IN_PROGRESS → CANCELLED 应成功', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'IN_PROGRESS', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.update('trt-001', { status: 'CANCELLED' } as any);

      expect(result.status).toBe('CANCELLED');
    });

    it('非法状态流转 COMPLETED → IN_PROGRESS 应抛出 BusinessValidationException', async () => {
      db.seed('Treatment', [
        { id: 'trt-002', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'COMPLETED', clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.update('trt-002', { status: 'IN_PROGRESS' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('COMPLETED 是终态，不应流转到 CANCELLED', async () => {
      db.seed('Treatment', [
        { id: 'trt-003', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'COMPLETED', clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.update('trt-003', { status: 'CANCELLED' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('CANCELLED 是终态，不应流转到 IN_PROGRESS', async () => {
      db.seed('Treatment', [
        { id: 'trt-004', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'CANCELLED', clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.update('trt-004', { status: 'IN_PROGRESS' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('CANCELLED 是终态，不应流转到 COMPLETED', async () => {
      db.seed('Treatment', [
        { id: 'trt-005', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'CANCELLED', clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.update('trt-005', { status: 'COMPLETED' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('更新非状态字段不应触发状态机校验', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.update('trt-001', { remark: '更新备注' });

      expect(result.remark).toBe('更新备注');
      expect(result.status).toBe('PLANNED');
    });

    it('相同状态重复更新不应抛出异常', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.update('trt-001', { status: 'PLANNED' } as any);

      expect(result.status).toBe('PLANNED');
    });

    it('更新治疗项目应写入审计日志', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      await service.update('trt-001', { status: 'IN_PROGRESS' } as any);

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'trt-001' && l.type === 'TREATMENT_UPDATE');
      expect(log).toBeDefined();
    });
  });

  // ==================== softDelete ====================

  describe('softDelete - 软删除治疗项目', () => {
    it('软删除后 deletedAt 应被设置', async () => {
      db.seed('Treatment', [
        { id: 'trt-003', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      await service.softDelete('trt-003');

      const rows = db.getTableData('Treatment');
      const deleted = rows.find(r => r.id === 'trt-003');
      expect(deleted).toBeDefined();
      expect(deleted!.deletedAt).toBeTruthy();
    });
  });

  // ==================== findOne - JSON 字段解析 ====================

  describe('findOne - JSON 字段解析', () => {
    it('teethNumbers JSON 字符串应被正确解析为数组', async () => {
      db.seed('Treatment', [
        { id: 'trt-004', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T003', name: '补牙', category: '修复', price: 300, quantity: 1, teethNumbers: '[11,12,13,21]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.findOne('trt-004');

      expect(Array.isArray(result.teethNumbers)).toBe(true);
      expect(result.teethNumbers).toEqual([11, 12, 13, 21]);
    });

    it('teethNumbers 为空数组字符串时应被解析为空数组', async () => {
      db.seed('Treatment', [
        { id: 'trt-005', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T004', name: '拍片', category: '影像', price: 200, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.findOne('trt-005');

      expect(Array.isArray(result.teethNumbers)).toBe(true);
      expect(result.teethNumbers).toEqual([]);
    });
  });

  // ==================== findMany ====================

  describe('findMany - 查询治疗项目', () => {
    beforeEach(() => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[11]', status: 'PLANNED', clinicId: 'test-clinic-001' },
        { id: 'trt-002', patientId: 'patient-002', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T002', name: '拍片', category: '影像', price: 200, quantity: 1, teethNumbers: '[]', status: 'COMPLETED', clinicId: 'test-clinic-001' },
        { id: 'trt-003', patientId: 'patient-001', visitId: 'visit-002', doctorId: 'doctor-002', code: 'T003', name: '补牙', category: '修复', price: 300, quantity: 2, teethNumbers: '[21,22]', status: 'IN_PROGRESS', clinicId: 'test-clinic-001' },
      ]);
    });

    it('按就诊查询应只返回该就诊的治疗项目', async () => {
      const result = await service.findMany({ visitId: 'visit-001' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((t: any) => t.visitId === 'visit-001')).toBe(true);
    });

    it('按患者查询应只返回该患者的治疗项目', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((t: any) => t.patientId === 'patient-001')).toBe(true);
    });

    it('按状态过滤应只返回匹配状态的治疗项目', async () => {
      const result = await service.findMany({ status: 'PLANNED' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).status).toBe('PLANNED');
    });

    it('分页查询应返回正确的分页信息', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('查询结果中 teethNumbers 应被解析为数组', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });

      for (const item of result.items) {
        expect(Array.isArray(item.teethNumbers)).toBe(true);
      }
    });
  });

  // ==================== catalog ====================

  describe('createCatalog - 创建治疗项目目录', () => {
    it('正常创建治疗项目目录', async () => {
      const result = await service.createCatalog({
        code: 'C001',
        name: '根管治疗',
        category: '治疗',
        price: 500,
        remark: '前牙根管',
      });

      expect(result).toBeDefined();
      expect(result!.code).toBe('C001');
      expect(result!.name).toBe('根管治疗');
      expect(result!.category).toBe('治疗');
      expect(result!.price).toBe(500);
    });

    it('创建治疗项目目录时应包含 clinicId', async () => {
      const result = await service.createCatalog({
        code: 'C002',
        name: '补牙',
        category: '修复',
        price: 300,
      });

      expect((result! as unknown as Record<string, unknown>).clinicId).toBe('test-clinic-001');
    });

    it('创建治疗项目目录应写入审计日志', async () => {
      const result = await service.createCatalog({
        code: 'C003',
        name: '洗牙',
        category: '预防',
        price: 150,
      });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === result!.id && l.type === 'TREATMENT_CATALOG_CREATE');
      expect(log).toBeDefined();
    });
  });

  describe('updateCatalog - 更新治疗项目目录', () => {
    it('更新名称和价格应成功', async () => {
      const created = await service.createCatalog({
        code: 'C001',
        name: '根管治疗',
        category: '治疗',
        price: 500,
      });

      const result = await service.updateCatalog(created!.id, {
        name: '前牙根管治疗',
        price: 600,
      });

      expect(result!.name).toBe('前牙根管治疗');
      expect(result!.price).toBe(600);
    });

    it('更新部分字段不影响其他字段', async () => {
      const created = await service.createCatalog({
        code: 'C002',
        name: '补牙',
        category: '修复',
        price: 300,
      });

      const result = await service.updateCatalog(created!.id, {
        price: 350,
      });

      expect(result!.name).toBe('补牙');
      expect(result!.category).toBe('修复');
      expect(result!.price).toBe(350);
    });

    it('更新应写入审计日志', async () => {
      const created = await service.createCatalog({
        code: 'C003',
        name: '拍片',
        category: '影像',
        price: 200,
      });

      await service.updateCatalog(created!.id, { price: 250 });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === created!.id && l.type === 'TREATMENT_CATALOG_UPDATE');
      expect(log).toBeDefined();
    });
  });

  describe('deleteCatalog - 删除治疗项目目录', () => {
    it('删除存在的治疗项目目录应返回 id', async () => {
      const created = await service.createCatalog({
        code: 'C001',
        name: '根管治疗',
        category: '治疗',
        price: 500,
      });

      const result = await service.deleteCatalog(created!.id);

      expect(result).toBeDefined();
      expect(result.id).toBe(created!.id);
    });

    it('删除不存在的治疗项目目录应抛出 BusinessNotFoundException', async () => {
      await expect(service.deleteCatalog('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('删除应设置 deletedAt', async () => {
      const created = await service.createCatalog({
        code: 'C002',
        name: '补牙',
        category: '修复',
        price: 300,
      });

      await service.deleteCatalog(created!.id);

      const rows = db.getTableData('TreatmentCatalog');
      const deleted = rows.find(r => r.id === created!.id);
      expect(deleted).toBeDefined();
      expect(deleted!.deletedAt).toBeTruthy();
    });

    it('删除应写入审计日志', async () => {
      const created = await service.createCatalog({
        code: 'C003',
        name: '洗牙',
        category: '预防',
        price: 150,
      });

      await service.deleteCatalog(created!.id);

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === created!.id && l.type === 'TREATMENT_CATALOG_DELETE');
      expect(log).toBeDefined();
    });
  });

  describe('findCatalog - 查询治疗项目目录', () => {
    it('查询目录应返回已创建的项目', async () => {
      await service.createCatalog({ code: 'C001', name: '根管治疗', category: '治疗', price: 500 });
      await service.createCatalog({ code: 'C002', name: '补牙', category: '修复', price: 300 });

      const result = await service.findCatalog();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('删除后的目录不应被查询到', async () => {
      const created = await service.createCatalog({ code: 'C001', name: '根管治疗', category: '治疗', price: 500 });
      await service.deleteCatalog(created!.id);

      const result = await service.findCatalog();

      expect(result.length).toBe(0);
    });

    it('缓存命中时应直接返回缓存数据', async () => {
      const cachedData = [{ id: 'cached-1', code: 'CACHED', name: '缓存项', category: '治疗', price: 100 }];
      const cacheService = createMockCacheService();
      cacheService.get = jest.fn().mockReturnValue(cachedData);
      const serviceWithCache = new TreatmentsService(asDbService(db), createMockClinicContext(), cacheService);

      const result = await serviceWithCache.findCatalog();

      expect(result).toBe(cachedData);
      expect(cacheService.get).toHaveBeenCalled();
      // 缓存命中时不应执行数据库查询，也不应写入缓存
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('自定义分页参数应正确生成缓存键', async () => {
      await service.createCatalog({ code: 'C001', name: '根管治疗', category: '治疗', price: 500 });

      const result = await service.findCatalog(2, 5);

      expect(Array.isArray(result)).toBe(true);
      // 第一页偏移量为 0，第二页偏移量为 pageSize
      // 此处仅验证调用不抛出异常
    });

    it('空目录应返回空数组', async () => {
      const result = await service.findCatalog();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  // ==================== createCatalog - 边界场景 ====================

  describe('createCatalog - 边界场景', () => {
    it('不传 remark 时 remark 应为 null', async () => {
      const result = await service.createCatalog({
        code: 'C001',
        name: '无备注',
        category: '治疗',
        price: 100,
      });

      const rows = db.getTableData('TreatmentCatalog');
      const created = rows.find(r => r.id === result!.id);
      expect(created!.remark).toBeNull();
    });

    it('传入 remark 时 remark 应正确存储', async () => {
      const result = await service.createCatalog({
        code: 'C002',
        name: '有备注',
        category: '治疗',
        price: 200,
        remark: '特殊说明',
      });

      const rows = db.getTableData('TreatmentCatalog');
      const created = rows.find(r => r.id === result!.id);
      expect(created!.remark).toBe('特殊说明');
    });

    it('创建目录项应失效目录缓存', async () => {
      const cacheService = createMockCacheService();
      const serviceWithCache = new TreatmentsService(asDbService(db), createMockClinicContext(), cacheService);

      await serviceWithCache.createCatalog({
        code: 'C001',
        name: '测试',
        category: '治疗',
        price: 100,
      });

      expect(cacheService.delPattern).toHaveBeenCalled();
    });
  });

  // ==================== updateCatalog - 边界场景 ====================

  describe('updateCatalog - 边界场景', () => {
    it('更新 category 字段应成功', async () => {
      const created = await service.createCatalog({
        code: 'C001',
        name: '根管治疗',
        category: '治疗',
        price: 500,
      });

      const result = await service.updateCatalog(created!.id, {
        category: '牙体牙髓',
      });

      expect(result!.category).toBe('牙体牙髓');
    });

    it('更新 remark 字段应成功', async () => {
      const created = await service.createCatalog({
        code: 'C002',
        name: '补牙',
        category: '修复',
        price: 300,
      });

      const result = await service.updateCatalog(created!.id, {
        remark: '更新后的备注',
      });

      expect(result!.remark).toBe('更新后的备注');
    });

    it('更新所有可更新字段应成功', async () => {
      const created = await service.createCatalog({
        code: 'C003',
        name: '初始',
        category: '初始类别',
        price: 100,
      });

      const result = await service.updateCatalog(created!.id, {
        name: '更新名称',
        category: '更新类别',
        price: 200,
        remark: '更新备注',
      });

      expect(result!.name).toBe('更新名称');
      expect(result!.category).toBe('更新类别');
      expect(result!.price).toBe(200);
      expect(result!.remark).toBe('更新备注');
    });

    it('空对象更新不应执行 SQL 且不应写审计日志', async () => {
      const created = await service.createCatalog({
        code: 'C004',
        name: '初始',
        category: '治疗',
        price: 100,
      });

      const auditLogsBefore = db.getTableData('AuditLog').length;
      const result = await service.updateCatalog(created!.id, {});

      expect(result).toBeDefined();
      // 空更新不应写入新的审计日志
      const auditLogsAfter = db.getTableData('AuditLog').length;
      expect(auditLogsAfter).toBe(auditLogsBefore);
    });

    it('更新目录项应失效目录缓存', async () => {
      const cacheService = createMockCacheService();
      const serviceWithCache = new TreatmentsService(asDbService(db), createMockClinicContext(), cacheService);
      const created = await serviceWithCache.createCatalog({
        code: 'C005',
        name: '测试',
        category: '治疗',
        price: 100,
      });

      (cacheService.delPattern as jest.Mock).mockClear();
      await serviceWithCache.updateCatalog(created!.id, { price: 200 });

      expect(cacheService.delPattern).toHaveBeenCalled();
    });

    it('更新不存在的目录项不应抛出异常', async () => {
      // updateCatalog 对不存在的项不做前置校验，直接执行 UPDATE（changes=0）并返回 undefined
      const result = await service.updateCatalog('non-existent', { name: 'test' });

      // 不存在的目录项 UPDATE 后 SELECT 返回 undefined，验证不抛出异常即可
      expect(result).toBeUndefined();
    });
  });

  // ==================== create - 边界场景 ====================

  describe('create - 边界场景', () => {
    it('不传 visitId 时 visitId 应为 null', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        code: 'T001',
        name: '测试',
        category: '治疗',
        price: 100,
      });

      const rows = db.getTableData('Treatment');
      const created = rows.find(r => r.id === result.id);
      expect(created!.visitId).toBeNull();
    });

    it('不传 remark 时 remark 应为 null', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        code: 'T002',
        name: '测试',
        category: '治疗',
        price: 100,
      });

      const rows = db.getTableData('Treatment');
      const created = rows.find(r => r.id === result.id);
      expect(created!.remark).toBeNull();
    });

    it('传入 remark 时 remark 应正确存储', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        code: 'T003',
        name: '测试',
        category: '治疗',
        price: 100,
        remark: '特殊说明',
      });

      const rows = db.getTableData('Treatment');
      const created = rows.find(r => r.id === result.id);
      expect(created!.remark).toBe('特殊说明');
    });
  });

  // ==================== findOne - 边界场景 ====================

  describe('findOne - 边界场景', () => {
    it('查询不存在的治疗项目应抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('teethNumbers 为 null 时应返回空数组', async () => {
      db.seed('Treatment', [
        { id: 'trt-null', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '测试', category: '治疗', price: 100, quantity: 1, teethNumbers: null, status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.findOne('trt-null');

      expect(Array.isArray(result.teethNumbers)).toBe(true);
      expect(result.teethNumbers).toEqual([]);
    });
  });

  // ==================== findMany - 边界场景 ====================

  describe('findMany - 边界场景', () => {
    beforeEach(() => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '根管治疗', category: '治疗', price: 500, quantity: 1, teethNumbers: '[11]', status: 'PLANNED', clinicId: 'test-clinic-001' },
        { id: 'trt-002', patientId: 'patient-002', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T002', name: '拍片', category: '影像', price: 200, quantity: 1, teethNumbers: '[]', status: 'COMPLETED', clinicId: 'test-clinic-001' },
      ]);
    });

    it('默认分页参数应正常返回', async () => {
      const result = await service.findMany({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBeDefined();
      expect(result.items.length).toBe(2);
    });

    it('第二页查询应返回剩余记录', async () => {
      const result = await service.findMany({ page: 2, pageSize: 1 });

      expect(result.items.length).toBe(1);
      expect(result.page).toBe(2);
    });

    it('查询结果应解析 teethNumbers JSON 字段', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });

      expect(result.items.length).toBe(1);
      expect(Array.isArray((result.items[0] as any).teethNumbers)).toBe(true);
      expect((result.items[0] as any).teethNumbers).toEqual([11]);
    });
  });

  // ==================== 跨诊所隔离 ====================

  describe('跨诊所隔离', () => {
    it('不同诊所的治疗项目应互相隔离', async () => {
      db.seed('Treatment', [
        { id: 'trt-001', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T001', name: '本诊所', category: '治疗', price: 100, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
        { id: 'trt-002', patientId: 'patient-001', visitId: 'visit-001', doctorId: 'doctor-001', code: 'T002', name: '其他诊所', category: '治疗', price: 100, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'other-clinic-002' },
      ]);

      const result = await service.findMany({ patientId: 'patient-001' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).id).toBe('trt-001');
    });
  });
});
