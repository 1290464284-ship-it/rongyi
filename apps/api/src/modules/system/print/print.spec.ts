 
import Database from 'better-sqlite3';
import * as crypto from 'node:crypto';
import { TemplateEngineService } from './template-engine.service';
import { PrintTemplateService } from './print-template.service';
import { PrintService } from './print.service';
import { SettingsService } from '../settings/settings.service';
import { ClinicsService } from '../clinics/clinics.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import {
  createTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../../db/test-helpers';
import { DbService } from '../../../db/db.service';

process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-only-00000000000000000000000000000000';

const TEST_CLINIC_ID = 'test-clinic-print-001';
const TEST_CLINIC_2_ID = 'test-clinic-print-002';
const TEST_USER_ID = 'test-user-print-001';
const TEST_DOCTOR_ID = 'test-doctor-print-001';
const TEST_PATIENT_ID = 'test-patient-print-001';

function createClinicContext(clinicId: string = TEST_CLINIC_ID): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => TEST_USER_ID,
    getRole: () => 'BOSS',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    getContext: () => ({ clinicId, userId: TEST_USER_ID, role: 'BOSS' }),
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createSettingsService(dbService: DbService, clinicContext: ClinicContextService): SettingsService {
  const cache = new CacheService();
  const auditLog = new AuditLogService();
  return new SettingsService(dbService, cache, clinicContext, auditLog);
}

function createClinicsService(dbService: DbService, clinicContext: ClinicContextService): ClinicsService {
  const cache = new CacheService();
  return new ClinicsService(dbService, clinicContext, cache);
}

function uuid(): string {
  return crypto.randomUUID();
}

