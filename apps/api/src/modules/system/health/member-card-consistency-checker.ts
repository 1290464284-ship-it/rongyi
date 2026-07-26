import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { BaseConsistencyChecker } from './base-consistency-checker';
import { CheckDefinition, ConsistencyChecker, CheckResult } from './consistency-checker.interface';

@Injectable()
export class MemberCardConsistencyChecker extends BaseConsistencyChecker implements ConsistencyChecker {
  readonly name = 'member-card';

  constructor(private dbService: DbService) {
    super();
  }

  getChecks(): CheckDefinition[] {
    return [
      {
        name: 'member_card_balance',
        description: '会员卡余额与充值消费记录一致性检查',
        category: 'amount',
        fn: () => this.checkMemberCardBalance(),
      },
    ];
  }

  private checkMemberCardBalance(): CheckResult {
    return this.measureTime('member_card_balance', () => {
      const rows = this.dbService.prepare(`
        SELECT mc.id, mc.cardNo, mc.balance, mc.totalRecharge, mc.totalConsume,
               COALESCE(SUM(CASE WHEN mcl.type = 'RECHARGE' THEN mcl.amount
                                 WHEN mcl.type = 'CONSUME' THEN -mcl.amount
                                 WHEN mcl.type = 'REFUND' THEN mcl.amount
                                 ELSE 0 END), 0) as calculatedBalance,
               COALESCE(SUM(CASE WHEN mcl.type = 'RECHARGE' THEN mcl.amount ELSE 0 END), 0) as calculatedRecharge,
               COALESCE(SUM(CASE WHEN mcl.type = 'CONSUME' THEN mcl.amount ELSE 0 END), 0) as calculatedConsume
        FROM MemberCard mc
        LEFT JOIN MemberCardLog mcl ON mc.id = mcl.cardId
        WHERE mc.deletedAt IS NULL
        GROUP BY mc.id
        HAVING mc.balance <> calculatedBalance
            OR mc.totalRecharge <> calculatedRecharge
            OR mc.totalConsume <> calculatedConsume
      `).all() as Array<{
        id: string;
        cardNo: string;
        balance: number;
        totalRecharge: number;
        totalConsume: number;
        calculatedBalance: number;
        calculatedRecharge: number;
        calculatedConsume: number;
      }>;

      const issues = rows.map(row => ({
        id: row.id,
        type: 'member_card_balance_mismatch',
        description: `会员卡 ${row.cardNo} 余额不一致`,
        details: {
          cardNo: row.cardNo,
          balance: row.balance,
          calculatedBalance: row.calculatedBalance,
          balanceDiff: row.balance - row.calculatedBalance,
          totalRecharge: row.totalRecharge,
          calculatedRecharge: row.calculatedRecharge,
          totalConsume: row.totalConsume,
          calculatedConsume: row.calculatedConsume,
        },
      }));

      return {
        issues,
        message: issues.length === 0
          ? '所有会员卡余额与交易记录一致'
          : `发现 ${issues.length} 张会员卡余额不一致`,
      };
    });
  }
}
