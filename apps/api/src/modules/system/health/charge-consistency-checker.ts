import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseConsistencyChecker } from './base-consistency-checker';
import { CheckDefinition, ConsistencyChecker, CheckResult } from './consistency-checker.interface';

@Injectable()
export class ChargeConsistencyChecker extends BaseConsistencyChecker implements ConsistencyChecker {
  readonly name = 'charge';

  constructor(private dbService: DbService) {
    super();
  }

  getChecks(): CheckDefinition[] {
    return [
      {
        name: 'charge_total_amount',
        description: '收费单总金额与项目金额之和一致性检查',
        category: 'amount',
        fn: () => this.checkChargeTotalAmount(),
      },
      {
        name: 'charge_paid_amount',
        description: '收费单已付金额与支付记录之和一致性检查',
        category: 'amount',
        fn: () => this.checkChargePaidAmount(),
      },
      {
        name: 'charge_status_payment',
        description: '收费单状态与支付金额匹配检查',
        category: 'business_rule',
        fn: () => this.checkChargeStatusPayment(),
      },
    ];
  }

  private checkChargeTotalAmount(): CheckResult {
    return this.measureTime('charge_total_amount', () => {
      const rows = this.dbService.prepare(`
        SELECT c.id, c.number, c.totalAmount, COALESCE(SUM(ci.subtotal), 0) as itemsTotal
        FROM Charge c
        LEFT JOIN ChargeItem ci ON c.id = ci.chargeId AND ci.deletedAt IS NULL
        WHERE c.deletedAt IS NULL
        GROUP BY c.id
        HAVING c.totalAmount <> itemsTotal
      `).all() as Array<{ id: string; number: string; totalAmount: number; itemsTotal: number }>;

      const issues = rows.map(row => ({
        id: row.id,
        type: 'charge_total_amount_mismatch',
        description: `收费单 ${row.number} 总金额不一致`,
        details: {
          chargeNumber: row.number,
          totalAmount: row.totalAmount,
          itemsTotal: row.itemsTotal,
          diff: row.totalAmount - row.itemsTotal,
        },
      }));

      return {
        issues,
        message: issues.length === 0
          ? '所有收费单总金额与项目金额一致'
          : `发现 ${issues.length} 个收费单总金额不一致`,
      };
    });
  }

  private checkChargePaidAmount(): CheckResult {
    return this.measureTime('charge_paid_amount', () => {
      const rows = this.dbService.prepare(`
        SELECT c.id, c.number, c.paidAmount,
               COALESCE(SUM(CASE WHEN mcl.type = 'RECHARGE' THEN mcl.amount
                                 WHEN mcl.type = 'CONSUME' THEN -mcl.amount
                                 WHEN mcl.type = 'REFUND' THEN -mcl.amount
                                 ELSE 0 END), 0) as cardPayAmount
        FROM Charge c
        LEFT JOIN MemberCardLog mcl ON c.id = mcl.chargeId
        WHERE c.deletedAt IS NULL
        GROUP BY c.id
      `).all() as Array<{ id: string; number: string; paidAmount: number; cardPayAmount: number }>;

      const issues: CheckResult['issues'] = [];

      for (const row of rows) {
        if (row.paidAmount !== 0 && row.cardPayAmount !== row.paidAmount) {
          issues.push({
            id: row.id,
            type: 'charge_paid_amount_mismatch',
            description: `收费单 ${row.number} 已付金额与支付记录不一致`,
            details: {
              chargeNumber: row.number,
              paidAmount: row.paidAmount,
              cardPayAmount: row.cardPayAmount,
              diff: row.paidAmount - row.cardPayAmount,
            },
          });
        }
      }

      return {
        issues,
        message: issues.length === 0
          ? '所有收费单已付金额与支付记录一致'
          : `发现 ${issues.length} 个收费单已付金额不一致`,
      };
    });
  }

  private checkChargeStatusPayment(): CheckResult {
    return this.measureTime('charge_status_payment', () => {
      const issues: CheckResult['issues'] = [];

      const paidButNotFull = this.dbService.prepare(`
        SELECT id, number, status, totalAmount, paidAmount, refundedAmount
        FROM Charge
        WHERE deletedAt IS NULL
          AND status = 'PAID'
          AND (paidAmount - refundedAmount) <> totalAmount
      `).all() as Array<{ id: string; number: string; status: string; totalAmount: number; paidAmount: number; refundedAmount: number }>;

      issues.push(...paidButNotFull.map(row => ({
        id: row.id,
        type: 'charge_status_paid_mismatch',
        description: `收费单 ${row.number} 状态为 PAID 但金额不匹配`,
        details: {
          number: row.number,
          status: row.status,
          totalAmount: row.totalAmount,
          paidAmount: row.paidAmount,
          refundedAmount: row.refundedAmount,
          netPaid: row.paidAmount - row.refundedAmount,
        },
      })));

      const fullButNotPaid = this.dbService.prepare(`
        SELECT id, number, status, totalAmount, paidAmount, refundedAmount
        FROM Charge
        WHERE deletedAt IS NULL
          AND status NOT IN ('PAID', 'REFUNDED', 'CANCELLED')
          AND paidAmount > 0
          AND (paidAmount - refundedAmount) >= totalAmount
      `).all() as Array<{ id: string; number: string; status: string; totalAmount: number; paidAmount: number; refundedAmount: number }>;

      issues.push(...fullButNotPaid.map(row => ({
        id: row.id,
        type: 'charge_full_payment_not_paid_status',
        description: `收费单 ${row.number} 已全额支付但状态不是 PAID`,
        details: {
          number: row.number,
          status: row.status,
          totalAmount: row.totalAmount,
          paidAmount: row.paidAmount,
          refundedAmount: row.refundedAmount,
          netPaid: row.paidAmount - row.refundedAmount,
        },
      })));

      return {
        issues,
        message: issues.length === 0
          ? '所有收费单状态与支付金额匹配'
          : `发现 ${issues.length} 个收费单状态与支付金额不匹配`,
      };
    });
  }
}