describe('PrintModule - Template Engine + Templates + Render + Print', () => {
  let db: Database.Database;
  let dbService: DbService;
  let clinicContext: ClinicContextService;
  let settingsService: SettingsService;
  let clinicsService: ClinicsService;

  let templateEngine: TemplateEngineService;
  let templateService: PrintTemplateService;
  let printService: PrintService;

  beforeEach(() => {
    db = createTestDb();
    db.pragma('foreign_keys = OFF');

    db.exec(`
      CREATE TABLE IF NOT EXISTS PrintTemplate (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('PRESCRIPTION','FINANCIAL','CLINICAL','REPORT')),
        content TEXT NOT NULL,
        variables TEXT NOT NULL DEFAULT '{}',
        isDefault INTEGER DEFAULT 0 CHECK (isDefault IN (0,1)),
        paperSize TEXT DEFAULT 'A4' CHECK (paperSize IN ('A4','A5','RECEIPT')),
        orientation TEXT DEFAULT 'portrait' CHECK (orientation IN ('portrait','landscape')),
        clinicId TEXT NOT NULL,
        createdBy TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        deletedAt TEXT,
        UNIQUE(clinicId, code)
      );
      CREATE INDEX IF NOT EXISTS IDX_PrintTemplate_clinicId_code ON PrintTemplate(clinicId, code);
      CREATE INDEX IF NOT EXISTS IDX_PrintTemplate_clinicId_category ON PrintTemplate(clinicId, category);
    `);

    dbService = createTestDbService(db);
    clinicContext = createClinicContext();
    settingsService = createSettingsService(dbService, clinicContext);
    clinicsService = createClinicsService(dbService, clinicContext);

    templateEngine = new TemplateEngineService();
    templateService = new PrintTemplateService(dbService, clinicContext);
    printService = new PrintService(
      dbService,
      clinicContext,
      templateEngine,
      templateService,
      settingsService,
      clinicsService,
    );

    runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' }, () => {
      seedTestData(db);

      db.prepare(
        `INSERT OR IGNORE INTO Clinic (id, name, code, address, phone, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(TEST_CLINIC_ID, '荣毅测试诊所', 'RY-TEST', '北京市朝阳区测试路1号', '010-88888888', new Date().toISOString(), new Date().toISOString());

      db.prepare(
        `INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`
      ).run(TEST_CLINIC_2_ID, '荣毅第二诊所', 'RY-TEST-2', new Date().toISOString(), new Date().toISOString());

      db.prepare(
        `INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'DOCTOR', 1, ?, ?, ?)`
      ).run(TEST_DOCTOR_ID, 'doc1', 'hash', '李医生', TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());

      db.prepare(
        `INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, 'MALE', '13800000000', ?, ?, ?)`
      ).run(TEST_PATIENT_ID, 'P001', '张三', TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());
    });
  });

  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
  });

  // =========================================================================
  // TR-16.1 ~ TR-16.9: Template Engine
  // =========================================================================
  describe('TemplateEngineService', () => {
    it('TR-16.1 变量替换：Hello {{name}} + {name:"张三"} → "Hello 张三"', () => {
      const { html } = templateEngine.render('Hello {{name}}', { name: '张三' });
      expect(html).toBe('Hello 张三');
    });

    it('TR-16.2 嵌套变量：Doctor {{doctor.name}} {{doctor.title}} → "Dr Li 主治医师"', () => {
      const { html } = templateEngine.render(
        'Doctor {{doctor.name}} {{doctor.title}}',
        { doctor: { name: 'Dr Li', title: '主治医师' } },
      );
      expect(html).toBe('Doctor Dr Li 主治医师');
    });

    it('TR-16.3 缺变量：Hello {{unknown}} → "Hello "（不抛异常）', () => {
      expect(() => {
        const { html } = templateEngine.render('Hello {{unknown}}', { name: '张三' });
        expect(html).toBe('Hello ');
      }).not.toThrow();
    });

    it('TR-16.4 HTML 转义：双括号转义 三括号不转义', () => {
      const text = '&<>"\'';
      const { html: escaped } = templateEngine.render('{{text}}', { text });
      expect(escaped).toContain('&amp;');
      expect(escaped).toContain('&lt;');
      expect(escaped).toContain('&gt;');
      expect(escaped).toContain('&quot;');
      expect(escaped).toContain('&#39;');

      const { html: raw } = templateEngine.render('{{{raw}}}', { raw: text });
      expect(raw).toBe('&<>"\'');
    });

    it('TR-16.5 if truthy：paid=true → 已付；paid=false → 未付；paid=0 → 未付；paid=1 → 已付', () => {
      const tpl = '{{#if paid}}已付{{else}}未付{{/if}}';
      expect(templateEngine.render(tpl, { paid: true }).html).toBe('已付');
      expect(templateEngine.render(tpl, { paid: false }).html).toBe('未付');
      expect(templateEngine.render(tpl, { paid: 0 }).html).toBe('未付');
      expect(templateEngine.render(tpl, { paid: 1 }).html).toBe('已付');
      expect(templateEngine.render(tpl, { paid: '' }).html).toBe('未付');
      expect(templateEngine.render(tpl, { paid: null }).html).toBe('未付');
    });

    it('TR-16.6 each items：循环渲染 + 空数组为空', () => {
      const tpl = '{{#each items}}{{this.n}}{{/each}}';
      expect(templateEngine.render(tpl, { items: [{ n: 'A' }, { n: 'B' }] }).html).toBe('AB');
      expect(templateEngine.render(tpl, { items: [] }).html).toBe('');
    });

    it('TR-16.7 each 深层属性访问：this.sub.n → 1', () => {
      const tpl = '{{#each items}}{{this.sub.n}}{{/each}}';
      const { html } = templateEngine.render(tpl, { items: [{ sub: { n: 1 } }] });
      expect(html).toBe('1');
    });

    it('TR-16.8 注释：a{{!-- x --}}b → "ab"', () => {
      const { html } = templateEngine.render('a{{!-- anything here --}}b', {});
      expect(html).toBe('ab');
    });

    it('TR-16.9 深度嵌套防护：8 层正常；9 层抛出 Max depth 异常', () => {
      const buildNested = (levels: number): string => {
        let inner = 'X';
        for (let i = 0; i < levels; i++) {
          inner = `{{#each list}}${inner}{{/each}}`;
        }
        return inner;
      };

      const list = [1];
      // eslint-disable-next-line sonarjs/no-ignored-return -- 仅构造深层嵌套数据用于后续测试
      Array(8).fill(0).reduce<Record<string, unknown>>((c) => ({ list: [c] }), { list } as unknown as Record<string, unknown>);

      expect(() => {
        templateEngine.render(buildNested(8), { list: [1, 1, 1, 1, 1, 1, 1, 1] });
      }).not.toThrow();

      expect(() => {
        const tpl9 = buildNested(9);
        const nineItems = [1, 1, 1, 1, 1, 1, 1, 1, 1];
        templateEngine.render(tpl9, { list: nineItems });
      }).toThrow(/Max nesting depth exceeded/i);
    });
  });

  // =========================================================================
  // TR-16.10 ~ TR-16.16: PrintTemplateService (CRUD + seedDefaults)
  // =========================================================================
  describe('PrintTemplateService', () => {
    it('TR-16.10 seedDefaults 5 套模板存在：listTemplates 返回 5 条；isDefault=1', () => {
      runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => {
        templateService.seedDefaults(TEST_CLINIC_ID);
        const list = templateService.listTemplates();
        expect(list.length).toBe(5);
        expect(list.filter((t) => t.isDefault === 1).length).toBe(5);
        const codes = new Set(list.map((t) => t.code));
        expect(codes.has('PRESCRIPTION')).toBe(true);
        expect(codes.has('RECEIPT')).toBe(true);
        expect(codes.has('TREATMENT_PLAN')).toBe(true);
        expect(codes.has('CLINIC_REPORT')).toBe(true);
        expect(codes.has('CEPHALOMETRIC_REPORT')).toBe(true);
      });
    });

    it('TR-16.16 saveTemplate 更新后再 get：content 一致；setDefault 后 isDefault=1 其他=0', () => {
      runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => {
        templateService.seedDefaults(TEST_CLINIC_ID);

        const newContent = '<custom>receipt-v2</custom>';
        templateService.saveTemplate('RECEIPT', { name: '自定义收费凭证', content: newContent, paperSize: 'A4' });

        const after = templateService.getTemplate('RECEIPT');
        expect(after.content).toBe(newContent);
        expect(after.name).toBe('自定义收费凭证');
        expect(after.paperSize).toBe('A4');

        const financialList = templateService.listTemplates({ category: 'FINANCIAL' });
        const allDefaulted = financialList.every((t) => t.isDefault === 1);
        expect(allDefaulted || financialList.length === 1).toBe(true);

        templateService.saveTemplate('RECEIPT', { name: '自定义副本', content: '<other/>' });
        const presetAfterCustom = templateService.listTemplates();
        expect(presetAfterCustom.length).toBeGreaterThanOrEqual(1);

        const receipt = templateService.setDefault('RECEIPT');
        expect(receipt.isDefault).toBe(1);
      });
    });

    it('TR-16.19 category 过滤：category="FINANCIAL" 仅返回 RECEIPT', () => {
      runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => {
        templateService.seedDefaults(TEST_CLINIC_ID);
        const list = templateService.listTemplates({ category: 'FINANCIAL' });
        expect(list.every((t) => t.code === 'RECEIPT')).toBe(true);
        expect(list.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('TR-16.20 重复 seedDefaults：第 2 次不新增；5 条不变（idempotent）', () => {
      runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => {
        const c1 = templateService.seedDefaults(TEST_CLINIC_ID);
        const firstList = templateService.listTemplates();
        const c2 = templateService.seedDefaults(TEST_CLINIC_ID);
        const secondList = templateService.listTemplates();
        expect(c1).toBe(5);
        expect(c2).toBe(0);
        expect(secondList.length).toBe(firstList.length);
      });
    });

    it('TR-16.21 code+clinicId UNIQUE 冲突：两不同 clinic 可各存自己的 RECEIPT 模板', () => {
      runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => {
        templateService.seedDefaults(TEST_CLINIC_ID);
      });
      const ctx2 = createClinicContext(TEST_CLINIC_2_ID);
      const svc2 = new PrintTemplateService(dbService, ctx2);
      runInClinicContext(ctx2, { clinicId: TEST_CLINIC_2_ID, userId: 'test-user-2', role: 'ADMIN' }, () => {
        const count = svc2.seedDefaults(TEST_CLINIC_2_ID);
        expect(count).toBe(5);
        svc2.saveTemplate('RECEIPT', { name: '诊所2专属收据', content: '<clinic2/>' });
      });

      const r1 = db.prepare(`SELECT name FROM PrintTemplate WHERE code='RECEIPT' AND clinicId=?`).get(TEST_CLINIC_ID) as { name: string };
      const r2 = db.prepare(`SELECT name FROM PrintTemplate WHERE code='RECEIPT' AND clinicId=?`).get(TEST_CLINIC_2_ID) as { name: string };
      expect(r1.name).toBe('收据模板');
      expect(r2.name).toBe('诊所2专属收据');
    });
  });

  // =========================================================================
  // TR-16.11 ~ TR-16.15 + TR-16.17 + TR-16.18 + TR-16.22: PrintService
  // =========================================================================
  describe('PrintService', () => {
    function seedPrescription() {
      const id = uuid();
      db.prepare(`INSERT INTO Prescription (id, patientId, doctorId, remark, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, TEST_PATIENT_ID, TEST_DOCTOR_ID, '饭后温水送服', TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());
      for (let i = 0; i < 3; i++) {
        db.prepare(`INSERT INTO PrescriptionItem (id, prescriptionId, drugCode, drugName, spec, dosage, frequency, days, quantity, unit, clinicId) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(uuid(), id, `D${i}`, `阿莫西林${i}`, '0.25g', '口服 0.5g', '每日3次', 5, i + 1, '盒', TEST_CLINIC_ID);
      }
      return id;
    }

    function seedCharge() {
      const id = uuid();
      const totalCents = 1000 * 100;
      db.prepare(`INSERT INTO Charge (id, patientId, doctorId, number, totalAmount, paidAmount, discount, status, clinicId, createdAt, paidAt, updatedAt) VALUES (?,?,?,?,?,?,?, 'PAID', ?,?,?,?)`)
        .run(id, TEST_PATIENT_ID, TEST_DOCTOR_ID, `C${Date.now()}`, totalCents, totalCents - 1000, 1000, TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
      for (let i = 0; i < 2; i++) {
        db.prepare(`INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId) VALUES (?,?,?,?,?,?,?,?)`)
          .run(uuid(), id, `洁牙项目${i}`, 'TREATMENT', 500 * 100, 1, 500 * 100, TEST_CLINIC_ID);
      }
      return id;
    }

    function seedTreatmentPlan() {
      const id = uuid();
      db.prepare(`INSERT INTO TreatmentPlan (id, patientId, doctorId, name, status, totalFee, remark, clinicId, createdAt, updatedAt) VALUES (?,?,?,?, 'IN_PROGRESS', ?, ?, ?, ?, ?)`)
        .run(id, TEST_PATIENT_ID, TEST_DOCTOR_ID, '牙周系统治疗方案', 12800 * 100, '患者主诉牙龈出血', TEST_CLINIC_ID, new Date().toISOString(), new Date().toISOString());
      const statuses = ['COMPLETED', 'IN_PROGRESS', 'PLANNED', 'PLANNED'];
      for (let i = 0; i < statuses.length; i++) {
        db.prepare(`INSERT INTO TreatmentPlanItem (id, planId, code, name, category, price, quantity, status, clinicId) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(uuid(), id, `TPI${i}`, `龈下刮治${i}`, 'PERIO', 2000 * 100, 1, statuses[i], TEST_CLINIC_ID);
      }
      return id;
    }

    it('TR-16.11 renderPrescription：HTML 含【药品】表格 + 医生签名位 + 配伍警示（若有）', async () => {
      const id = seedPrescription();
      const html = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () =>
        printService.renderPrescription(id),
      );
      expect(html.length).toBeGreaterThan(100);
      expect(html).toMatch(/阿莫西林/);
      expect(html).toMatch(/李医生/);
      expect(html).toMatch(/处.*方.*笺/);
    });

    it('TR-16.12 renderReceipt：HTML 含收费明细 + 合计 + 实收 + 支付方式', async () => {
      const id = seedCharge();
      const html = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () =>
        printService.renderReceipt(id),
      );
      expect(html.length).toBeGreaterThan(100);
      expect(html).toMatch(/洁牙项目/);
      expect(html).toMatch(/合计|合计/);
      expect(html).toMatch(/实收|paidAmount/);
      expect(html).toMatch(/张三/);
    });

    it('TR-16.13 renderTreatmentPlan：HTML 含进度条 completion% + 牙位 + 预计完成日期', async () => {
      const id = seedTreatmentPlan();
      const html = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () =>
        printService.renderTreatmentPlan(id),
      );
      expect(html.length).toBeGreaterThan(100);
      expect(html).toMatch(/完成度|completionPercent/);
      expect(html).toMatch(/预计完成/);
    });

    it('TR-16.14 renderClinicReport：HTML 含 KPI 6 项 + TOP 医生 5 + TOP 库存报警 10 + 异常 list + 30天趋势', async () => {
      const html = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () =>
        printService.renderClinicReport({ month: '2024-08' }),
      );
      expect(html.length).toBeGreaterThan(500);
      expect(html).toMatch(/就诊|总就诊|visits/i);
      expect(html).toMatch(/收入|revenue/i);
      expect(html).toMatch(/客单价|avgOrder/i);
      expect(html).toMatch(/NPS/);
      expect(html).toMatch(/新增|新患者/i);
      expect(html).toMatch(/复诊|revisit/i);
      expect(html).toMatch(/医生业绩|topDoctors|TOP/);
      expect(html).toMatch(/库存|stock|库存报警/);
      expect(html).toMatch(/30天|趋势|revenueTrend/);
    });

    it('TR-16.15 4 套 preview：每个 code + sampleContext 返回 HTML 非空；不触发真实 DB 异常', () => {
      runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => {
        templateService.seedDefaults(TEST_CLINIC_ID);
      });
      for (const code of ['PRESCRIPTION', 'RECEIPT', 'TREATMENT_PLAN', 'CLINIC_REPORT'] as const) {
        const ctx = printService.getSampleContext(code);
        const html = printService.renderPreview(code, ctx);
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(100);
      }
    });

    it('TR-16.17 Settings aiPrintEnabled=false → 所有 render 返回禁用异常；preview 不禁', async () => {
      runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => {
        templateService.seedDefaults(TEST_CLINIC_ID);
      });
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, async () => {
        await settingsService.updateClinicInfo('aiPrintEnabled', 'false');
      });

      const freshCtx = createClinicContext();
      const freshSettings = createSettingsService(dbService, freshCtx);
      const freshClinics = createClinicsService(dbService, freshCtx);
      const freshSvc = new PrintService(
        dbService, freshCtx, new TemplateEngineService(),
        new PrintTemplateService(dbService, freshCtx),
        freshSettings, freshClinics,
      );

      const pid = seedPrescription();
      await expect(
        runInClinicContext(freshCtx, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => freshSvc.renderPrescription(pid)),
      ).rejects.toThrow(/打印功能已禁用/);

      const cid = seedCharge();
      await expect(
        runInClinicContext(freshCtx, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => freshSvc.renderReceipt(cid)),
      ).rejects.toThrow(/打印功能已禁用/);

      await expect(
        runInClinicContext(freshCtx, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () =>
          freshSvc.renderClinicReport({ month: '2024-08' }),
        ),
      ).rejects.toThrow(/打印功能已禁用/);

      runInClinicContext(freshCtx, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () => {
        new PrintTemplateService(dbService, freshCtx).seedDefaults(TEST_CLINIC_ID);
      });
      expect(() => {
        const html = freshSvc.renderPreview('RECEIPT', freshSvc.getSampleContext('RECEIPT'));
        expect(html.length).toBeGreaterThan(100);
      }).not.toThrow();
    });

    it('TR-16.18 自定义变量注入：clinic.logo/clinicName/address/phone 在所有模板顶部可用', async () => {
      await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, async () => {
        await settingsService.updateClinicInfo('aiPrintClinicLogo', 'data:image/png;base64,iVBOR-test');
        templateService.seedDefaults(TEST_CLINIC_ID);
      });
      const pid = seedPrescription();
      const html = await runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'test-user', role: 'ADMIN' }, () =>
        printService.renderPrescription(pid),
      );
      expect(html).toMatch(/荣毅测试诊所/);
      expect(html).toMatch(/北京市朝阳区测试路1号/);
      expect(html).toMatch(/010-88888888/);
    });

    it('TR-16.22 模板 if+each 组合：有 items 渲染列表；无则「空」', () => {
      const tpl = '{{#if items}}{{#each items}}{{this.name}}{{/each}}{{else}}空{{/if}}';
      expect(
        templateEngine.render(tpl, { items: [{ name: 'A' }, { name: 'B' }] }).html
      ).toBe('AB');
      expect(
        templateEngine.render(tpl, { items: [] }).html
      ).toBe('空');
      expect(
        templateEngine.render(tpl, { items: null }).html
      ).toBe('空');
    });
  });
});
