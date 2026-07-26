export interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  issues: Array<{
    id: string;
    type: string;
    description: string;
    details?: Record<string, unknown>;
  }>;
  durationMs: number;
}

export interface ConsistencyCheckResult {
  status: 'ok' | 'warning' | 'error';
  timestamp: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  totalIssues: number;
  checks: CheckResult[];
}

export interface CheckDefinition {
  name: string;
  description: string;
  category: string;
  fn: () => CheckResult;
}

export interface ConsistencyChecker {
  readonly name: string;
  getChecks(): CheckDefinition[];
}
