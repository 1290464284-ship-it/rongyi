import { CheckResult } from './consistency-checker.interface';

export abstract class BaseConsistencyChecker {
  protected measureTime(
    name: string,
    fn: () => { issues: CheckResult['issues']; message: string },
  ): CheckResult {
    const startTime = Date.now();
    const { issues, message } = fn();
    const durationMs = Date.now() - startTime;
    const status: 'ok' | 'warning' | 'error' = issues.length === 0 ? 'ok' : 'error';

    return {
      name,
      status,
      message,
      issues,
      durationMs,
    };
  }
}
