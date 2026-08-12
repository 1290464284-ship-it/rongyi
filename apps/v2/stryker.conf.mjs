export default {
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  mutate: ['src/server/http/pagination.ts', 'src/server/http/validation.ts'],
  testFiles: [
    'src/server/http/pagination.property.spec.ts',
    'src/server/http/validation.property.spec.ts',
  ],
  reporters: ['clear-text'],
  coverageAnalysis: 'off',
  concurrency: 1,
  timeoutMS: 30_000,
  // Ratchet from the measured pilot score. Keep this above the current score
  // to prevent silently regressing the property-based verification strength.
  thresholds: { high: 60, low: 40, break: 35 },
  cleanTempDir: 'always',
};
