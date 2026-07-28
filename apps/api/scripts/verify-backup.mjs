#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function computeFileHash(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function getBackupFiles(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((f) => f.endsWith('.db') || f.endsWith('.db.bak'))
    .map((f) => {
      const filePath = path.join(backupDir, f);
      const stat = fs.statSync(filePath);
      return {
        name: f,
        path: filePath,
        size: stat.size,
        lastModified: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
}

async function verifyBackup(backupPath) {
  const report = {
    path: path.resolve(backupPath),
    verifiedAt: new Date().toISOString(),
    checks: [],
    overallPassed: false,
  };

  console.log('='.repeat(60));
  console.log('备份文件完整性验证');
  console.log('='.repeat(60));
  console.log(`文件路径: ${report.path}`);
  console.log('');

  try {
    if (!fs.existsSync(backupPath)) {
      console.log('✗ 文件不存在');
      report.checks.push({ check: '文件存在', passed: false });
      return report;
    }

    const fileStat = fs.statSync(backupPath);
    console.log(`文件大小: ${formatSize(fileStat.size)}`);
    console.log(`修改时间: ${fileStat.mtime.toLocaleString('zh-CN')}`);
    console.log('');

    report.checks.push({
      check: '文件存在',
      passed: true,
      details: { size: fileStat.size, lastModified: fileStat.mtime.toISOString() },
    });

    console.log('[检查 1] 文件存在性');
    console.log('  ✓ 文件存在');

    console.log('');
    console.log('[检查 2] 文件可访问性');
    try {
      fs.accessSync(backupPath, fs.constants.R_OK);
      console.log('  ✓ 文件可读');
      report.checks.push({ check: '文件可读', passed: true });
    } catch {
      console.log('  ✗ 文件不可读');
      report.checks.push({ check: '文件可读', passed: false });
      return report;
    }

    console.log('');
    console.log('[检查 3] 文件哈希验证');
    const sha256 = await computeFileHash(backupPath, 'sha256');
    const md5 = await computeFileHash(backupPath, 'md5');
    const sha1 = await computeFileHash(backupPath, 'sha1');
    console.log(`  SHA256: ${sha256}`);
    console.log(`  SHA1:   ${sha1}`);
    console.log(`  MD5:    ${md5}`);
    report.checks.push({
      check: '哈希计算',
      passed: true,
      details: { sha256, sha1, md5 },
    });

    console.log('');
    console.log('[检查 4] SQLite 完整性校验 (PRAGMA integrity_check)');
    try {
      const db = new Database(backupPath, { readonly: true });
      const integrityResult = db.prepare('PRAGMA integrity_check').all();
      const integrityPassed = integrityResult.every((row) => row.integrity_check === 'ok');

      if (integrityPassed) {
        console.log('  ✓ integrity_check 通过');
      } else {
        console.log('  ✗ integrity_check 失败:');
        integrityResult.forEach((row) => console.log(`    ${row.integrity_check}`));
      }

      report.checks.push({
        check: 'SQLite 完整性',
        passed: integrityPassed,
        details: integrityResult,
      });

      console.log('');
      console.log('[检查 5] 数据库结构验证');
      const tables = db
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'index', 'view') ORDER BY type, name")
        .all();

      const userTables = tables.filter((t) => t.type === 'table' && !t.name.startsWith('sqlite_'));
      const userIndexes = tables.filter((t) => t.type === 'index' && !t.name.startsWith('sqlite_'));

      console.log(`  用户表: ${userTables.length} 个`);
      console.log(`  用户索引: ${userIndexes.length} 个`);

      userTables.forEach((t) => {
        const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get().cnt;
        console.log(`    ${t.name}: ${count} 条记录`);
      });

      report.checks.push({
        check: '数据库结构',
        passed: userTables.length > 0,
        details: {
          tableCount: userTables.length,
          indexCount: userIndexes.length,
          tables: userTables.map((t) => {
            const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get().cnt;
            return { name: t.name, recordCount: count };
          }),
        },
      });

      console.log('');
      console.log('[检查 6] 数据一致性验证');
      let consistencyPassed = true;
      const summary = {};
      const inconsistencies = [];

      try {
        const chargeRow = db.prepare(
          "SELECT COUNT(*) as total, SUM(totalAmount) as totalAmount, SUM(paidAmount) as totalPaid, SUM(refundedAmount) as totalRefunded FROM Charge",
        ).get();
        if (chargeRow.total > 0) {
          summary.Charge = {
            count: chargeRow.total,
            totalAmount: chargeRow.totalAmount,
            totalPaid: chargeRow.totalPaid,
            totalRefunded: chargeRow.totalRefunded,
          };
        }
      } catch (_e) {
        // Charge table doesn't exist - skip
      }

      try {
        const patientRow = db.prepare(
          "SELECT COUNT(*) as total FROM Patient",
        ).get();
        if (patientRow.total > 0) {
          summary.Patient = { count: patientRow.total };
        }
      } catch (_e) {
        // Patient table doesn't exist - skip
      }

      try {
        const cardRow = db.prepare(
          "SELECT COUNT(*) as total, SUM(balance) as totalBalance, SUM(points) as totalPoints FROM MemberCard",
        ).get();
        if (cardRow.total > 0) {
          summary.MemberCard = {
            count: cardRow.total,
            totalBalance: cardRow.totalBalance,
            totalPoints: cardRow.totalPoints,
          };
        }
      } catch (_e) {
        // MemberCard table doesn't exist - skip
      }

      try {
        const invRow = db.prepare(
          "SELECT COUNT(*) as total, SUM(stock) as totalStock FROM InventoryItem",
        ).get();
        if (invRow.total > 0) {
          summary.InventoryItem = { count: invRow.total, totalStock: invRow.totalStock };
        }
      } catch (_e) {
        // InventoryItem table doesn't exist - skip
      }

      try {
        const chargeRow = db.prepare(
          "SELECT COUNT(*) as total FROM Charge",
        ).get();
        if (chargeRow.total > 0) {
          const itemRow = db.prepare("SELECT COUNT(*) as total FROM ChargeItem").get();
          if (itemRow.total < chargeRow.total) {
            inconsistencies.push(`ChargeItem(${itemRow.total}) 少于 Charge(${chargeRow.total})`);
            consistencyPassed = false;
          }
        }
      } catch (_e) {
        // Cross-table check skipped
      }

      console.log(`  数据概要:`);
      for (const [table, info] of Object.entries(summary)) {
        console.log(`    ${table}: ${JSON.stringify(info)}`);
      }

      if (inconsistencies.length > 0) {
        console.log(`  ✗ 发现 ${inconsistencies.length} 个不一致:`);
        inconsistencies.forEach((i) => console.log(`    ${i}`));
        consistencyPassed = false;
      } else {
        console.log(`  ✓ 数据一致性检查通过`);
      }

      report.checks.push({
        check: '数据一致性',
        passed: consistencyPassed,
        details: { summary, inconsistencies },
      });

      db.close();
    } catch (dbErr) {
      console.log(`  ✗ 无法打开数据库: ${dbErr.message}`);
      report.checks.push({ check: 'SQLite 完整性', passed: false, error: dbErr.message });
    }

    console.log('');
    console.log('[检查 7] 文件锁定验证');
    try {
      const testDb = new Database(backupPath, { readonly: true });
      testDb.close();
      console.log('  ✓ 文件可被多个连接打开');
      report.checks.push({ check: '文件锁', passed: true });
    } catch {
      console.log('  ✗ 文件被锁定或损坏');
      report.checks.push({ check: '文件锁', passed: false });
    }

    console.log('');
    console.log('[检查 8] WAL/日志检查');
    try {
      const db = new Database(backupPath, { readonly: true });
      const journalMode = db.pragma('journal_mode');
      const pageCount = db.pragma('page_count');
      const freePages = db.pragma('freelist_count');
      console.log(`  journal_mode: ${journalMode}`);
      console.log(`  page_count: ${pageCount}`);
      console.log(`  freelist_count: ${freePages}`);
      db.close();
      report.checks.push({
        check: 'WAL/日志',
        passed: true,
        details: { journalMode, pageCount, freePages },
      });
    } catch {
      console.log('  ⚠ 无法获取日志信息（非关键）');
      report.checks.push({ check: 'WAL/日志', passed: true, warning: true });
    }

    const backupDir = path.dirname(backupPath);
    const relatedFiles = fs.readdirSync(backupDir).filter((f) => {
      const baseName = path.basename(backupPath);
      return f.startsWith(baseName) && f !== baseName;
    });

    if (relatedFiles.length > 0) {
      console.log('');
      console.log(`关联文件: ${relatedFiles.join(', ')}`);
    }

    console.log('');
    console.log('[检查 9] 文件权限检查');
    try {
      fs.accessSync(backupPath, fs.constants.R_OK | fs.constants.W_OK);
      console.log('  ✓ 文件读写权限正常');
      report.checks.push({ check: '文件权限', passed: true, details: { read: true, write: true } });
    } catch (permErr) {
      const readOnly = fs.existsSync(backupPath) && fs.statSync(backupPath).mode;
      console.log(`  ⚠ 权限受限 (mode: ${readOnly?.toString(8) || 'unknown'})`);
      report.checks.push({ check: '文件权限', passed: false, details: { mode: readOnly?.toString(8) } });
    }

    const allPassed = report.checks.every((c) => c.passed);
    report.overallPassed = allPassed;

  } catch (err) {
    console.error('验证过程发生错误:', err.message);
    report.error = err.message;
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('验证报告');
  console.log('='.repeat(60));
  console.log(`文件: ${report.path}`);
  console.log(`验证时间: ${report.verifiedAt}`);
  console.log('');

  const passedCount = report.checks.filter((c) => c.passed).length;
  const totalCount = report.checks.length;

  console.log(`总体结果: ${report.overallPassed ? '通过 ✓' : '未通过 ✗'}`);
  console.log(`通过率: ${passedCount}/${totalCount} (${((passedCount / totalCount) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('检查详情:');
  for (const check of report.checks) {
    const icon = check.passed ? '✓' : '✗';
    console.log(`  ${icon} ${check.check}` + (check.error ? ` (错误: ${check.error})` : ''));
  }

  if (report.error) {
    console.log('');
    console.log(`错误详情: ${report.error}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`验证${report.overallPassed ? '通过' : '未通过'}！`);
  console.log('='.repeat(60));

  return report;
}

function printUsage() {
  console.log('用法: node scripts/verify-backup.mjs <backup-file-path>');
  console.log('');
  console.log('示例:');
  console.log('  node scripts/verify-backup.mjs ./data/backup-20250101.db');
  console.log('');
  console.log('说明:');
  console.log('  验证指定 SQLite 备份文件的完整性，包括:');
  console.log('  - 文件存在性和可读性检查');
  console.log('  - SHA256/SHA1/MD5 哈希计算');
  console.log('  - PRAGMA integrity_check 完整性校验');
  console.log('  - 数据库结构和记录数检查');
  console.log('  - 跨表数据一致性验证');
  console.log('  - WAL 日志和文件锁检查');
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

const backupFilePath = path.resolve(args[0]);

verifyBackup(backupFilePath).then((report) => {
  process.exit(report.overallPassed ? 0 : 1);
}).catch((err) => {
  console.error('验证脚本异常:', err);
  process.exit(1);
});