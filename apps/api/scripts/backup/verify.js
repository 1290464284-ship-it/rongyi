#!/usr/bin/env node
/**
 * SQLite 备份验证脚本
 *
 * 功能：
 * 1. 验证备份文件完整性
 * 2. 列出所有备份
 * 3. 支持 text/json 输出格式
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    backupDir: 'backups',
    backupFile: null,
    list: false,
    output: 'text',
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--backup-dir':
        options.backupDir = args[++i];
        break;
      case '--backup-file':
        options.backupFile = args[++i];
        break;
      case '--list':
        options.list = true;
        break;
      case '--output':
        options.output = args[++i];
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
SQLite 备份验证工具

用法:
  node scripts/backup/verify.js [选项]

选项:
  --backup-dir <路径>   备份目录（默认: backups/）
  --backup-file <文件>  指定单个备份文件进行验证
  --list                列出所有备份
  --output <格式>       输出格式: text / json（默认: text）
  -h, --help            显示帮助信息

示例:
  node scripts/backup/verify.js --list
  node scripts/backup/verify.js --backup-file backup-20240101-120000.sqlite
  node scripts/backup/verify.js --list --output json
  node scripts/backup/verify.js --backup-dir ./my-backups --list
`);
}

// 格式化字节大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 格式化日期时间
function formatDateTime(isoString) {
  const date = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds())
  );
}

// 尝试加载 better-sqlite3
function loadDatabase() {
  try {
    return require('better-sqlite3');
  } catch (err) {
    return null;
  }
}

// 解压 gzip 文件到临时文件
function decompressGzip(gzipPath, tempPath) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(gzipPath);
    const output = fs.createWriteStream(tempPath);
    const gunzip = zlib.createGunzip();

    input.pipe(gunzip).pipe(output);
    output.on('close', resolve);
    output.on('error', reject);
    input.on('error', reject);
  });
}

// 验证单个备份文件
async function verifyBackupFile(filePath) {
  const result = {
    file: path.basename(filePath),
    path: filePath,
    valid: false,
    exists: false,
    sizeBytes: 0,
    integrityCheck: 'unknown',
    tables: 0,
    tableList: [],
    totalRecords: 0,
    error: null,
  };

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    result.error = '文件不存在';
    return result;
  }

  result.exists = true;
  const stats = fs.statSync(filePath);
  result.sizeBytes = stats.size;

  const Database = loadDatabase();
  if (!Database) {
    result.valid = stats.size > 0;
    result.integrityCheck = 'skipped (no better-sqlite3)';
    return result;
  }

  let tempFile = null;
  let dbPath = filePath;

  try {
    // 如果是 gz 压缩文件，先解压
    if (filePath.endsWith('.gz')) {
      tempFile = filePath + '.verify-tmp-' + Date.now();
      await decompressGzip(filePath, tempFile);
      dbPath = tempFile;
    }

    const db = new Database(dbPath, { readonly: true });

    try {
      // 完整性检查
      const integrity = db.prepare('PRAGMA integrity_check').all();
      const integrityOk = integrity.every((row) => row.integrity_check === 'ok');
      result.integrityCheck = integrityOk ? 'ok' : integrity.map((r) => r.integrity_check).join('; ');

      // 获取所有用户表
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all();
      result.tables = tables.length;
      result.tableList = tables.map((t) => t.name);

      // 统计总记录数
      let totalRecords = 0;
      for (const table of tables) {
        try {
          const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${table.name}"`).get();
          totalRecords += count.cnt;
        } catch {
          // 忽略单个表的统计错误
        }
      }
      result.totalRecords = totalRecords;

      // 关键表检查
      const requiredTables = ['User', 'Patient', 'Charge', 'Appointment'];
      const missingTables = requiredTables.filter((t) => !result.tableList.includes(t));
      if (missingTables.length > 0) {
        result.valid = false;
        result.error = `缺少关键表: ${missingTables.join(', ')}`;
      } else {
        result.valid = integrityOk;
      }
    } finally {
      db.close();
    }
  } catch (err) {
    result.error = err.message;
  } finally {
    // 清理临时文件
    if (tempFile && fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
    }
  }

  return result;
}

// 读取备份元数据
function readMetaFile(metaFilePath) {
  if (!fs.existsSync(metaFilePath)) {
    return { backups: [] };
  }
  try {
    const content = fs.readFileSync(metaFilePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    return { backups: [] };
  }
}

// 获取备份文件列表
function getBackupFiles(backupDir) {
  if (!fs.existsSync(backupDir)) {
    return [];
  }

  return fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('backup-') && (f.endsWith('.sqlite') || f.endsWith('.sqlite.gz')))
    .map((f) => {
      const fullPath = path.join(backupDir, f);
      const stats = fs.statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        size: stats.size,
        mtime: stats.mtime,
        mtimeMs: stats.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// 列出所有备份
async function listBackups(backupDir, outputFormat) {
  const backupDirResolved = path.resolve(backupDir);
  const metaFilePath = path.join(backupDirResolved, 'backup-meta.json');
  const meta = readMetaFile(metaFilePath);
  const backupFiles = getBackupFiles(backupDirResolved);

  const backups = backupFiles.map((file) => {
    const metaInfo = meta.backups.find((b) => b.filename === file.name);
    return {
      filename: file.name,
      sizeBytes: file.size,
      sizeFormatted: formatSize(file.size),
      modifiedAt: file.mtime.toISOString(),
      modifiedAtFormatted: formatDateTime(file.mtime.toISOString()),
      tables: metaInfo ? metaInfo.tables : null,
      totalRecords: metaInfo ? metaInfo.totalRecords : null,
      integrityCheck: metaInfo ? metaInfo.integrityCheck : null,
      compressed: file.name.endsWith('.gz'),
      durationMs: metaInfo ? metaInfo.durationMs : null,
    };
  });

  if (outputFormat === 'json') {
    console.log(JSON.stringify({ total: backups.length, backups }, null, 2));
    return;
  }

  // Text 输出
  console.log('='.repeat(80));
  console.log('备份文件列表');
  console.log('='.repeat(80));
  console.log(`备份目录: ${backupDirResolved}`);
  console.log(`备份数量: ${backups.length}`);
  console.log('');

  if (backups.length === 0) {
    console.log('(暂无备份文件)');
    console.log('='.repeat(80));
    return;
  }

  // 表头
  console.log(
    '序号  ' +
      '文件名'.padEnd(40) +
      '  ' +
      '大小'.padEnd(12) +
      '  ' +
      '时间'.padEnd(19) +
      '  ' +
      '状态'
  );
  console.log('-'.repeat(80));

  backups.forEach((backup, index) => {
    const status = backup.integrityCheck === 'ok' ? '✓ 有效' : backup.integrityCheck ? '⚠ 未知' : '? 未验证';
    const num = String(index + 1).padStart(2, ' ');
    console.log(
      `${num}   ${backup.filename.padEnd(40)}  ${backup.sizeFormatted.padEnd(12)}  ${backup.modifiedAtFormatted.padEnd(19)}  ${status}`
    );
  });

  console.log('='.repeat(80));
}

// 主函数
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // --list 模式
  if (options.list) {
    await listBackups(options.backupDir, options.output);
    return;
  }

  // 验证单个文件模式
  if (options.backupFile) {
    const backupDir = path.resolve(options.backupDir);
    let backupPath;

    // 如果是完整路径，直接使用
    if (path.isAbsolute(options.backupFile)) {
      backupPath = options.backupFile;
    } else {
      backupPath = path.join(backupDir, options.backupFile);
    }

    const result = await verifyBackupFile(backupPath);

    if (options.output === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('='.repeat(60));
      console.log('备份验证结果');
      console.log('='.repeat(60));
      console.log(`文件: ${result.file}`);
      console.log(`路径: ${result.path}`);
      console.log(`大小: ${formatSize(result.sizeBytes)}`);
      console.log('');
      console.log(`完整性检查: ${result.integrityCheck}`);
      console.log(`表数量: ${result.tables}`);
      console.log(`总记录数: ${result.totalRecords}`);
      console.log('');

      if (result.tableList.length > 0) {
        console.log('表列表:');
        result.tableList.forEach((table) => {
          console.log(`  - ${table}`);
        });
        console.log('');
      }

      if (result.valid) {
        console.log('✓ 备份验证通过');
      } else {
        console.log('✗ 备份验证失败');
        if (result.error) {
          console.log(`  原因: ${result.error}`);
        }
      }
      console.log('='.repeat(60));
    }

    process.exit(result.valid ? 0 : 1);
  }

  // 默认：验证备份目录中的最新备份
  const backupDir = path.resolve(options.backupDir);
  const backupFiles = getBackupFiles(backupDir);

  if (backupFiles.length === 0) {
    console.error('错误: 备份目录中没有找到备份文件');
    process.exit(1);
  }

  const latestBackup = backupFiles[0];
  console.log(`验证最新备份: ${latestBackup.name}`);
  console.log('');

  const result = await verifyBackupFile(latestBackup.path);

  if (options.output === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('='.repeat(60));
    console.log('最新备份验证结果');
    console.log('='.repeat(60));
    console.log(`文件: ${result.file}`);
    console.log(`大小: ${formatSize(result.sizeBytes)}`);
    console.log(`完整性检查: ${result.integrityCheck}`);
    console.log(`表数量: ${result.tables}`);
    console.log(`总记录数: ${result.totalRecords}`);
    console.log('');

    if (result.valid) {
      console.log('✓ 备份验证通过');
    } else {
      console.log('✗ 备份验证失败');
      if (result.error) {
        console.log(`  原因: ${result.error}`);
      }
    }
    console.log('='.repeat(60));
  }

  process.exit(result.valid ? 0 : 1);
}

main().catch((err) => {
  console.error('执行出错:', err.message);
  process.exit(1);
});
