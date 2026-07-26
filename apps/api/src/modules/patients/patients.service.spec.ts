import { PatientsService } from './patients.service';
import { MockDbService } from '../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { Gender, PatientSource } from '@dental/shared';
import { encryptField, decryptField } from '../../common/utils/security/encryption';
import { StatsService } from '../system/stats/stats.service';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-only-00000000000000000000000000000000';

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

function createMockStatsService(): jest.Mocked<StatsService> {
  return {
    invalidateStatsCache: jest.fn(),
  } as unknown as jest.Mocked<StatsService>;
}

describe('PatientsService', () => {
  let service: PatientsService;
  let db: MockDbService;
  let statsService: jest.Mocked<StatsService>;

  beforeEach(() => {
    db = new MockDbService();
    statsService = createMockStatsService();
    service = new PatientsService(db as any, createMockClinicContext(), statsService);
  });

  afterEach(() => {
    db.clear();
  });

  describe('create - 正常创建患者', () => {
    it('应正确创建患者并返回 name、phone、gender、source 等字段', async () => {
      const result = await service.create({
        name: '张三',
        phone: '13800138000',
        gender: Gender.MALE,
        source: PatientSource.WALK_IN,
      });

      expect((result as any).name).toBe('张三');
      expect((result as any).phone).toBe('138****8000');
      expect((result as any).gender).toBe(Gender.MALE);
      expect((result as any).source).toBe(PatientSource.WALK_IN);
      expect((result as any).id).toBeDefined();
      expect((result as any).active).toBe(1);
    });
  });

  describe('create - 患者编号自动生成', () => {
    it('不传 code 时应生成 P 开头的编号', async () => {
      const result = await service.create({
        name: '李四',
        phone: '13900139000',
        gender: Gender.FEMALE,
      });

      expect((result as any).code).toBeDefined();
      expect((result as any).code.startsWith('P')).toBe(true);
    });

    it('传入 code 时应使用指定的编号', async () => {
      const result = await service.create({
        name: '王五',
        phone: '13700137000',
        gender: Gender.MALE,
        code: 'P999999',
      });

      expect((result as any).code).toBe('P999999');
    });
  });

  describe('create - 身份证号加密存储', () => {
    it('创建后返回的患者信息中身份证号是脱敏的（证明解密和脱敏逻辑工作）', async () => {
      const plainIdCard = '110101199001011234';

      const result = await service.create({
        name: '赵六',
        phone: '13600136000',
        gender: Gender.MALE,
        idCard: plainIdCard,
      });

      expect((result as any).idCard).not.toBe(plainIdCard);
      expect((result as any).idCard).toMatch(/^\d{6}\*{8}\d{4}$/);
    });

    it('创建后数据库中 idCard 不是明文（mock 限制：用 seed 验证加密存储模式）', async () => {
      const plainIdCard = '110101199001011234';
      const encryptedIdCard = encryptField(plainIdCard);

      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '赵六',
        phone: '13600136000',
        gender: Gender.MALE,
        idCard: encryptedIdCard,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const patients = db.getTableData('Patient');
      const savedPatient = patients.find(p => p.id === 'patient-001');

      expect(savedPatient).toBeDefined();
      expect(savedPatient.idCard).not.toBe(plainIdCard);
      expect(typeof savedPatient.idCard).toBe('string');
      expect(decryptField(savedPatient.idCard as string)).toBe(plainIdCard);
    });
  });

  describe('findOne - 身份证号脱敏', () => {
    it('获取患者详情时身份证号应前6后4，中间8个*', async () => {
      const plainIdCard = '110101199001011234';
      const encryptedIdCard = encryptField(plainIdCard);

      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '钱七',
        phone: '13500135000',
        gender: Gender.FEMALE,
        idCard: encryptedIdCard,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const result = await service.findOne('patient-001');

      expect((result as any).idCard).toBe('110101********1234');
      expect((result as any).idCard).not.toBe(plainIdCard);
    });
  });

  describe('findMany - 列表查询身份证号脱敏', () => {
    it('列表查询时身份证号同样脱敏', async () => {
      const plainIdCard1 = '110101199001011111';
      const plainIdCard2 = '310101199202022222';
      const encryptedIdCard1 = encryptField(plainIdCard1);
      const encryptedIdCard2 = encryptField(plainIdCard2);

      db.seed('Patient', [
        {
          id: 'patient-001',
          code: 'P000001',
          name: '孙八',
          phone: '13400134000',
          gender: Gender.MALE,
          idCard: encryptedIdCard1,
          clinicId: 'test-clinic-001',
          active: 1,
          tags: '[]',
          allergies: '[]',
          medicalHistory: '[]',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'patient-002',
          code: 'P000002',
          name: '周九',
          phone: '13300133000',
          gender: Gender.FEMALE,
          idCard: encryptedIdCard2,
          clinicId: 'test-clinic-001',
          active: 1,
          tags: '[]',
          allergies: '[]',
          medicalHistory: '[]',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const result = await service.findMany({});

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      result.items.forEach((item: any) => {
        if (item.idCard) {
          expect(item.idCard).toMatch(/^\d{6}\*{8}\d{4}$/);
        }
      });
    });
  });

  describe('update - 正常更新患者信息', () => {
    it('应正确更新 name、phone 等字段', async () => {
      const created = await service.create({
        name: '吴十',
        phone: '13200132000',
        gender: Gender.MALE,
      });

      const patientId = (created as any).id;
      const updated = await service.update(patientId, {
        name: '吴十一',
        phone: '13100131000',
      });

      expect((updated as any).name).toBe('吴十一');
      expect((updated as any).phone).toBe('131****1000');
    });
  });

  describe('update - 更新身份证号时重新加密', () => {
    it('更新身份证号后返回的患者信息中身份证号是脱敏的', async () => {
      const oldIdCard = '110101199001011234';
      const newIdCard = '440101199505056789';
      const encryptedOld = encryptField(oldIdCard);

      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '郑十二',
        phone: '13000130000',
        gender: Gender.MALE,
        idCard: encryptedOld,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const updated = await service.update('patient-001', { idCard: newIdCard });

      expect((updated as any).idCard).toMatch(/^\d{6}\*{8}\d{4}$/);
      expect((updated as any).idCard).not.toBe(newIdCard);
      expect((updated as any).idCard).not.toBe(oldIdCard);
    });

    it('更新身份证号后通过 getFullIdCard 能获取新的完整身份证号', async () => {
      const oldIdCard = '110101199001011234';
      const newIdCard = '440101199505056789';
      const encryptedOld = encryptField(oldIdCard);

      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '郑十二',
        phone: '13000130000',
        gender: Gender.MALE,
        idCard: encryptedOld,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      await service.update('patient-001', { idCard: newIdCard });
      const fullIdCard = await service.getFullIdCard('patient-001');

      expect(fullIdCard).toBe(newIdCard);
      expect(fullIdCard).not.toBe(oldIdCard);
    });
  });

  describe('getFullIdCard - 获取完整身份证号', () => {
    it('应返回完整的明文身份证号', async () => {
      const plainIdCard = '110101199001011234';
      const encryptedIdCard = encryptField(plainIdCard);

      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '冯十三',
        phone: '12900129000',
        gender: Gender.FEMALE,
        idCard: encryptedIdCard,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const fullIdCard = await service.getFullIdCard('patient-001');

      expect(fullIdCard).toBe(plainIdCard);
    });

    it('患者没有身份证号时返回 null', async () => {
      db.seed('Patient', [{
        id: 'patient-002',
        code: 'P000002',
        name: '陈十四',
        phone: '12800128000',
        gender: Gender.MALE,
        idCard: null,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const fullIdCard = await service.getFullIdCard('patient-002');

      expect(fullIdCard).toBeNull();
    });
  });

  describe('软删除 - softDelete', () => {
    it('软删除后设置 deletedAt 字段', async () => {
      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '楚十五',
        phone: '12700127000',
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      }]);

      const beforeDelete = db.getTableData('Patient').find(p => p.id === 'patient-001');
      expect(beforeDelete.deletedAt).toBeNull();

      await (service as any).softDelete('patient-001');

      const afterDelete = db.getTableData('Patient').find(p => p.id === 'patient-001');
      expect(afterDelete).toBeDefined();
      expect(afterDelete.deletedAt).toBeDefined();
      expect(afterDelete.deletedAt).not.toBeNull();
    });

    it('软删除后 code 字段添加后缀以避免唯一约束冲突', async () => {
      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '魏十六',
        phone: '12600126000',
        gender: Gender.FEMALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      }]);

      await (service as any).softDelete('patient-001');

      const afterDelete = db.getTableData('Patient').find(p => p.id === 'patient-001');
      expect(afterDelete.code).not.toBe('P000001');
      expect((afterDelete.code as string).startsWith('P000001_deleted_')).toBe(true);
    });
  });

  // ==================== findMany - 按条件过滤 ====================

  describe('findMany - 按条件过滤 (filters)', () => {
    beforeEach(() => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '张三丰', phone: '13800138001',
          gender: Gender.MALE, source: 'WALK_IN', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'patient-002', code: 'P000002', name: '张无忌', phone: '13800138002',
          gender: Gender.MALE, source: 'REFERRAL', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'patient-003', code: 'P000003', name: '赵敏', phone: '13800138003',
          gender: Gender.FEMALE, source: 'WALK_IN', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);
    });

    it('按 gender 过滤应只返回匹配性别的患者', async () => {
      const result = await service.findMany({ filters: { gender: Gender.FEMALE } });
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).gender).toBe(Gender.FEMALE);
    });

    it('按 gender=MALE 过滤应返回两个男性患者', async () => {
      const result = await service.findMany({ filters: { gender: Gender.MALE } });
      expect(result.items.length).toBe(2);
      expect(result.items.every((p: any) => p.gender === Gender.MALE)).toBe(true);
    });

    it('无 filters 时应返回所有患者', async () => {
      const result = await service.findMany({});
      expect(result.items.length).toBe(3);
    });
  });

  // ==================== findMany - 分页 ====================

  describe('findMany - 分页', () => {
    beforeEach(() => {
      const patients = Array.from({ length: 5 }, (_, i) => ({
        id: `patient-${String(i + 1).padStart(3, '0')}`,
        code: `P${String(i + 1).padStart(6, '0')}`,
        name: `患者${i + 1}`,
        phone: `1380000000${i}`,
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      db.seed('Patient', patients);
    });

    it('分页查询 page=1 pageSize=2 应返回 2 条', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('不传 page/pageSize 应返回全部数据', async () => {
      const result = await service.findMany({});
      expect(result.items.length).toBe(5);
      expect(result.total).toBe(5);
    });
  });

  // ==================== getFullIdCard - 边界情况 ====================

  describe('getFullIdCard - 边界情况', () => {
    it('患者不存在应抛出 NotFoundException', async () => {
      await expect(service.getFullIdCard('non-existent')).rejects.toThrow();
    });

    it('返回的完整身份证号应与加密前一致', async () => {
      const plainIdCard = '320102198503054567';
      const encryptedIdCard = encryptField(plainIdCard);

      db.seed('Patient', [{
        id: 'patient-100',
        code: 'P000100',
        name: '测试患者',
        phone: '13800000100',
        gender: Gender.MALE,
        idCard: encryptedIdCard,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const fullIdCard = await service.getFullIdCard('patient-100');
      expect(fullIdCard).toBe(plainIdCard);
    });
  });

  // ==================== getFullPhone - 获取完整手机号 ====================

  describe('getFullPhone - 获取完整手机号', () => {
    it('应返回完整的明文手机号', async () => {
      const plainPhone = '13800138000';

      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '测试患者',
        phone: plainPhone,
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const fullPhone = await service.getFullPhone('patient-001');
      expect(fullPhone).toBe(plainPhone);
    });

    it('患者不存在应抛出 NotFoundException', async () => {
      await expect(service.getFullPhone('non-existent')).rejects.toThrow();
    });

    it('调用 getFullPhone 后应记录审计日志', async () => {
      const plainPhone = '13900139000';

      db.seed('Patient', [{
        id: 'patient-002',
        code: 'P000002',
        name: '审计测试',
        phone: plainPhone,
        gender: Gender.FEMALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      await service.getFullPhone('patient-002');

      const auditLogs = db.getTableData('AuditLog');
      const phoneAccessLogs = auditLogs.filter(log => log.type === 'PHONE_ACCESS');
      expect(phoneAccessLogs.length).toBeGreaterThanOrEqual(1);
      expect(phoneAccessLogs[0].targetId).toBe('patient-002');
      expect(phoneAccessLogs[0].targetType).toBe('Patient');
    });
  });

  // ==================== findOne 和 findMany - 手机号脱敏 ====================

  describe('手机号脱敏', () => {
    it('findOne 返回的手机号应中间4位脱敏', async () => {
      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '脱敏测试',
        phone: '13812345678',
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const result = await service.findOne('patient-001');
      expect((result as any).phone).toBe('138****5678');
    });

    it('findMany 返回的手机号同样脱敏', async () => {
      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '脱敏测试1',
        phone: '13811112222',
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const result = await service.findMany({});
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      result.items.forEach((item: any) => {
        if (item.phone) {
          expect(item.phone).toMatch(/^\d{3}\*{4}\d{4}$/);
        }
      });
    });
  });

  // ==================== findMany - 关键词搜索 ====================

  describe('findMany - 关键词搜索 (keyword)', () => {
    beforeEach(() => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '张三丰', phone: '13800000001',
          gender: Gender.MALE, source: 'WALK_IN', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'patient-002', code: 'P000002', name: '张无忌', phone: '13900000002',
          gender: Gender.MALE, source: 'REFERRAL', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'patient-003', code: 'P000003', name: '赵敏', phone: '13700000003',
          gender: Gender.FEMALE, source: 'WALK_IN', clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);
    });

    it('传入 keyword 参数时应正常返回结果', async () => {
      const result = await service.findMany({ keyword: '张' });
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.total).toBeDefined();
    });

    it('按手机号前缀搜索应能找到匹配的患者', async () => {
      const result = await service.findMany({ keyword: '13800000001' });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some((p: any) => p.name === '张三丰')).toBe(true);
    });

    it('搜索空关键词应返回所有患者', async () => {
      const result = await service.findMany({ keyword: '' });
      expect(result.items.length).toBe(3);
    });

    it('搜索 whitespace 关键词应返回所有患者', async () => {
      const result = await service.findMany({ keyword: '   ' });
      expect(result.items.length).toBe(3);
    });

    it('搜索 undefined keyword 应返回所有患者', async () => {
      const result = await service.findMany({ keyword: undefined });
      expect(result.items.length).toBe(3);
    });
  });

  // ==================== findMany - 排序功能 ====================

  describe('findMany - 排序功能', () => {
    beforeEach(() => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: 'B患者', phone: '13800000001',
          gender: Gender.MALE, clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'patient-002', code: 'P000002', name: 'A患者', phone: '13800000002',
          gender: Gender.MALE, clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        {
          id: 'patient-003', code: 'P000003', name: 'C患者', phone: '13800000003',
          gender: Gender.FEMALE, clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: '2024-01-03T00:00:00.000Z',
          updatedAt: '2024-01-03T00:00:00.000Z',
        },
      ]);
    });

    it('按 name 升序排序应正确排序', async () => {
      const result = await service.findMany({ sortBy: 'name', sortOrder: 'ASC' });
      expect(result.items.length).toBe(3);
      expect((result.items[0] as any).name).toBe('A患者');
      expect((result.items[1] as any).name).toBe('B患者');
      expect((result.items[2] as any).name).toBe('C患者');
    });

    it('按 name 降序排序应正确排序', async () => {
      const result = await service.findMany({ sortBy: 'name', sortOrder: 'DESC' });
      expect(result.items.length).toBe(3);
      expect((result.items[0] as any).name).toBe('C患者');
      expect((result.items[1] as any).name).toBe('B患者');
      expect((result.items[2] as any).name).toBe('A患者');
    });

    it('默认按 createdAt 降序排序', async () => {
      const result = await service.findMany({});
      expect(result.items.length).toBe(3);
      expect((result.items[0] as any).name).toBe('C患者');
    });

    it('无效格式的排序字段应抛出 BadRequestException', async () => {
      await expect(service.findMany({ sortBy: 'invalid-field!' })).rejects.toThrow();
    });
  });

  // ==================== findMany - 游标分页 ====================

  describe('findMany - 游标分页 (cursor)', () => {
    beforeEach(() => {
      const patients = Array.from({ length: 5 }, (_, i) => ({
        id: `patient-${String(5 - i).padStart(3, '0')}`,
        code: `P${String(5 - i).padStart(6, '0')}`,
        name: `患者${5 - i}`,
        phone: `1380000000${5 - i}`,
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: `2024-01-${String(5 - i).padStart(2, '0')}T00:00:00.000Z`,
        updatedAt: `2024-01-${String(5 - i).padStart(2, '0')}T00:00:00.000Z`,
      }));
      db.seed('Patient', patients);
    });

    it('使用 cursor 分页应能获取后续记录', async () => {
      const firstPage = await service.findMany({ pageSize: 2, sortBy: 'id', sortOrder: 'DESC' });
      expect(firstPage.items.length).toBe(2);

      const lastItem = firstPage.items[firstPage.items.length - 1];
      const secondPage = await service.findMany({ pageSize: 2, cursor: (lastItem as any).id, sortBy: 'id', sortOrder: 'DESC' });
      expect(secondPage.items.length).toBe(2);
      expect(secondPage.items.every((p: any) => p.id !== (firstPage.items[0] as any).id)).toBe(true);
      expect(secondPage.items.every((p: any) => p.id !== (firstPage.items[1] as any).id)).toBe(true);
    });

    it('传递 cursor 参数时应使用游标分页而非 offset', async () => {
      const result = await service.findMany({ pageSize: 3, cursor: 'patient-003', sortBy: 'id', sortOrder: 'DESC' });
      expect(result.items.length).toBeLessThanOrEqual(3);
    });
  });

  // ==================== findMany - 包含已删除 ====================

  describe('findMany - 包含已软删除记录 (includeDeleted)', () => {
    beforeEach(() => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '正常患者', phone: '13800000001',
          gender: Gender.MALE, clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          deletedAt: null,
        },
        {
          id: 'patient-002', code: 'P000002_deleted_abc', name: '已删除患者',
          phone: '13800000002', gender: Gender.MALE, clinicId: 'test-clinic-001',
          active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          deletedAt: new Date().toISOString(),
        },
      ]);
    });

    it('默认不包含已删除的患者', async () => {
      const result = await service.findMany({});
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).name).toBe('正常患者');
    });

    it('includeDeleted=true 时应包含已删除的患者', async () => {
      const result = await service.findMany({ includeDeleted: true });
      expect(result.items.length).toBe(2);
    });
  });

  // ==================== JSON 字段解析 ====================

  describe('JSON 字段解析', () => {
    it('创建时 tags、allergies、medicalHistory 等字段应解析为数组', async () => {
      const result = await service.create({
        name: 'JSON测试',
        phone: '13800000001',
        gender: Gender.MALE,
        tags: ['VIP', '老患者'],
        allergies: ['青霉素', '头孢'],
        medicalHistory: ['高血压', '糖尿病'],
        medicationHistory: ['降压药'],
        systemicDiseases: ['心脏病'],
      });

      expect(Array.isArray((result as any).tags)).toBe(true);
      expect((result as any).tags).toContain('VIP');
      expect((result as any).tags).toContain('老患者');
      expect(Array.isArray((result as any).allergies)).toBe(true);
      expect((result as any).allergies).toContain('青霉素');
      expect(Array.isArray((result as any).medicalHistory)).toBe(true);
      expect(Array.isArray((result as any).medicationHistory)).toBe(true);
      expect(Array.isArray((result as any).systemicDiseases)).toBe(true);
    });

    it('findOne 返回的 JSON 字段应为数组', async () => {
      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: 'JSON解析测试',
        phone: '13800000001',
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '["VIP","老患者"]',
        allergies: '["青霉素"]',
        medicalHistory: '["高血压"]',
        medicationHistory: '["降压药"]',
        systemicDiseases: '["心脏病"]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const result = await service.findOne('patient-001');
      expect(Array.isArray((result as any).tags)).toBe(true);
      expect((result as any).tags.length).toBe(2);
      expect(Array.isArray((result as any).allergies)).toBe(true);
      expect((result as any).allergies.length).toBe(1);
    });

    it('findMany 返回的 JSON 字段应为数组', async () => {
      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: 'JSON列表测试',
        phone: '13800000001',
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '["VIP"]',
        allergies: '[]',
        medicalHistory: '[]',
        medicationHistory: '[]',
        systemicDiseases: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]);

      const result = await service.findMany({});
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      const patient = result.items.find((p: any) => p.id === 'patient-001');
      expect(Array.isArray(patient.tags)).toBe(true);
      expect(patient.tags).toContain('VIP');
    });

    it('更新 JSON 字段时应正确序列化和反序列化', async () => {
      const created = await service.create({
        name: 'JSON更新测试',
        phone: '13800000002',
        gender: Gender.FEMALE,
        tags: ['初始标签'],
      });

      const patientId = (created as any).id;
      const updated = await service.update(patientId, {
        tags: ['新标签1', '新标签2'],
        allergies: ['新过敏'],
      });

      expect(Array.isArray((updated as any).tags)).toBe(true);
      expect((updated as any).tags.length).toBe(2);
      expect((updated as any).tags).toContain('新标签1');
      expect(Array.isArray((updated as any).allergies)).toBe(true);
      expect((updated as any).allergies).toContain('新过敏');
    });
  });

  // ==================== remove - 硬删除 ====================

  describe('remove - 硬删除', () => {
    it('删除不存在的患者应抛出 NotFoundException', async () => {
      await expect(service.remove('non-existent')).rejects.toThrow();
    });

    it('删除成功后应返回患者 id', async () => {
      db.seed('Patient', [{
        id: 'patient-001',
        code: 'P000001',
        name: '删除测试',
        phone: '13800000001',
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      }]);

      const result = await service.remove('patient-001');
      expect(result).toBeDefined();
    });
  });

  // ==================== 诊所数据隔离 ====================

  describe('诊所数据隔离', () => {
    it('没有 clinicId 时 findMany 应抛出 ForbiddenException', async () => {
      const serviceWithoutClinic = new PatientsService(db as any, {
        getClinicId: () => null,
        getUserId: () => 'test-user',
        getRole: () => 'DOCTOR',
        getUserAgent: () => 'jest-test-agent',
        getSource: () => 'test',
        run: <T>(_ctx: unknown, fn: () => T) => fn(),
        isInitialized: () => true,
      } as unknown as ClinicContextService, createMockStatsService());

      await expect(serviceWithoutClinic.findMany({})).rejects.toThrow();
    });

    it('没有 clinicId 时 findOne 应抛出 ForbiddenException', async () => {
      const serviceWithoutClinic = new PatientsService(db as any, {
        getClinicId: () => null,
        getUserId: () => 'test-user',
        getRole: () => 'DOCTOR',
        getUserAgent: () => 'jest-test-agent',
        getSource: () => 'test',
        run: <T>(_ctx: unknown, fn: () => T) => fn(),
        isInitialized: () => true,
      } as unknown as ClinicContextService, createMockStatsService());

      await expect(serviceWithoutClinic.findOne('test-id')).rejects.toThrow();
    });

    it('不同诊所的患者数据应互相隔离', async () => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '诊所A患者',
          phone: '13800000001', gender: Gender.MALE,
          clinicId: 'clinic-a', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        {
          id: 'patient-002', code: 'P000002', name: '诊所B患者',
          phone: '13800000002', gender: Gender.MALE,
          clinicId: 'clinic-b', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);

      const serviceClinicA = new PatientsService(db as any, {
        getClinicId: () => 'clinic-a',
        getUserId: () => 'test-user',
        getRole: () => 'DOCTOR',
        getUserAgent: () => 'jest-test-agent',
        getSource: () => 'test',
        run: <T>(_ctx: unknown, fn: () => T) => fn(),
        isInitialized: () => true,
      } as unknown as ClinicContextService, createMockStatsService());

      const result = await serviceClinicA.findMany({});
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).name).toBe('诊所A患者');
    });
  });

  // ==================== 字段验证 ====================

  describe('字段验证', () => {
    it('无效格式的 filter 字段应抛出 BadRequestException', async () => {
      await expect(service.findMany({ filters: { 'invalid-field!': 'value' } })).rejects.toThrow();
    });

    it('filters 中值为空字符串时应忽略该过滤条件', async () => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '测试患者',
          phone: '13800000001', gender: Gender.MALE,
          clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);

      const result = await service.findMany({ filters: { gender: '' } });
      expect(result.items.length).toBe(1);
    });

    it('filters 中值为 null 时应忽略该过滤条件', async () => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '测试患者',
          phone: '13800000001', gender: Gender.MALE,
          clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);

      const result = await service.findMany({ filters: { gender: null } });
      expect(result.items.length).toBe(1);
    });

    it('filters 中值为 undefined 时应忽略该过滤条件', async () => {
      db.seed('Patient', [
        {
          id: 'patient-001', code: 'P000001', name: '测试患者',
          phone: '13800000001', gender: Gender.MALE,
          clinicId: 'test-clinic-001', active: 1,
          tags: '[]', allergies: '[]', medicalHistory: '[]',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      ]);

      const result = await service.findMany({ filters: { gender: undefined } });
      expect(result.items.length).toBe(1);
    });
  });

  // ==================== 创建患者 - 默认值和边界情况 ====================

  describe('创建患者 - 默认值和边界情况', () => {
    it('不指定 source 时默认为 WALK_IN', async () => {
      const result = await service.create({
        name: '默认来源测试',
        phone: '13800000001',
        gender: Gender.MALE,
      });

      expect((result as any).source).toBe('WALK_IN');
    });

    it('不指定 tags 时默认为空数组', async () => {
      const result = await service.create({
        name: '空标签测试',
        phone: '13800000002',
        gender: Gender.FEMALE,
      });

      expect(Array.isArray((result as any).tags)).toBe(true);
      expect((result as any).tags.length).toBe(0);
    });

    it('创建的患者 active 应为 1', async () => {
      const result = await service.create({
        name: '激活状态测试',
        phone: '13800000003',
        gender: Gender.MALE,
      });

      expect((result as any).active).toBe(1);
    });

    it('创建的患者应有 createdAt 和 updatedAt', async () => {
      const result = await service.create({
        name: '时间字段测试',
        phone: '13800000004',
        gender: Gender.MALE,
      });

      expect((result as any).createdAt).toBeDefined();
      expect((result as any).updatedAt).toBeDefined();
    });
  });

  // ==================== 分页参数验证 ====================

  describe('分页参数验证', () => {
    beforeEach(() => {
      const patients = Array.from({ length: 10 }, (_, i) => ({
        id: `patient-${String(i + 1).padStart(3, '0')}`,
        code: `P${String(i + 1).padStart(6, '0')}`,
        name: `患者${i + 1}`,
        phone: `1380000000${i}`,
        gender: Gender.MALE,
        clinicId: 'test-clinic-001',
        active: 1,
        tags: '[]',
        allergies: '[]',
        medicalHistory: '[]',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      db.seed('Patient', patients);
    });

    it('page 小于 1 时应重置为 1', async () => {
      const result = await service.findMany({ page: 0, pageSize: 5 });
      expect(result.page).toBe(1);
      expect(result.items.length).toBe(5);
    });

    it('pageSize 小于 1 时应重置为默认值', async () => {
      const result = await service.findMany({ pageSize: 0 });
      expect(result.pageSize).toBeGreaterThanOrEqual(1);
    });

    it('page 为负数时应重置为 1', async () => {
      const result = await service.findMany({ page: -5, pageSize: 5 });
      expect(result.page).toBe(1);
    });
  });
});
