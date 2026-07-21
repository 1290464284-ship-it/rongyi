// global-setup.ts — runs once before all test suites
// Ensures TESteDB_MEMORY is set so database.ts uses :memory:
export default async function globalSetup() {
  // 强制测试数据库使用内存模式
  process.env.TEST_DB_MEMORY = '1';
  process.env.DB_PATH = ':memory:';
  process.env.DATA_DIR = '';
}
