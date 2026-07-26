/**
 * 数据恢复测试工具
 * 用于验证备份文件的完整性和可恢复性
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';

export interface RestoreTestResult {
  success: boolean;
  backupPath: string;
  tableCount: number;
  tables: Array<{ name: string; readable: boolean; valid: boolean }>;
  integrityCheck: boolean;
  error?: string;
}

/**
 * 验证备份文件的完整性和可恢复性
 */
export function testBackupRestore(backupPath: string): RestoreTestResult {
  if (!fs.existsSync(backupPath)) {
    return {
      success: false,
      backupPath,
      tableCount: 0,
      tables: [],
      integrityCheck: false,
      error: '备份文件不存在',
    };
  }

  let testDb: Database.Database | null = null;
  try {
    testDb = new Database(backupPath, { readonly: true });

    // 1. 完整性检查
    const integrity = testDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    const integrityOk = integrity.every(row => row.integrity_check === 'ok');

    if (!integrityOk) {
      return {
        success: false,
        backupPath,
        tableCount: 0,
        tables: [],
        integrityCheck: false,
        error: `完整性检查失败: ${integrity.map(r => r.integrity_check).join(', ')}`,
      };
    }

    // 2. 获取所有表
    const tables = testDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as Array<{ name: string }>;

    const tableResults: Array<{ name: string; readable: boolean; valid: boolean }> = [];

    // P3-5: 用 SELECT 1 LIMIT 1 替代 COUNT(*) 避免全表扫描，仅检查表可读性
    for (const { name } of tables) {
      try {
        testDb.prepare(`SELECT 1 FROM "${name}" LIMIT 1`).get();
        tableResults.push({ name, readable: true, valid: true });
      } catch {
        tableResults.push({ name, readable: false, valid: false });
      }
    }

    // 3. 关键表存在性检查
    const requiredTables = ['User', 'Patient', 'Charge', 'MedicalRecord', 'Appointment'];
    const missingTables = requiredTables.filter(
      t => !tableResults.some(r => r.name === t)
    );

    const success = integrityOk && missingTables.length === 0;

    return {
      success,
      backupPath,
      tableCount: tables.length,
      tables: tableResults,
      integrityCheck: integrityOk,
      error: missingTables.length > 0 ? `缺少关键表: ${missingTables.join(', ')}` : undefined,
    };
  } catch (err: unknown) {
    return {
      success: false,
      backupPath,
      tableCount: 0,
      tables: [],
      integrityCheck: false,
      error: (err as Error).message,
    };
  } finally {
    if (testDb) {
      try { testDb.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * 扫描备份目录，验证所有备份文件
 */
export function validateAllBackups(backupDir: string): Array<RestoreTestResult> {
  if (!fs.existsSync(backupDir)) {
    return [];
  }

  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.sqlite'))
    .map(f => path.join(backupDir, f));

  return files.map(testBackupRestore);
}
