/** @type {import('jest').Config} */
module.exports = {
  ...require('./jest.preset'),
  rootDir: '.',
  testMatch: ['<rootDir>/test/smoke/**/*.smoke.spec.ts'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@db/(.*)$': '<rootDir>/src/db/$1',
    '^@shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@dental/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^sanitize-html$': '<rootDir>/test/__mocks__/sanitize-html.ts',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/dist/'],
  verbose: true,
  maxWorkers: 1,
  testTimeout: 30000,
};
