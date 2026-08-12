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
  // This is a pilot gate. Do not let a low mutation score break CI until the
  // property-based suites are broadened to the rest of the resource validators.
  thresholds: { high: 80, low: 60, break: null },
  cleanTempDir: 'always',
};
