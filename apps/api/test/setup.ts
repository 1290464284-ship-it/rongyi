// Jest setup — runs before each test suite
// 设置 TEST_DB_MEMORY，确保 better-sqlite3 使用内存数据库
process.env.TEST_DB_MEMORY = '1';
process.env.DB_PATH = ':memory:';

// 设置测试用安全配置（满足 ConfigValidationService 的强度要求）
// JWT_SECRET: 48+ 位且包含字母和数字
process.env.JWT_SECRET ||= 'TestJwtSecret2026ForDentalClinicApp0801abcXYZ';
// ENCRYPTION_KEY: 64 位十六进制字符串
process.env.ENCRYPTION_KEY ||= 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2';

// 直接通过 require 获取模块缓存并设置测试模式
try {
  const dbModule = require('../src/db/database');
  if (dbModule._isTestMode !== undefined) {
    dbModule._isTestMode = true;
  }
  console.log('[Setup] 已启用内存数据库测试模式');
} catch (e: unknown) {
  console.log('[Setup] 预加载数据库模块失败，将在测试运行时自动初始化:', String(e));
}
