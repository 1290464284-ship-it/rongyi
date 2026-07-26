import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseConsistencyChecker } from './base-consistency-checker';
import { CheckDefinition, ConsistencyChecker, CheckResult } from './consistency-checker.interface';

@Injectable()
export class ForeignKeyConsistencyChecker extends BaseConsistencyChecker implements ConsistencyChecker {
  readonly name = 'foreign-key';

  constructor(private dbService: DbService) {
    super();
  }

  getChecks(): CheckDefinition[] {
    return [
      {
        name: 'soft_delete_foreign_key',
        description: '软删除外键引用一致性检查',
        category: 'foreign_key',
        fn: () => this.checkSoftDeleteForeignKey(),
      },
      {
        name: 'clinic_id_consistency',
        description: '关联表 clinicId 与主表一致性检查',
        category: 'foreign_key',
        fn: () => this.checkClinicIdConsistency(),
      },
      {
        name: 'orphan_records',
        description: '孤立记录检查（引用不存在的外键）',
        category: 'structure',
        fn: () => this.checkOrphanRecords(),
      },
      {
        name: 'soft_delete_cascade',
        description: '软删除数据级联正确性检查',
        category: 'structure',
        fn: () => this.checkSoftDeleteCascade(),
      },
    ];
  }

  private checkSoftDeleteForeignKey(): CheckResult {
    return this.measureTime('soft_delete_foreign_key', () => {
      const issues: CheckResult['issues'] = [];

      const chargeItems = this.dbService.prepare(`
        SELECT ci.id, ci.chargeId
        FROM ChargeItem ci
        LEFT JOIN Charge c ON ci.chargeId = c.id
        WHERE ci.deletedAt IS NULL AND c.deletedAt IS NOT NULL
      `).all() as Array<{ id: string; chargeId: string }>;

      issues.push(...chargeItems.map(row => ({
        id: row.id,
        type: 'soft_delete_fk_charge_item',
        description: '收费项目引用了已软删除的收费单',
        details: { chargeId: row.chargeId },
      })));

      const memberCardLogs = this.dbService.prepare(`
        SELECT mcl.id, mcl.cardId
        FROM MemberCardLog mcl
        LEFT JOIN MemberCard mc ON mcl.cardId = mc.id
        WHERE mc.deletedAt IS NOT NULL
      `).all() as Array<{ id: string; cardId: string }>;

      issues.push(...memberCardLogs.map(row => ({
        id: row.id,
        type: 'soft_delete_fk_member_card_log',
        description: '会员卡日志引用了已软删除的会员卡',
        details: { cardId: row.cardId },
      })));

      const inventoryTransactions = this.dbService.prepare(`
        SELECT it.id, it.itemId
        FROM InventoryTransaction it
        LEFT JOIN InventoryItem ii ON it.itemId = ii.id
        WHERE it.deletedAt IS NULL AND ii.deletedAt IS NOT NULL
      `).all() as Array<{ id: string; itemId: string }>;

      issues.push(...inventoryTransactions.map(row => ({
        id: row.id,
        type: 'soft_delete_fk_inventory_transaction',
        description: '库存流水引用了已软删除的库存项',
        details: { itemId: row.itemId },
      })));

      return {
        issues,
        message: issues.length === 0
          ? '所有软删除外键引用均一致'
          : `发现 ${issues.length} 个软删除外键引用不一致`,
      };
    });
  }

  private checkClinicIdConsistency(): CheckResult {
    return this.measureTime('clinic_id_consistency', () => {
      const issues: CheckResult['issues'] = [];

      const chargeItems = this.dbService.prepare(`
        SELECT ci.id, ci.chargeId, ci.clinicId as itemClinicId, c.clinicId as chargeClinicId
        FROM ChargeItem ci
        JOIN Charge c ON ci.chargeId = c.id
        WHERE ci.deletedAt IS NULL AND c.deletedAt IS NULL
          AND ci.clinicId <> c.clinicId
      `).all() as Array<{ id: string; chargeId: string; itemClinicId: string; chargeClinicId: string }>;

      issues.push(...chargeItems.map(row => ({
        id: row.id,
        type: 'clinic_id_mismatch_charge_item',
        description: '收费项目的 clinicId 与收费单不一致',
        details: {
          chargeId: row.chargeId,
          itemClinicId: row.itemClinicId,
          chargeClinicId: row.chargeClinicId,
        },
      })));

      const inventoryTransactions = this.dbService.prepare(`
        SELECT it.id, it.itemId, it.clinicId as txClinicId, ii.clinicId as itemClinicId
        FROM InventoryTransaction it
        JOIN InventoryItem ii ON it.itemId = ii.id
        WHERE it.deletedAt IS NULL AND ii.deletedAt IS NULL
          AND it.clinicId <> ii.clinicId
      `).all() as Array<{ id: string; itemId: string; txClinicId: string; itemClinicId: string }>;

      issues.push(...inventoryTransactions.map(row => ({
        id: row.id,
        type: 'clinic_id_mismatch_inventory_transaction',
        description: '库存流水的 clinicId 与库存项不一致',
        details: {
          itemId: row.itemId,
          txClinicId: row.txClinicId,
          itemClinicId: row.itemClinicId,
        },
      })));

      const memberCardLogs = this.dbService.prepare(`
        SELECT mcl.id, mcl.cardId, mcl.clinicId as logClinicId, mc.clinicId as cardClinicId
        FROM MemberCardLog mcl
        JOIN MemberCard mc ON mcl.cardId = mc.id
        WHERE mc.deletedAt IS NULL
          AND mcl.clinicId <> mc.clinicId
      `).all() as Array<{ id: string; cardId: string; logClinicId: string; cardClinicId: string }>;

      issues.push(...memberCardLogs.map(row => ({
        id: row.id,
        type: 'clinic_id_mismatch_member_card_log',
        description: '会员卡日志的 clinicId 与会员卡不一致',
        details: {
          cardId: row.cardId,
          logClinicId: row.logClinicId,
          cardClinicId: row.cardClinicId,
        },
      })));

      return {
        issues,
        message: issues.length === 0
          ? '所有关联表的 clinicId 均一致'
          : `发现 ${issues.length} 个 clinicId 不一致的记录`,
      };
    });
  }

