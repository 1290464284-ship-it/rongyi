export default {
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  mutate: [
    'src/server/http/pagination.ts',
    'src/server/http/validation.ts',
    'src/server/infrastructure/tenant.ts',
    'src/server/infrastructure/errors.ts',
    'src/server/shared/csv.ts',
    'src/server/shared/html.ts',
    'src/server/application/service-modules/common.ts:36:1-37:40',
    'src/server/application/service-modules/common.ts:69:1-87:3',
    'src/server/application/service-modules/common.ts:116:1-147:3',
    'src/server/application/service-modules/inventory-ledger.ts',
    // 扩面第一步（审计 P1-2）：纳入有强 spec 的服务模块。
    // 算子排除暂维持现状（等价变异比例高），逐步收敛计划见
    // docs/architecture/coverage-exclusions.md。
    'src/server/application/service-modules/triage.ts',
    'src/server/application/service-modules/stocktake.ts',
    'src/server/application/service-modules/refund-flow.ts',
    'src/server/application/service-modules/commission.ts',
    'src/server/application/service-modules/wechat-reminder.ts',
    'src/server/application/service-modules/shift-template.ts',
    // 扩面第二步（2026-08-17）：纳入 keyset 分页工具与批次列表查询（均有独立 spec）。
    'src/server/infrastructure/keyset.ts',
    'src/server/application/service-modules/inventory-batch-list.ts',
  ],
  testFiles: [
    'src/server/http/pagination.property.spec.ts',
    'src/server/http/validation.property.spec.ts',
    'src/server/http/validation.spec.ts',
    'src/server/infrastructure/tenant.spec.ts',
    'src/server/infrastructure/errors.spec.ts',
    'src/server/shared/csv.spec.ts',
    'src/server/shared/html.spec.ts',
    'src/server/application/service-modules/common.spec.ts',
    'src/server/application/service-modules/inventory-ledger.spec.ts',
    'src/server/application/service-modules/triage.spec.ts',
    'src/server/application/service-modules/stocktake.spec.ts',
    'src/server/application/service-modules/refund-flow.spec.ts',
    'src/server/application/service-modules/commission.spec.ts',
    'src/server/application/service-modules/wechat-reminder.spec.ts',
    'src/server/application/service-modules/shift-template.spec.ts',
    'src/server/infrastructure/keyset.spec.ts',
    'src/server/application/service-modules/inventory-batch.spec.ts',
  ],
  reporters: ['clear-text', 'json'],
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  mutator: {
    excludedMutations: [
      'Regex',
      'MethodExpression',
      'StringLiteral',
      'ObjectLiteral',
      'ConditionalExpression',
    ],
  },
  concurrency: 1,
  timeoutMS: 30_000,
  // Ratchet：扩面后实测 77.61 → 81.35 → 84.40 → 88.72 → 90.62 → 93.05 → 95.15
  // （2026-08-13 夜间逐轮击杀）。break 始终低于实测分，防止回归；
  // 剩余幸存以等价变异为主，明细见 docs/architecture/coverage-exclusions.md。
  thresholds: { high: 96, low: 93, break: 90 },
  cleanTempDir: 'always',
};
