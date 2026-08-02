 
import { Gender, PatientSource } from '@dental/shared';
import { BulkImportService } from './bulk-import.service';
import { SettingsService } from '../settings/settings.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';
import {
  createTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../../db/test-helpers';
import Database from 'better-sqlite3';
import { DbService } from '../../../db/db.service';
import { PatientImportRow } from './validators/patient.validator';
import { DrugImportRow } from './validators/drug.validator';
import { InventoryImportRow } from './validators/inventory.validator';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-only-00000000000000000000000000000000';

const TEST_CLINIC_ID = 'test-clinic-001';
const TEST_USER_ID = 'test-user-001';

function createClinicContext(): ClinicContextService {
  return {
    getClinicId: () => TEST_CLINIC_ID,
    getUserId: () => TEST_USER_ID,
    getRole: () => 'BOSS',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createSettingsService(dbService: DbService, clinicContext: ClinicContextService): SettingsService {
  const cache = new CacheService();
  const auditLog = new AuditLogService();
  return new SettingsService(dbService, cache, clinicContext, auditLog);
}

describe('BulkImportService', () => {
  let db: Database.Database;
  let dbService: DbService;
  let clinicContext: ClinicContextService;
  let settingsService: SettingsService;
  let auditLogService: AuditLogService;
  let service: BulkImportService;

  beforeEach(() => {
    db = createTestDb();
    dbService = createTestDbService(db);
    clinicContext = createClinicContext();
    auditLogService = new AuditLogService();
    settingsService = createSettingsService(dbService, clinicContext);
    service = new BulkImportService(dbService, clinicContext, settingsService, auditLogService);

    runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () => {
      seedTestData(db);
    });
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  const countPatients = (): number => {
    const r = db.prepare('SELECT COUNT(*) as cnt FROM Patient WHERE clinicId = ? AND deletedAt IS NULL').get(TEST_CLINIC_ID) as { cnt: number };
    return r.cnt;
  };

  const countDrugs = (): number => {
    const r = db.prepare('SELECT COUNT(*) as cnt FROM DrugCatalog WHERE clinicId = ?').get(TEST_CLINIC_ID) as { cnt: number };
    return r.cnt;
  };

  const countInventory = (): number => {
    const r = db.prepare('SELECT COUNT(*) as cnt FROM InventoryItem WHERE clinicId = ? AND deletedAt IS NULL').get(TEST_CLINIC_ID) as { cnt: number };
    return r.cnt;
  };

  // ============= TR-15.10: 空 rows =============
  describe('TR-15.10: 空 rows / 无 rows 场景', () => {
    it('importPatients 空数组返回 success=0 不崩溃', async () => {
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients([]),
      );
      expect(r.summary.total).toBe(0);
      expect(r.summary.success).toBe(0);
      expect(r.summary.failed).toBe(0);
      expect(r.rowErrors).toEqual([]);
      expect(r.createdIds).toEqual([]);
    });

    it('importDrugCatalog 空数组返回 success=0', async () => {
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog([]),
      );
      expect(r.summary.total).toBe(0);
      expect(r.summary.success).toBe(0);
    });

    it('importInventory 空数组返回 success=0', async () => {
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory([]),
      );
      expect(r.summary.total).toBe(0);
      expect(r.summary.success).toBe(0);
    });
  });

  // ============= TR-15.1: 患者 100 行 98 成功 2 失败 =============
  describe('TR-15.1: 患者批量导入 100 行，98 成功 2 手机号错', () => {
    it('应返回 summary.success=98/failed=2，错误带正确 rowIndex', async () => {
      const rows: PatientImportRow[] = [];
      for (let i = 0; i < 100; i++) {
        const phone = i === 7 ? 'BAD-PHONE' : (i === 53 ? '' : `138${String(i).padStart(8, '0')}`);
        rows.push({
          name: `患者${i}`,
          gender: i % 2 === 0 ? Gender.MALE : Gender.FEMALE,
          phone,
          source: PatientSource.WALK_IN,
          tags: [],
          allergies: [],
          systemicDiseases: [],
        });
      }

      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows),
      );

      expect(r.summary.total).toBe(100);
      expect(r.summary.success).toBe(98);
      expect(r.summary.failed).toBe(2);
      expect(r.createdIds.length).toBe(98);

      const errorIndexes = r.rowErrors.map((e) => e.rowIndex).sort((a, b) => a - b);
      expect(errorIndexes).toEqual([7, 53]);

      const beforeCount = countPatients();
      expect(beforeCount).toBeGreaterThanOrEqual(98);
    });
  });

  // ============= TR-15.2: 患者 dryRun =============
  describe('TR-15.2: 患者 dryRun=true 不写 DB', () => {
    it('dryRun 不写 DB，rowErrors/summary 与正式 run 一致', async () => {
      const rows: PatientImportRow[] = [
        { name: '张三', gender: Gender.MALE, phone: '13800000001' },
        { name: '李四', gender: Gender.FEMALE, phone: '13800000002' },
        { name: '', gender: Gender.MALE, phone: 'BAD-PHONE' },
      ];

      const before = countPatients();

      const dryRunResult = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows, { dryRun: true }),
      );

      expect(countPatients()).toBe(before);
      expect(dryRunResult.createdIds).toEqual([]);
      expect(dryRunResult.summary.total).toBe(3);
      expect(dryRunResult.summary.success).toBe(2);
      expect(dryRunResult.summary.failed).toBe(1);
      expect(dryRunResult.rowErrors.length).toBe(1);
      expect(dryRunResult.rowErrors[0].rowIndex).toBe(2);

      const realResult = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows),
      );

      expect(realResult.summary.success).toBe(dryRunResult.summary.success);
      expect(realResult.summary.failed).toBe(dryRunResult.summary.failed);
      expect(realResult.rowErrors.map((e) => e.rowIndex)).toEqual(dryRunResult.rowErrors.map((e) => e.rowIndex));
      expect(countPatients()).toBe(before + 2);
    });
  });

  // ============= TR-15.3: 手机重复 (batch + DB) =============
  describe('TR-15.3: 同 phone 批量重复 + DB 已存在重复', () => {
    it('首次成功，第二次 DUPLICATE_PHONE_IN_BATCH，第三次 DB 已有 DUPLICATE_PHONE_IN_DB', async () => {
      const rows1: PatientImportRow[] = [
        { name: 'A', gender: Gender.MALE, phone: '13899999999' },
      ];
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows1),
      );
      expect(countPatients()).toBeGreaterThanOrEqual(2);

      const rows2: PatientImportRow[] = [
        { name: 'B', gender: Gender.MALE, phone: '13899999999' },
        { name: 'C', gender: Gender.MALE, phone: '13899999999' },
        { name: 'D', gender: Gender.MALE, phone: '13899999998' },
      ];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows2),
      );

      expect(r.summary.success).toBe(1);
      expect(r.summary.failed).toBe(2);

      const errorRow0 = r.rowErrors.find((e) => e.rowIndex === 0)!;
      const errorRow1 = r.rowErrors.find((e) => e.rowIndex === 1)!;
      expect(errorRow0).toBeDefined();
      expect(errorRow1).toBeDefined();

      const phoneCodes0 = errorRow0.errors.filter((e) => e.field === 'phone').map((e) => e.code);
      const phoneCodes1 = errorRow1.errors.filter((e) => e.field === 'phone').map((e) => e.code);
      expect(phoneCodes0).toContain('DUPLICATE_PHONE_IN_DB');
      expect(phoneCodes1).toContain('DUPLICATE_PHONE_IN_BATCH');
    });
  });

  // ============= 患者字段校验 =============
  describe('患者字段校验', () => {
    it('name 长度 51 报错', async () => {
      const rows: PatientImportRow[] = [{ name: 'A'.repeat(51), gender: Gender.MALE, phone: '13811111111' }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows),
      );
      expect(r.summary.failed).toBe(1);
      const codes = r.rowErrors[0].errors.map((e) => e.code);
      expect(codes).toContain('INVALID_LENGTH');
    });

    it('birthDate 非法格式报错', async () => {
      const rows: PatientImportRow[] = [{ name: '张三', gender: Gender.MALE, phone: '13811111111', birthDate: '2024/01/01' }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'birthDate' && e.code === 'INVALID_FORMAT')).toBe(true);
    });

    it('birthDate 合法格式 YYYY-MM-DD 通过', async () => {
      const rows: PatientImportRow[] = [{ name: '张三', gender: Gender.MALE, phone: '13811111112', birthDate: '2024-01-15' }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows),
      );
      expect(r.summary.success).toBe(1);
    });

    it('gender 非法枚举报错', async () => {
      const rows = [{ name: '张三', gender: 'INVALID' as never, phone: '13811111113' }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows as PatientImportRow[]),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'gender' && e.code === 'INVALID_ENUM')).toBe(true);
    });

    it('address 长度 201 报错', async () => {
      const rows: PatientImportRow[] = [{ name: '张三', gender: Gender.MALE, phone: '13811111114', address: 'X'.repeat(201) }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'address')).toBe(true);
    });

    it('tags 非数组报错', async () => {
      const rows = [{ name: '张三', gender: Gender.MALE, phone: '13811111115', tags: 'NOT_AN_ARRAY' as never }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows as PatientImportRow[]),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'tags' && e.code === 'INVALID_TYPE')).toBe(true);
    });

    it('source 非法枚举默认转 WALK_IN 不报错', async () => {
      const rows = [{ name: '张三', gender: Gender.MALE, phone: '13811111116', source: 'INVALID_SOURCE' }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows as PatientImportRow[]),
      );
      expect(r.summary.success).toBe(1);
    });
  });

  // ============= TR-15.4: 药品批量 =============
  describe('TR-15.4: 药品 30 行 code 批次重复和 DB 已存在', () => {
    it('同批次 code 重复报错，DB 已存在 UPDATE 成功', async () => {
      db.prepare(
        `INSERT INTO DrugCatalog (id, code, name, spec, category, unit, price, stock, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('drug-existing-001', 'DRG-001', '原阿莫西林', '0.25g*12', '抗生素', '盒', 20.5, 0, '', TEST_CLINIC_ID, new Date().toISOString());
      const beforeCount = countDrugs();
      expect(beforeCount).toBe(1);

      const rows: DrugImportRow[] = [];
      for (let i = 0; i < 30; i++) {
        if (i === 0) {
          rows.push({ code: 'DRG-001', name: '新阿莫西林', price: 25 });
        } else if (i === 10) {
          rows.push({ code: 'DRG-010', name: '布洛芬A' });
        } else if (i === 20) {
          rows.push({ code: 'DRG-010', name: '布洛芬B' });
        } else {
          rows.push({ code: `DRG-${String(i + 100).padStart(3, '0')}`, name: `药品${i}`, price: 10 + i });
        }
      }

      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows),
      );

      expect(r.summary.success).toBe(29);
      expect(r.summary.failed).toBe(1);
      const dupError = r.rowErrors.find((e) => e.rowIndex === 20);
      expect(dupError).toBeDefined();
      expect(dupError!.errors.some((e) => e.code === 'DUPLICATE_CODE_IN_BATCH')).toBe(true);

      const drugAfter = db.prepare('SELECT name, price FROM DrugCatalog WHERE code = ? AND clinicId = ?').get('DRG-001', TEST_CLINIC_ID) as { name: string; price: number };
      expect(drugAfter.name).toBe('新阿莫西林');
      expect(drugAfter.price).toBe(25);
    });
  });

  // ============= TR-15.5: 药品 stock>0 同步加库存 =============
  describe('TR-15.5: 药品导入 stock>0 同步初始化库存', () => {
    it('stock 传入时同步创建 InventoryItem，DrugCatalog.stock 累加', async () => {
      const rows: DrugImportRow[] = [
        { code: 'DRG-STOCK-1', name: '感冒药A', price: 15, stock: 100, unit: '盒' },
        { code: 'DRG-STOCK-2', name: '感冒药B', price: 25, stock: 0, unit: '盒' },
      ];

      const beforeInv = countInventory();
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows),
      );
      expect(r.summary.success).toBe(2);

      const drug1 = db.prepare('SELECT stock FROM DrugCatalog WHERE code = ? AND clinicId = ?').get('DRG-STOCK-1', TEST_CLINIC_ID) as { stock: number };
      const drug2 = db.prepare('SELECT stock FROM DrugCatalog WHERE code = ? AND clinicId = ?').get('DRG-STOCK-2', TEST_CLINIC_ID) as { stock: number };
      expect(drug1.stock).toBe(100);
      expect(drug2.stock).toBe(0);

      const inv1 = db.prepare('SELECT stock FROM InventoryItem WHERE code = ? AND clinicId = ?').get('DRG-STOCK-1', TEST_CLINIC_ID) as { stock: number } | undefined;
      expect(inv1).toBeDefined();
      expect(inv1!.stock).toBe(100);
      expect(countInventory()).toBe(beforeInv + 1);
    });
  });

  // ============= 药品字段校验 =============
  describe('药品字段校验', () => {
    it('code 必填，缺失报错', async () => {
      const rows = [{ name: '药品A', price: 10 } as never];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows as DrugImportRow[]),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'code' && e.code === 'REQUIRED')).toBe(true);
    });

    it('name 必填且长度 1-100', async () => {
      const rows1: DrugImportRow[] = [{ code: 'D1', name: '' }];
      const r1 = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows1),
      );
      expect(r1.summary.failed).toBe(1);
      expect(r1.rowErrors[0].errors.some((e) => e.field === 'name')).toBe(true);

      const rows2: DrugImportRow[] = [{ code: 'D2', name: 'A'.repeat(101) }];
      const r2 = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows2),
      );
      expect(r2.summary.failed).toBe(1);
    });

    it('price 负数报错', async () => {
      const rows: DrugImportRow[] = [{ code: 'D3', name: '药品', price: -5 }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'price')).toBe(true);
    });

    it('stock 非整数报错', async () => {
      const rows: DrugImportRow[] = [{ code: 'D4', name: '药品', stock: Math.PI }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'stock')).toBe(true);
    });

    it('stock 负数报错', async () => {
      const rows: DrugImportRow[] = [{ code: 'D5', name: '药品', stock: -1 }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows),
      );
      expect(r.summary.failed).toBe(1);
    });

    it('药品 dryRun 不写 DB', async () => {
      const rows: DrugImportRow[] = [{ code: 'DRY-001', name: 'dry-run 药', price: 10 }];
      const before = countDrugs();
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows, { dryRun: true }),
      );
      expect(countDrugs()).toBe(before);
      expect(r.createdIds).toEqual([]);
      expect(r.summary.success).toBe(1);
    });
  });

  // ============= TR-15.6: 库存 strict vs autoCreateDrug =============
  describe('TR-15.6: 库存 strict / autoCreateDrug 模式', () => {
    it('strict 模式 DrugCatalog 缺失 → DRUG_NOT_FOUND', async () => {
      const rows: InventoryImportRow[] = [
        { sku: 'NOT-EXIST-DRUG', stock: 10, mode: 'strict' },
      ];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.code === 'DRUG_NOT_FOUND')).toBe(true);
    });

    it('autoCreateDrug 模式自动创建 DrugCatalog', async () => {
      const rows: InventoryImportRow[] = [
        { sku: 'AUTO-DRUG-001', name: '自动建的药', stock: 20, unit: '瓶', mode: 'autoCreateDrug' },
      ];
      const beforeDrugs = countDrugs();
      const beforeInv = countInventory();
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows),
      );
      expect(r.summary.success).toBe(1);
      expect(countDrugs()).toBe(beforeDrugs + 1);
      expect(countInventory()).toBe(beforeInv + 1);

      const drug = db.prepare('SELECT name, code FROM DrugCatalog WHERE code = ? AND clinicId = ?').get('AUTO-DRUG-001', TEST_CLINIC_ID);
      expect(drug).toBeDefined();
    });

    it('autoCreateDrug 但 name 缺失报错', async () => {
      const rows: InventoryImportRow[] = [
        { sku: 'AUTO-DRUG-NO-NAME', stock: 5, mode: 'autoCreateDrug' },
      ];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'name' && e.code === 'REQUIRED')).toBe(true);
    });
  });

  // ============= TR-15.7: 库存 stock 累加 =============
  describe('TR-15.7: 库存 stock 累加模式 add', () => {
    it('已有库存 sku 导入 stock 时累加（现有 2 + 传入 5 = 最终 7）', async () => {
      db.prepare(
        `INSERT INTO DrugCatalog (id, code, name, spec, category, unit, price, stock, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('d-add-1', 'SKU-ADD-1', '累加药', '1g', 'X', '盒', 10, 0, '', TEST_CLINIC_ID, new Date().toISOString());

      db.prepare(
        `INSERT INTO InventoryItem (id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('inv-add-1', 'SKU-ADD-1', '累加药', '1g', 'X', '盒', 2, 0, 1000, null, null, '', '', TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());

      const rows: InventoryImportRow[] = [
        { sku: 'SKU-ADD-1', stock: 5 },
      ];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows),
      );
      expect(r.summary.success).toBe(1);
      const inv = db.prepare('SELECT stock FROM InventoryItem WHERE code = ? AND clinicId = ?').get('SKU-ADD-1', TEST_CLINIC_ID) as { stock: number };
      expect(inv.stock).toBe(7);
    });
  });

  // ============= 库存字段校验 =============
  describe('库存字段校验', () => {
    beforeEach(() => {
      db.prepare(
        `INSERT INTO DrugCatalog (id, code, name, spec, category, unit, price, stock, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('drug-inv-val-1', 'INV-VAL-1', '库存药A', '', '', '', 0, 0, '', TEST_CLINIC_ID, new Date().toISOString());
    });

    it('sku 必填', async () => {
      const rows = [{ stock: 10 } as never];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows as InventoryImportRow[]),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'sku')).toBe(true);
    });

    it('stock 必填 整数 ≥0', async () => {
      const rows1 = [{ sku: 'INV-VAL-1' }];
      const r1 = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows1 as InventoryImportRow[]),
      );
      expect(r1.summary.failed).toBe(1);
      expect(r1.rowErrors[0].errors.some((e) => e.field === 'stock' && e.code === 'REQUIRED')).toBe(true);

      const rows2: InventoryImportRow[] = [{ sku: 'INV-VAL-1', stock: 1.5 }];
      const r2 = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows2),
      );
      expect(r2.summary.failed).toBe(1);
      expect(r2.rowErrors[0].errors.some((e) => e.field === 'stock')).toBe(true);

      const rows3: InventoryImportRow[] = [{ sku: 'INV-VAL-1', stock: -3 }];
      const r3 = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows3),
      );
      expect(r3.summary.failed).toBe(1);
    });

    it('costPriceCents 必须是整数', async () => {
      const rows: InventoryImportRow[] = [{ sku: 'INV-VAL-1', stock: 5, costPriceCents: 123.45 }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'costPriceCents')).toBe(true);
    });

    it('expiryDate 格式非法报错', async () => {
      const rows: InventoryImportRow[] = [{ sku: 'INV-VAL-1', stock: 1, expiryDate: '2024年1月1日' }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows),
      );
      expect(r.summary.failed).toBe(1);
      expect(r.rowErrors[0].errors.some((e) => e.field === 'expiryDate')).toBe(true);
    });

    it('minStock < 0 报错，maxStock < minStock 报错', async () => {
      const rows1: InventoryImportRow[] = [{ sku: 'INV-VAL-1', stock: 1, minStock: -1 }];
      const r1 = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows1),
      );
      expect(r1.summary.failed).toBe(1);
      expect(r1.rowErrors[0].errors.some((e) => e.field === 'minStock')).toBe(true);

      const rows2: InventoryImportRow[] = [{ sku: 'INV-VAL-1', stock: 1, minStock: 20, maxStock: 10 }];
      const r2 = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows2),
      );
      expect(r2.summary.failed).toBe(1);
      expect(r2.rowErrors[0].errors.some((e) => e.field === 'maxStock')).toBe(true);
    });

    it('库存 dryRun 不写 DB', async () => {
      const before = countInventory();
      const rows: InventoryImportRow[] = [{ sku: 'INV-VAL-1', stock: 10 }];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows, { dryRun: true }),
      );
      expect(countInventory()).toBe(before);
      expect(r.createdIds).toEqual([]);
      expect(r.summary.success).toBe(1);
    });
  });

  // ============= TR-15.8: 超量限制 =============
  describe('TR-15.8: 超过 aiBulkImportMaxRows=500 行限制', () => {
    it('rows=501 抛出 BusinessValidationException 「单次最大导入 500 行」', async () => {
      const rows: PatientImportRow[] = Array.from({ length: 501 }, (_, i) => ({
        name: `患者${i}`,
        gender: Gender.MALE,
        phone: `139${String(i).padStart(8, '0')}`,
      }));

      await expect(
        runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
          service.importPatients(rows),
        ),
      ).rejects.toThrow(/500/);
    });

    it('rows=500 不触发限制', async () => {
      const rows: PatientImportRow[] = Array.from({ length: 500 }, (_, i) => ({
        name: `P${i}`,
        gender: Gender.MALE,
        phone: `137${String(i).padStart(8, '0')}`,
      }));
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows),
      );
      expect(r.summary.total).toBe(500);
    });
  });

  // ============= TR-15.9: template 接口 =============
  describe('TR-15.9: template 接口列定义正确', () => {
    it('patient 模板返回必填字段和示例行', () => {
      const t = service.getImportTemplate('patient');
      expect(t.columns.length).toBeGreaterThan(0);

      const nameCol = t.columns.find((c) => c.key === 'name');
      expect(nameCol).toBeDefined();
      expect(nameCol!.required).toBe(true);
      expect(nameCol!.type).toBe('string');

      const phoneCol = t.columns.find((c) => c.key === 'phone');
      expect(phoneCol).toBeDefined();
      expect(phoneCol!.required).toBe(true);

      const genderCol = t.columns.find((c) => c.key === 'gender');
      expect(genderCol).toBeDefined();
      expect(genderCol!.required).toBe(true);
      expect(genderCol!.enumValues).toBeDefined();

      expect(t.sampleRow).toBeDefined();
      expect((t.sampleRow as PatientImportRow).name).toBeDefined();
    });

    it('drug 模板返回 code/name 必填', () => {
      const t = service.getImportTemplate('drug');
      const codeCol = t.columns.find((c) => c.key === 'code');
      const nameCol = t.columns.find((c) => c.key === 'name');
      expect(codeCol!.required).toBe(true);
      expect(nameCol!.required).toBe(true);
      expect((t.sampleRow as DrugImportRow).code).toBeDefined();
    });

    it('inventory 模板返回 sku/stock 必填，mode 有枚举值', () => {
      const t = service.getImportTemplate('inventory');
      const skuCol = t.columns.find((c) => c.key === 'sku');
      const stockCol = t.columns.find((c) => c.key === 'stock');
      const modeCol = t.columns.find((c) => c.key === 'mode');
      expect(skuCol!.required).toBe(true);
      expect(stockCol!.required).toBe(true);
      expect(modeCol!.enumValues).toEqual(['strict', 'autoCreateDrug']);
      expect((t.sampleRow as InventoryImportRow).sku).toBeDefined();
    });
  });

  // ============= TR-15.11: 开关关闭禁用 =============
  describe('TR-15.11: aiBulkImportEnabled=false 禁用所有接口', () => {
    beforeEach(() => {
      runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () => {
        settingsService.updateClinicInfo('aiBulkImportEnabled', 'false');
      });
    });

    it('importPatients 抛 403/异常：批量导入已停用', async () => {
      const rows: PatientImportRow[] = [{ name: '张三', gender: Gender.MALE, phone: '13844445555' }];
      await expect(
        runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
          service.importPatients(rows),
        ),
      ).rejects.toThrow(/批量导入已停用/);
    });

    it('importDrugCatalog 抛异常', async () => {
      const rows: DrugImportRow[] = [{ code: 'OFF-1', name: '药' }];
      await expect(
        runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
          service.importDrugCatalog(rows),
        ),
      ).rejects.toThrow(/批量导入已停用/);
    });

    it('importInventory 抛异常', async () => {
      db.prepare(
        `INSERT INTO DrugCatalog (id, code, name, spec, category, unit, price, stock, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('d-off-1', 'OFF-INV-1', '药', '', '', '', 0, 0, '', TEST_CLINIC_ID, new Date().toISOString());
      const rows: InventoryImportRow[] = [{ sku: 'OFF-INV-1', stock: 10 }];
      await expect(
        runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
          service.importInventory(rows),
        ),
      ).rejects.toThrow(/批量导入已停用/);
    });
  });

  // ============= 审计日志 =============
  describe('审计日志写入', () => {
    const countAuditByType = (type: string): number => {
      const r = db.prepare('SELECT COUNT(*) as cnt FROM AuditLog WHERE type = ? AND clinicId = ?').get(type, TEST_CLINIC_ID) as { cnt: number };
      return r.cnt;
    };

    it('患者成功导入写入 BULK_IMPORT_PATIENTS', async () => {
      const rows: PatientImportRow[] = [
        { name: '审计A', gender: Gender.MALE, phone: '13860000001' },
        { name: '审计B', gender: Gender.FEMALE, phone: '13860000002' },
      ];
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows, { createdById: TEST_USER_ID }),
      );
      expect(countAuditByType('BULK_IMPORT_PATIENTS')).toBe(1);
    });

    it('药品成功导入写入 BULK_IMPORT_DRUG_CATALOG', async () => {
      const rows: DrugImportRow[] = [{ code: 'AUD-D1', name: '审计药', price: 10 }];
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importDrugCatalog(rows, { createdById: TEST_USER_ID }),
      );
      expect(countAuditByType('BULK_IMPORT_DRUG_CATALOG')).toBe(1);
    });

    it('库存成功导入写入 BULK_IMPORT_INVENTORY', async () => {
      db.prepare(
        `INSERT INTO DrugCatalog (id, code, name, spec, category, unit, price, stock, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('d-aud-1', 'AUD-SKU-1', '库存审计药', '', '', '', 0, 0, '', TEST_CLINIC_ID, new Date().toISOString());
      const rows: InventoryImportRow[] = [{ sku: 'AUD-SKU-1', stock: 3 }];
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importInventory(rows, { createdById: TEST_USER_ID }),
      );
      expect(countAuditByType('BULK_IMPORT_INVENTORY')).toBe(1);
    });

    it('dryRun 不写审计', async () => {
      const before = countAuditByType('BULK_IMPORT_PATIENTS');
      const rows: PatientImportRow[] = [{ name: 'DryRun审计', gender: Gender.MALE, phone: '13870000001' }];
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows, { dryRun: true, createdById: TEST_USER_ID }),
      );
      expect(countAuditByType('BULK_IMPORT_PATIENTS')).toBe(before);
    });
  });

  // ============= summary 统计准确性 =============
  describe('summary 字段准确性', () => {
    it('durationMs 非负，total=success+failed+skipped', async () => {
      const rows: PatientImportRow[] = [
        { name: 'A', gender: Gender.MALE, phone: '13850000001' },
        { name: '', gender: Gender.MALE, phone: 'INVALID' },
      ];
      const r = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () =>
        service.importPatients(rows),
      );
      expect(r.summary.durationMs).toBeGreaterThanOrEqual(0);
      expect(r.summary.total).toBe(rows.length);
      expect(r.summary.success + r.summary.failed + r.summary.skipped).toBe(r.summary.total);
    });
  });
});
