import { DatabaseConsistencyService } from './db-consistency.service';
import { ChargeConsistencyChecker } from './charge-consistency-checker';
import { MemberCardConsistencyChecker } from './member-card-consistency-checker';
import { InventoryConsistencyChecker } from './inventory-consistency-checker';
import { ForeignKeyConsistencyChecker } from './foreign-key-consistency-checker';
import { BusinessRuleConsistencyChecker } from './business-rule-consistency-checker';
import { createTestDb, createTestDbService, seedTestData } from '../../../db/test-helpers';
import Database from 'better-sqlite3';
import * as crypto from 'node:crypto';

describe('DatabaseConsistencyService', () => {
  let db: Database.Database;
  let service: DatabaseConsistencyService;

  beforeEach(() => {
    db = createTestDb();
    const dbService = createTestDbService(db);
    const chargeChecker = new ChargeConsistencyChecker(dbService);
    const memberCardChecker = new MemberCardConsistencyChecker(dbService);
    const inventoryChecker = new InventoryConsistencyChecker(dbService);
    const foreignKeyChecker = new ForeignKeyConsistencyChecker(dbService);
    const businessRuleChecker = new BusinessRuleConsistencyChecker(dbService);
    service = new DatabaseConsistencyService(
      chargeChecker,
      memberCardChecker,
      inventoryChecker,
      foreignKeyChecker,
      businessRuleChecker,
    );
    seedTestData(db);
  });

  afterEach(() => {
    db.close();
  });

  const getTestPatient = () => {
    return db.prepare('SELECT * FROM Patient LIMIT 1').get() as { id: string; clinicId: string };
  };

  describe('getAvailableChecks', () => {
    it('应返回所有可用的检查项', () => {
      const checks = service.getAvailableChecks();
      expect(Array.isArray(checks)).toBe(true);
      expect(checks.length).toBeGreaterThan(0);
      expect(checks).toContain('charge_total_amount');
      expect(checks).toContain('inventory_stock_balance');
      expect(checks).toContain('orphan_records');
    });
  });

  describe('runAllChecks', () => {
    it('空数据库应返回全部通过的结果', async () => {
      const result = await service.runAllChecks();
      expect(result).toBeDefined();
      expect(result.status).toBe('ok');
      expect(result.totalChecks).toBe(service.getAvailableChecks().length);
      expect(result.passedChecks).toBe(result.totalChecks);
      expect(result.failedChecks).toBe(0);
      expect(result.totalIssues).toBe(0);
    });
  });

  describe('金额一致性检查', () => {
    describe('charge_total_amount', () => {
      it('收费单总金额与项目金额一致时应通过', async () => {
        const patient = getTestPatient();
        const chargeId = crypto.randomUUID();
        const itemId1 = crypto.randomUUID();
        const itemId2 = crypto.randomUUID();

        db.prepare(`
          INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, status, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'C001', 1500, 0, 'UNPAID', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(chargeId, patient.id, patient.clinicId);

        db.prepare(`
          INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '洗牙', '基础护理', 500, 1, 500, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId1, chargeId, patient.clinicId);

        db.prepare(`
          INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '补牙', '治疗', 1000, 1, 1000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId2, chargeId, patient.clinicId);

        const result = await service.runCheck('charge_total_amount');
        expect(result.status).toBe('ok');
        expect(result.issues.length).toBe(0);
      });

      it('收费单总金额与项目金额不一致时应检测出问题', async () => {
        const patient = getTestPatient();
        const chargeId = crypto.randomUUID();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, status, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'C002', 2000, 0, 'UNPAID', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(chargeId, patient.id, patient.clinicId);

        db.prepare(`
          INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '洗牙', '基础护理', 500, 1, 500, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, chargeId, patient.clinicId);

        const result = await service.runCheck('charge_total_amount');
        expect(result.status).toBe('error');
        expect(result.issues.length).toBe(1);
        expect(result.issues[0].id).toBe(chargeId);
        expect(result.issues[0].type).toBe('charge_total_amount_mismatch');
      });
    });

    describe('member_card_balance', () => {
      it('会员卡余额与交易记录一致时应通过', async () => {
        const patient = getTestPatient();
        const cardId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge, totalConsume, status, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'MC001', 500, 1000, 500, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(cardId, patient.id, patient.clinicId);

        const logId1 = crypto.randomUUID();
        const logId2 = crypto.randomUUID();

        db.prepare(`
          INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, clinicId, createdAt)
          VALUES (?, ?, 'RECHARGE', 1000, 1000, ?, CURRENT_TIMESTAMP)
        `).run(logId1, cardId, patient.clinicId);

        db.prepare(`
          INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, clinicId, createdAt)
          VALUES (?, ?, 'CONSUME', 500, 500, ?, CURRENT_TIMESTAMP)
        `).run(logId2, cardId, patient.clinicId);

        const result = await service.runCheck('member_card_balance');
        expect(result.status).toBe('ok');
        expect(result.issues.length).toBe(0);
      });

      it('会员卡余额与交易记录不一致时应检测出问题', async () => {
        const patient = getTestPatient();
        const cardId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge, totalConsume, status, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'MC002', 9999, 1000, 500, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(cardId, patient.id, patient.clinicId);

        const logId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, clinicId, createdAt)
          VALUES (?, ?, 'RECHARGE', 1000, 1000, ?, CURRENT_TIMESTAMP)
        `).run(logId, cardId, patient.clinicId);

        const result = await service.runCheck('member_card_balance');
        expect(result.status).toBe('error');
        expect(result.issues.length).toBe(1);
        expect(result.issues[0].id).toBe(cardId);
      });
    });
  });

  describe('库存一致性检查', () => {
    describe('inventory_stock_balance', () => {
      it('库存数量与流水一致时应通过', async () => {
        const patient = getTestPatient();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO InventoryItem (id, code, name, category, unit, stock, price, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '牙科材料A', '材料', '盒', 50, 1000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, 'MAT001', patient.clinicId);

        const txId1 = crypto.randomUUID();
        const txId2 = crypto.randomUUID();

        db.prepare(`
          INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'IN', 100, 1000, 100000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(txId1, itemId, patient.clinicId);

        db.prepare(`
          INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'OUT', 50, 1000, 50000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(txId2, itemId, patient.clinicId);

        const result = await service.runCheck('inventory_stock_balance');
        expect(result.status).toBe('ok');
        expect(result.issues.length).toBe(0);
      });

      it('库存数量与流水不一致时应检测出问题', async () => {
        const patient = getTestPatient();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO InventoryItem (id, code, name, category, unit, stock, price, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '牙科材料B', '材料', '盒', 999, 1000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, 'MAT002', patient.clinicId);

        const txId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'IN', 100, 1000, 100000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(txId, itemId, patient.clinicId);

        const result = await service.runCheck('inventory_stock_balance');
        expect(result.status).toBe('error');
        expect(result.issues.length).toBe(1);
        expect(result.issues[0].id).toBe(itemId);
      });
    });

    describe('inventory_amount_positive', () => {
      it('库存数量和价格均为非负时应通过', async () => {
        const patient = getTestPatient();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO InventoryItem (id, code, name, category, unit, stock, price, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '正常材料', '材料', '盒', 10, 1000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, 'NORM001', patient.clinicId);

        const result = await service.runCheck('inventory_amount_positive');
        expect(result.status).toBe('ok');
      });
    });

    describe('inventory_transaction_item_exists', () => {
      it('库存流水引用存在的库存项时应通过', async () => {
        const patient = getTestPatient();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO InventoryItem (id, code, name, category, unit, stock, price, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '材料C', '材料', '盒', 10, 1000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, 'MAT003', patient.clinicId);

        const txId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO InventoryTransaction (id, itemId, type, quantity, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'IN', 10, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(txId, itemId, patient.clinicId);

        const result = await service.runCheck('inventory_transaction_item_exists');
        expect(result.status).toBe('ok');
        expect(result.issues.length).toBe(0);
      });

      it('库存流水引用不存在的库存项时应检测出问题', async () => {
        const patient = getTestPatient();
        const txId = crypto.randomUUID();

        db.pragma('foreign_keys = OFF');
        db.prepare(`
          INSERT INTO InventoryTransaction (id, itemId, type, quantity, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'IN', 10, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(txId, 'non-existent-item-id', patient.clinicId);
        db.pragma('foreign_keys = ON');

        const result = await service.runCheck('inventory_transaction_item_exists');
        expect(result.status).toBe('error');
        expect(result.issues.length).toBe(1);
        expect(result.issues[0].id).toBe(txId);
      });
    });
  });

  describe('业务规则检查', () => {
    describe('charge_status_payment', () => {
      it('已全额支付且状态为PAID时应通过', async () => {
        const patient = getTestPatient();
        const chargeId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, refundedAmount, status, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'C003', 1000, 1000, 0, 'PAID', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(chargeId, patient.id, patient.clinicId);

        const result = await service.runCheck('charge_status_payment');
        expect(result.status).toBe('ok');
        expect(result.issues.length).toBe(0);
      });

      it('状态为PAID但金额不匹配时应检测出问题', async () => {
        const patient = getTestPatient();
        const chargeId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, refundedAmount, status, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'C004', 1000, 500, 0, 'PAID', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(chargeId, patient.id, patient.clinicId);

        const result = await service.runCheck('charge_status_payment');
        expect(result.status).toBe('error');
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues.some(i => i.id === chargeId)).toBe(true);
      });
    });
  });

  describe('结构检查', () => {
    describe('orphan_records', () => {
      it('没有孤立记录时应通过', async () => {
        const result = await service.runCheck('orphan_records');
        expect(result.status).toBe('ok');
      });

      it('存在孤立的收费项目时应检测出问题', async () => {
        const patient = getTestPatient();
        const itemId = crypto.randomUUID();

        db.pragma('foreign_keys = OFF');
        db.prepare(`
          INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '孤立项目', '测试', 100, 1, 100, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, 'non-existent-charge-id', patient.clinicId);
        db.pragma('foreign_keys = ON');

        const result = await service.runCheck('orphan_records');
        expect(result.status).toBe('error');
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues.some(i => i.id === itemId)).toBe(true);
      });
    });

    describe('soft_delete_cascade', () => {
      it('软删除级联正确时应通过', async () => {
        const patient = getTestPatient();
        const chargeId = crypto.randomUUID();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, status, clinicId, createdAt, updatedAt, deletedAt)
          VALUES (?, ?, 'C005', 1000, 0, 'CANCELLED', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(chargeId, patient.id, patient.clinicId);

        db.prepare(`
          INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt, updatedAt, deletedAt)
          VALUES (?, ?, '测试项目', '测试', 1000, 1, 1000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, chargeId, patient.clinicId);

        const result = await service.runCheck('soft_delete_cascade');
        expect(result.status).toBe('ok');
      });

      it('收费单已软删除但项目未级联删除时应检测出问题', async () => {
        const patient = getTestPatient();
        const chargeId = crypto.randomUUID();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, status, clinicId, createdAt, updatedAt, deletedAt)
          VALUES (?, ?, 'C006', 1000, 0, 'CANCELLED', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(chargeId, patient.id, patient.clinicId);

        db.prepare(`
          INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '未删除项目', '测试', 1000, 1, 1000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, chargeId, patient.clinicId);

        const result = await service.runCheck('soft_delete_cascade');
        expect(result.status).toBe('error');
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues.some(i => i.id === itemId)).toBe(true);
      });
    });
  });

  describe('外键完整性检查', () => {
    describe('clinic_id_consistency', () => {
      it('关联表clinicId与主表一致时应通过', async () => {
        const patient = getTestPatient();
        const chargeId = crypto.randomUUID();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, status, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'C007', 1000, 0, 'UNPAID', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(chargeId, patient.id, patient.clinicId);

        db.prepare(`
          INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '项目A', '测试', 1000, 1, 1000, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, chargeId, patient.clinicId);

        const result = await service.runCheck('clinic_id_consistency');
        expect(result.status).toBe('ok');
      });

      it('关联表clinicId与主表不一致时应检测出问题', async () => {
        const patient = getTestPatient();
        const chargeId = crypto.randomUUID();
        const itemId = crypto.randomUUID();

        db.prepare(`
          INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, status, clinicId, createdAt, updatedAt)
          VALUES (?, ?, 'C008', 1000, 0, 'UNPAID', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(chargeId, patient.id, patient.clinicId);

        db.prepare(`
          INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId, createdAt, updatedAt)
          VALUES (?, ?, '项目B', '测试', 1000, 1, 1000, 'different-clinic-id', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(itemId, chargeId);

        const result = await service.runCheck('clinic_id_consistency');
        expect(result.status).toBe('error');
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues.some(i => i.id === itemId)).toBe(true);
      });
    });
  });

  describe('runCheck', () => {
    it('运行单个检查项应返回正确结果', async () => {
      const result = await service.runCheck('charge_total_amount');
      expect(result).toBeDefined();
      expect(result.name).toBe('charge_total_amount');
      expect(result.status).toBe('ok');
      expect(typeof result.durationMs).toBe('number');
    });

    it('检查不存在的检查项应抛出错误', async () => {
      await expect(service.runCheck('non_existent_check')).rejects.toThrow();
    });
  });
});