  private checkOrphanRecords(): CheckResult {
    return this.measureTime('orphan_records', () => {
      const issues: CheckResult['issues'] = [];

      const orphanChargeItems = this.dbService.prepare(`
        SELECT ci.id, ci.chargeId
        FROM ChargeItem ci
        LEFT JOIN Charge c ON ci.chargeId = c.id
        WHERE ci.deletedAt IS NULL AND c.id IS NULL
      `).all() as Array<{ id: string; chargeId: string }>;

      issues.push(...orphanChargeItems.map(row => ({
        id: row.id,
        type: 'orphan_charge_item',
        description: '孤立的收费项目记录（引用不存在的收费单）',
        details: { chargeId: row.chargeId },
      })));

      const orphanInventoryTransactions = this.dbService.prepare(`
        SELECT it.id, it.itemId
        FROM InventoryTransaction it
        LEFT JOIN InventoryItem ii ON it.itemId = ii.id
        WHERE it.deletedAt IS NULL AND ii.id IS NULL
      `).all() as Array<{ id: string; itemId: string }>;

      issues.push(...orphanInventoryTransactions.map(row => ({
        id: row.id,
        type: 'orphan_inventory_transaction',
        description: '孤立的库存流水记录（引用不存在的库存项）',
        details: { itemId: row.itemId },
      })));

      const orphanMemberCardLogs = this.dbService.prepare(`
        SELECT mcl.id, mcl.cardId
        FROM MemberCardLog mcl
        LEFT JOIN MemberCard mc ON mcl.cardId = mc.id
        WHERE mc.id IS NULL
      `).all() as Array<{ id: string; cardId: string }>;

      issues.push(...orphanMemberCardLogs.map(row => ({
        id: row.id,
        type: 'orphan_member_card_log',
        description: '孤立的会员卡日志记录（引用不存在的会员卡）',
        details: { cardId: row.cardId },
      })));

      const orphanAppointments = this.dbService.prepare(`
        SELECT a.id, a.patientId
        FROM Appointment a
        LEFT JOIN Patient p ON a.patientId = p.id
        WHERE a.deletedAt IS NULL AND p.id IS NULL
      `).all() as Array<{ id: string; patientId: string }>;

      issues.push(...orphanAppointments.map(row => ({
        id: row.id,
        type: 'orphan_appointment',
        description: '孤立的预约记录（引用不存在的患者）',
        details: { patientId: row.patientId },
      })));

      return {
        issues,
        message: issues.length === 0
          ? '未发现孤立记录'
          : `发现 ${issues.length} 条孤立记录`,
      };
    });
  }

  private checkSoftDeleteCascade(): CheckResult {
    return this.measureTime('soft_delete_cascade', () => {
      const issues: CheckResult['issues'] = [];

      const deletedChargeActiveItems = this.dbService.prepare(`
        SELECT ci.id, ci.chargeId
        FROM ChargeItem ci
        JOIN Charge c ON ci.chargeId = c.id
        WHERE c.deletedAt IS NOT NULL AND ci.deletedAt IS NULL
      `).all() as Array<{ id: string; chargeId: string }>;

      issues.push(...deletedChargeActiveItems.map(row => ({
        id: row.id,
        type: 'soft_delete_cascade_charge_item',
        description: '收费单已软删除但收费项目未级联删除',
        details: { chargeId: row.chargeId },
      })));

      const deletedCardActiveLogs = this.dbService.prepare(`
        SELECT mcl.id, mcl.cardId
        FROM MemberCardLog mcl
        JOIN MemberCard mc ON mcl.cardId = mc.id
        WHERE mc.deletedAt IS NOT NULL
      `).all() as Array<{ id: string; cardId: string }>;

      issues.push(...deletedCardActiveLogs.map(row => ({
        id: row.id,
        type: 'soft_delete_cascade_member_card_log',
        description: '会员卡已软删除但日志记录仍存在',
        details: { cardId: row.cardId },
      })));

      return {
        issues,
        message: issues.length === 0
          ? '所有软删除级联均正确'
          : `发现 ${issues.length} 个软删除级联问题`,
      };
    });
  }
}
