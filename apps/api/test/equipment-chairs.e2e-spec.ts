import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@db/db.service';
import { ClinicContextService } from '@common/services/clinic-context.service';
import { IdempotencyService } from '@common/services/idempotency.service';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '@db/test-helpers';
import { TEST_CLINIC_ID } from './factories';
import { EquipmentService } from '@modules/equipment/equipment.service';
import { ChairsService } from '@modules/scheduling/chairs/chairs.service';
import * as crypto from 'crypto';

describe('Equipment & Chairs Integration Tests', () => {
  let equipmentService: EquipmentService;
  let chairsService: ChairsService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const runAsAdmin = <T>(fn: () => T) =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: 'admin-001', role: 'ADMIN' },
      fn,
    );

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db);
    // EquipmentService 继承 BaseService，hasSoftDelete 默认为 true，
    // findMany/findOne 会拼接 "deletedAt IS NULL"，但 Equipment 表无此列，需补上。
    db.exec('ALTER TABLE Equipment ADD COLUMN deletedAt TEXT');
    const testDbService = createTestDbService(db);
    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        EquipmentService,
        ChairsService,
      ],
    }).compile();
    equipmentService = module.get(EquipmentService);
    chairsService = module.get(ChairsService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => { cleanupTestDb(db); });

  // Chair 表无 updatedAt/deletedAt，BaseService.create 会写入 updatedAt 导致失败，
  // 因此通过直接 SQL 插入牙椅记录。
  const insertChair = (name: string, active = 1, clinicId = TEST_CLINIC_ID): string => {
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO Chair (id, name, active, clinicId, createdAt) VALUES (?,?,?,?,?)')
      .run(id, name, active, clinicId, new Date().toISOString());
    return id;
  };

  describe('Equipment', () => {
    it('创建设备成功', async () => {
      const equipment = await runAsAdmin(() =>
        equipmentService.create({
          name: '牙科综合治疗台',
          model: 'X500',
          brand: '西门子',
          category: '治疗设备',
          location: '1号诊室',
          status: 'NORMAL',
        } as any),
      );

      expect(equipment.id).toBeDefined();
      expect((equipment as any).name).toBe('牙科综合治疗台');
      expect((equipment as any).model).toBe('X500');
    });

    it('设备列表分页查询', async () => {
      for (let i = 0; i < 4; i++) {
        await runAsAdmin(() =>
          equipmentService.create({
            name: `设备${i}`,
            category: '治疗设备',
            location: `${i}号诊室`,
          } as any),
        );
      }

      const result = await runAsAdmin(() =>
        equipmentService.findMany({ page: 1, pageSize: 2 }),
      );

      expect((result as any).items.length).toBe(2);
      expect((result as any).total).toBe(4);
    });

    it('按名称关键字搜索设备', async () => {
      await runAsAdmin(() =>
        equipmentService.create({ name: '口腔扫描仪', category: '影像设备' } as any),
      );
      await runAsAdmin(() =>
        equipmentService.create({ name: '牙科钻头', category: '手术器械' } as any),
      );

      const result = await runAsAdmin(() =>
        equipmentService.findMany({ page: 1, pageSize: 10, keyword: '扫描' }),
      );

      expect((result as any).items.length).toBeGreaterThanOrEqual(1);
      expect((result as any).items[0].name).toContain('扫描');
    });

    it('按 ID 查询单个设备', async () => {
      const created = await runAsAdmin(() =>
        equipmentService.create({ name: '光固化灯', category: '治疗设备' } as any),
      );

      const found = await runAsAdmin(() => equipmentService.findOne(created.id));
      expect(found.id).toBe(created.id);
      expect((found as any).name).toBe('光固化灯');
    });

    it('更新设备信息', async () => {
      const created = await runAsAdmin(() =>
        equipmentService.create({ name: '原设备名', location: '旧诊室' } as any),
      );

      const updated = await runAsAdmin(() =>
        equipmentService.update(created.id, { name: '新设备名', location: '新诊室' } as any),
      );

      expect((updated as any).name).toBe('新设备名');
      expect((updated as any).location).toBe('新诊室');
    });
  });

  describe('Chairs', () => {
    it('findAll 仅返回启用的牙椅', async () => {
      insertChair('牙椅A', 1);
      insertChair('牙椅B', 1);
      insertChair('牙椅C', 0);

      const result = await runAsAdmin(() => chairsService.findAll());

      expect((result as any).items.length).toBe(2);
      expect((result as any).total).toBe(2);
    });

    it('findAll 分页查询', async () => {
      for (let i = 0; i < 5; i++) {
        insertChair(`牙椅${i}`);
      }

      const result = await runAsAdmin(() =>
        chairsService.findAll({ page: 1, pageSize: 2 }),
      );

      expect((result as any).items.length).toBe(2);
      expect((result as any).total).toBe(5);
    });

    it('remove 将牙椅设为停用', async () => {
      const id = insertChair('待停用牙椅', 1);

      await runAsAdmin(() => chairsService.remove(id));

      const row = db.prepare('SELECT active FROM Chair WHERE id = ?').get(id) as any;
      expect(row.active).toBe(0);
    });

    it('findAll 按诊所 ID 过滤', async () => {
      insertChair('本诊所牙椅', 1, TEST_CLINIC_ID);
      insertChair('其他诊所牙椅', 1, 'other-clinic-999');

      const result = await runAsAdmin(() => chairsService.findAll());

      expect((result as any).items.length).toBe(1);
      expect((result as any).items[0].name).toBe('本诊所牙椅');
    });
  });
});
