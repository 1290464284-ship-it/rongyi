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
  ],
  testFiles: [
    'src/server/http/pagination.property.spec.ts',
    'src/server/http/validation.property.spec.ts',
    'src/server/infrastructure/tenant.spec.ts',
    'src/server/infrastructure/errors.spec.ts',
    'src/server/shared/csv.spec.ts',
    'src/server/shared/html.spec.ts',
    'src/server/application/service-modules/common.spec.ts',
  ],
  reporters: ['clear-text', 'json'],
  coverageAnalysis: 'off',
  concurrency: 1,
  timeoutMS: 30_000,
  // Ratchet from the measured pilot score. Keep this above the current score
  // to prevent silently regressing the property-based verification strength.
  thresholds: { high: 72, low: 60, break: 59 },
  cleanTempDir: 'always',
};
