// Jest setup — runs before each test suite
// 设置 TEST_DB_MEMORY，确保 better-sqlite3 使用内存数据库
process.env.TEST_DB_MEMORY = '1';
process.env.DB_PATH = ':memory:';

// 直接通过 require 获取模块缓存并设置测试模式
try {
  const dbModule = require('../src/db/database');
  if (dbModule._isTestMode !== undefined) {
    dbModule._isTestMode = true;
  }
  console.log('[Setup] 已启用内存数据库测试模式');
} catch (e) {
  console.log('[Setup] 预加载数据库模块失败，将在测试运行时自动初始化');
}
