#!/usr/bin/env node
/**
 * SQLite 数据库恢复脚本
 *
 * 功能：
 * 1. 从备份文件恢复数据库
 * 2. 恢复前自动备份当前数据库
 * 3. 恢复后验证数据完整性
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dbPath: 'data/dental.sqlite',
    backupDir: 'backups',
    backupFile: null,
    yes: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--db-path':
        options.dbPath = args[++i];
        break;
      case '--backup-dir':
        options.backupDir = args[++i];
        break;
      case '--backup-file':
        options.backupFile = args[++i];
        break;
      case '--yes':
      case '-y':
        options.yes = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.error(`未知参数: ${args[i]}`);
        options.help = true;
    }
  }

  return options;
}

// 显示帮助信息
function showHelp() {
  console.log(`
SQLite 数据库恢复工具

用法:
  node scripts/backup/restore.js --backup-file <文件名> [选项]

选项:
  --db-path <路径>      数据库文件路径（默认: data/dental.sqlite）
  --backup-dir <路径>    备份目录（默认: backups/）
  --backup-file <文件>   要恢复的备份文件名（必需）
  -y, --yes              跳过确认提示，直接执行恢复
  -h, --help             显示帮助信息

警告:
  - 恢复操作将覆盖当前数据库
  - 恢复前会自动备份当前数据库到 *.bak 文件
  - 请确保在恢复前停止应用服务

示例:
  node scripts/backup/restore.js --backup-file backup-20240101-120000.sqlite
  node scripts/backup/restore.js --backup-file backup-20240101-120000.sqlite.gz -y
  node scripts/backup/restore.js --db-path ./data/app.sqlite --backup-file backup-20240101-120000.sqlite
`);
}

// 格式化字节大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 尝试加载 better-sqlite3
function loadDatabase() {
  try {
    return require('better-sqlite3');
  } catch (err) {
    return null;
  }
}

// 解压 gzip 文件
function decompressGzip(gzipPath, outputPath) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(gzipPath);
    const output = fs.createWriteStream(outputPath);
    const gunzip = zlib.createGunzip();

    input.pipe(gunzip).pipe(output);
    output.on('close', resolve);
    output.on('error', reject);
    input.on('error', reject);
  });
}

// 验证数据库文件
function verifyDatabase(dbPath) {
  const Database = loadDatabase();
  if (!Database) {
    return { valid: fs.existsSync(dbPath), integrityCheck: 'skipped (no better-sqlite3)' };
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    const integrity = db.prepare('PRAGMA integrity_check').all();
    const integrityOk = integrity.every((row) => row.integrity_check === 'ok');
    db.close();
    return {
      valid: integrityOk,
      integrityCheck: integrityOk ? 'ok' : integrity.map((r) => r.integrity_check).join('; '),
    };
  } catch (err) {
    return { valid: false, integrityCheck: 'error', error: err.message };
  }
}

// 确保目录存在
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 主函数
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const dbPath = path.resolve(options.dbPath);
  const backupDir = path.resolve(options.backupDir);

  console.log('='.repeat(60));
  console.log('SQLite 数据库恢复工具');
  console.log('='.repeat(60));
  console.log(`数据库路径: ${dbPath}`);
  console.log(`备份目录: ${backupDir}`);
  console.log('');

  // 检查是否指定了备份文件
  if (!options.backupFile) {
    console.error('错误: 请使用 --backup-file 指定要恢复的备份文件');
    console.log('');
    console.log('使用 --list 或运行以下命令查看可用备份:');
    console.log('  node scripts/backup/verify.js --list');
    process.exit(1);
  }

  // 确定备份文件路径
  let backupFilePath;
  if (path.isAbsolute(options.backupFile)) {
    backupFilePath = options.backupFile;
  } else {
    backupFilePath = path.join(backupDir, options.backupFile);
  }

  // 检查备份文件是否存在
  if (!fs.existsSync(backupFilePath)) {
    console.error(`错误: 备份文件不存在: ${backupFilePath}`);
    process.exit(1);
  }

  const backupStats = fs.statSync(backupFilePath);
  console.log(`备份文件: ${path.basename(backupFilePath)}`);
  console.log(`备份大小: ${formatSize(backupStats.size)}`);
  console.log(`备份时间: ${backupStats.mtime.toLocaleString()}`);
  console.log('');

  // 检查当前数据库是否存在
  const dbExists = fs.existsSync(dbPath);
  if (dbExists) {
    const dbStats = fs.statSync(dbPath);
    console.log(`当前数据库存在，大小: ${formatSize(dbStats.size)}`);
    console.log('');
  }

  // 确认操作
  if (!options.yes) {
    console.log('⚠  警告：恢复操作将覆盖当前数据库！');
    console.log('');
    console.log('恢复前将自动备份当前数据库到:');
    console.log(`  ${dbPath}.restore-bak-${Date.now()}`);
    console.log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question('确认要继续吗？(输入 YES 确认): ', resolve);
    });
    rl.close();

    if (answer !== 'YES') {
      console.log('已取消恢复操作。');
      process.exit(0);
    }
    console.log('');
  }

  try {
    // 1. 备份当前数据库（如果存在）
    let preRestoreBackup = null;
    if (dbExists) {
      console.log('正在备份当前数据库...');
      preRestoreBackup = `${dbPath}.restore-bak-${Date.now()}`;
      fs.copyFileSync(dbPath, preRestoreBackup);

      // 同时复制 wal/shm 文件
      for (const suffix of ['-wal', '-shm']) {
        const srcFile = dbPath + suffix;
        const dstFile = preRestoreBackup + suffix;
        if (fs.existsSync(srcFile)) {
          fs.copyFileSync(srcFile, dstFile);
        }
      }
      console.log(`✓ 当前数据库已备份到: ${path.basename(preRestoreBackup)}`);
      console.log('');
    }

    // 2. 准备恢复文件
    let restoreFile = backupFilePath;
    let tempFile = null;

    // 如果是 gz 压缩文件，先解压
    if (backupFilePath.endsWith('.gz')) {
      console.log('正在解压备份文件...');
      tempFile = backupFilePath + '.restore-tmp-' + Date.now();
      await decompressGzip(backupFilePath, tempFile);
      restoreFile = tempFile;
      console.log('✓ 解压完成');
      console.log('');
    }

    // 3. 验证备份文件
    console.log('正在验证备份文件...');
    const verifyResult = verifyDatabase(restoreFile);
    if (!verifyResult.valid) {
      console.error('✗ 备份文件验证失败:', verifyResult.integrityCheck);
      if (verifyResult.error) {
        console.error('  错误:', verifyResult.error);
      }
      console.log('');

      // 清理临时文件
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          /* ignore */
        }
      }

      process.exit(1);
    }
    console.log(`✓ 备份文件验证通过 (integrity_check: ${verifyResult.integrityCheck})`);
    console.log('');

    // 4. 确保数据库目录存在
    ensureDir(path.dirname(dbPath));

    // 5. 执行恢复
    console.log('正在恢复数据库...');
    fs.copyFileSync(restoreFile, dbPath);

    // 清理旧的 wal/shm 文件
    for (const suffix of ['-wal', '-shm']) {
      const oldFile = dbPath + suffix;
      if (fs.existsSync(oldFile)) {
        try {
          fs.unlinkSync(oldFile);
        } catch {
          /* ignore */
        }
      }
    }

    console.log('✓ 数据库恢复完成');
    console.log('');

    // 6. 验证恢复后的数据库
    console.log('正在验证恢复后的数据库...');
    const postVerifyResult = verifyDatabase(dbPath);
    if (!postVerifyResult.valid) {
      console.error('✗ 恢复后验证失败:', postVerifyResult.integrityCheck);
      console.log('');
      console.log('可以从预恢复备份中回滚:');
      if (preRestoreBackup) {
        console.log(`  ${preRestoreBackup}`);
      }
      process.exit(1);
    }
    console.log(`✓ 恢复验证通过 (integrity_check: ${postVerifyResult.integrityCheck})`);

    // 清理临时文件
    if (tempFile && fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
    }

    // 输出结果
    const restoredStats = fs.statSync(dbPath);
    console.log('');
    console.log('='.repeat(60));
    console.log('恢复成功!');
    console.log('='.repeat(60));
    console.log(`数据库路径: ${dbPath}`);
    console.log(`数据库大小: ${formatSize(restoredStats.size)}`);
    if (preRestoreBackup) {
      console.log(`预恢复备份: ${preRestoreBackup}`);
      console.log('  (如遇问题可从此文件回滚)');
    }
    console.log('');
    console.log('注意: 请启动应用服务并验证数据是否正常。');
    console.log('='.repeat(60));
  } catch (err) {
    console.error('');
    console.error('恢复失败:', err.message);
    console.error('');
    console.error('数据库可能处于不一致状态。');
    console.error('如有预恢复备份，可手动回滚。');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('执行出错:', err.message);
  process.exit(1);
});
