import { Injectable } from '@nestjs/common';
import { AppLogger } from '../../../common/services/logger.service';
import { BusinessNotFoundException } from '../../../common/errors';
import { ChargeConsistencyChecker } from './charge-consistency-checker';
import { MemberCardConsistencyChecker } from './member-card-consistency-checker';
import { InventoryConsistencyChecker } from './inventory-consistency-checker';
import { ForeignKeyConsistencyChecker } from './foreign-key-consistency-checker';
import { BusinessRuleConsistencyChecker } from './business-rule-consistency-checker';
import {
  CheckResult,
  ConsistencyCheckResult,
  CheckDefinition,
} from './consistency-checker.interface';

export { CheckResult, ConsistencyCheckResult };

@Injectable()
export class DatabaseConsistencyService {
  private readonly logger = new AppLogger(DatabaseConsistencyService.name);

  private checks: CheckDefinition[] = [];

  constructor(
    private chargeChecker: ChargeConsistencyChecker,
    private memberCardChecker: MemberCardConsistencyChecker,
    private inventoryChecker: InventoryConsistencyChecker,
    private foreignKeyChecker: ForeignKeyConsistencyChecker,
    private businessRuleChecker: BusinessRuleConsistencyChecker,
  ) {
    this.registerChecks();
  }

  private registerChecks(): void {
    this.checks = [
      ...this.chargeChecker.getChecks(),
      ...this.memberCardChecker.getChecks(),
      ...this.inventoryChecker.getChecks(),
      ...this.foreignKeyChecker.getChecks(),
      ...this.businessRuleChecker.getChecks(),
    ];
  }

  getAvailableChecks(): string[] {
    return this.checks.map(c => c.name);
  }

  async runAllChecks(): Promise<ConsistencyCheckResult> {
    const _startTime = Date.now();
    const results: CheckResult[] = [];

    for (const check of this.checks) {
      try {
        const result = check.fn();
        results.push(result);
      } catch (err: unknown) {
        this.logger.error(`检查 ${check.name} 执行失败`, err instanceof Error ? err : String(err));
        results.push({
          name: check.name,
          status: 'error',
          message: `检查执行失败: ${err instanceof Error ? err.message : String(err)}`,
          issues: [],
          durationMs: 0,
        });
      }
    }

    const passedChecks = results.filter(r => r.status === 'ok').length;
    const failedChecks = results.filter(r => r.status !== 'ok').length;
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
    const hasError = results.some(r => r.status === 'error');
    const hasWarning = results.some(r => r.status === 'warning');
    const overallStatus: 'ok' | 'warning' | 'error' = hasError ? 'error' : hasWarning ? 'warning' : 'ok';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      totalChecks: this.checks.length,
      passedChecks,
      failedChecks,
      totalIssues,
      checks: results,
    };
  }

  async runCheck(checkName: string): Promise<CheckResult> {
    const check = this.checks.find(c => c.name === checkName);
    if (!check) {
      // P3 修复：原先 throw new Error 返回 HTTP 500，改为 BusinessNotFoundException 返回 HTTP 404
      throw new BusinessNotFoundException(`未找到检查项: ${checkName}`);
    }
    try {
      return check.fn();
    } catch (err: unknown) {
      this.logger.error(`检查 ${checkName} 执行失败`, err instanceof Error ? err : String(err));
      return {
        name: checkName,
        status: 'error',
        message: `检查执行失败: ${err instanceof Error ? err.message : String(err)}`,
        issues: [],
        durationMs: 0,
      };
    }
  }
}
