#!/usr/bin/env node
/**
 * SQLite 数据库备份脚本
 *
 * 功能：
 * 1. 自动备份 SQLite 数据库
 * 2. 备份校验（文件大小、PRAGMA integrity_check）
 * 3. 记录备份元数据
 * 4. 支持备份保留策略
 * 5. 支持 gzip 压缩
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
    keep: 30,
    compress: false,
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
      case '--keep':
        options.keep = parseInt(args[++i], 10);
        break;
      case '--compress':
        options.compress = true;
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
SQLite 数据库备份脚本

用法:
  node scripts/backup/backup.js [选项]

选项:
  --db-path <路径>    数据库文件路径（默认: data/dental.sqlite）
  --backup-dir <路径>  备份目录（默认: backups/）
  --keep <数量>        保留备份数量（默认: 30）
  --compress           使用 gzip 压缩备份文件
  -h, --help           显示帮助信息

示例:
  node scripts/backup/backup.js
  node scripts/backup/backup.js --db-path ./data/app.sqlite --keep 50
  node scripts/backup/backup.js --compress --backup-dir ./my-backups
`);
}

// 格式化时间戳为文件名格式
function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

// 格式化字节大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 确保目录存在
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 尝试加载 better-sqlite3
function loadDatabase() {
  try {
    return require('better-sqlite3');
  } catch (err) {
    console.warn('警告: 未找到 better-sqlite3，将使用文件复制方式进行备份');
    return null;
  }
}

// 使用 better-sqlite3 备份 API 进行备份
// better-sqlite3 的 db.backup() 返回 Promise<Backup>，备份完成后自动完成，
// 不再调用已失效的同步式 backup.transfer(-1)（旧版 API 残留，会抛错并回退到 copyFileSync）。
function backupWithBetterSqlite(dbPath, backupPath) {
  const Database = loadDatabase();
  if (!Database) return false;

  const db = new Database(dbPath, { readonly: true });
  try {
    // 执行 WAL checkpoint 确保数据完全落盘（TRUNCATE 比 FULL 更彻底）
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (checkpointErr) {
      console.warn('警告: WAL checkpoint 失败，继续备份:', checkpointErr.message);
    }

    // db.backup() 返回 Promise，备份完成后 resolve；失败时 reject。
    return db
      .backup(backupPath)
      .then(() => true)
      .catch((err) => {
        console.warn('better-sqlite3 备份失败，回退到文件复制:', err.message);
        return false;
      });
  } catch (err) {
    console.warn('better-sqlite3 备份失败，回退到文件复制:', err.message);
    return false;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// 使用文件复制方式进行备份
function backupWithFileCopy(dbPath, backupPath) {
  const Database = loadDatabase();

  // 如果有 better-sqlite3，先尝试 checkpoint
  if (Database) {
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (checkpointErr) {
        console.warn('警告: WAL checkpoint 失败:', checkpointErr.message);
      }
      db.close();
    } catch (err) {
      // 忽略，继续文件复制
    }
  }

  // 复制主数据库文件
  fs.copyFileSync(dbPath, backupPath);

  // 复制 WAL 和 SHM 文件（如果存在）
  for (const suffix of ['-wal', '-shm']) {
    const srcFile = dbPath + suffix;
    const dstFile = backupPath + suffix;
    if (fs.existsSync(srcFile)) {
      try {
        fs.copyFileSync(srcFile, dstFile);
      } catch (err) {
        console.warn(`警告: 无法复制 ${suffix} 文件:`, err.message);
      }
    }
  }

  return true;
}

// 验证备份文件
function verifyBackup(backupPath) {
  const Database = loadDatabase();
  const result = {
    valid: false,
    tables: 0,
    totalRecords: 0,
    integrityCheck: 'failed',
    tableList: [],
    error: null,
  };

  if (!Database) {
    // 如果没有 better-sqlite3，只验证文件存在和大小
    if (fs.existsSync(backupPath)) {
      const stats = fs.statSync(backupPath);
      result.valid = stats.size > 0;
      result.integrityCheck = 'skipped (no better-sqlite3)';
      result.sizeBytes = stats.size;
    } else {
      result.error = '备份文件不存在';
    }
    return result;
  }

  let db = null;
  try {
    db = new Database(backupPath, { readonly: true });

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

    // 统计总记录数（仅统计非系统表，使用快速估算方式）
    let totalRecords = 0;
    for (const table of tables) {
      try {
        const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${table.name}"`).get();
        totalRecords += count.cnt;
      } catch (err) {
        // 忽略单个表的统计错误
      }
    }
    result.totalRecords = totalRecords;

    result.valid = integrityOk;
    db.close();
  } catch (err) {
    result.error = err.message;
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }

  return result;
}

// 读取备份元数据文件
function readMetaFile(metaFilePath) {
  if (!fs.existsSync(metaFilePath)) {
    return { backups: [] };
  }
  try {
    const content = fs.readFileSync(metaFilePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.warn('警告: 无法读取元数据文件，将创建新文件:', err.message);
    return { backups: [] };
  }
}

// 写入备份元数据文件
function writeMetaFile(metaFilePath, meta) {
  fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2), { encoding: 'utf-8' });
}

// 清理旧备份
function cleanupOldBackups(backupDir, keepCount) {
  const backupFiles = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('backup-') && (f.endsWith('.sqlite') || f.endsWith('.sqlite.gz')))
    .map((f) => {
      const fullPath = path.join(backupDir, f);
      const stats = fs.statSync(fullPath);
      return { name: f, path: fullPath, mtime: stats.mtimeMs, size: stats.size };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const deleted = [];
  let freedSpace = 0;

  if (backupFiles.length > keepCount) {
    const toDelete = backupFiles.slice(keepCount);
    for (const file of toDelete) {
      try {
        fs.unlinkSync(file.path);
        deleted.push(file.name);
        freedSpace += file.size;

        // 同时删除对应的 wal/shm 文件
        for (const suffix of ['-wal', '-shm']) {
          const auxFile = file.path + suffix;
          if (fs.existsSync(auxFile)) {
            try {
              fs.unlinkSync(auxFile);
            } catch {
              /* ignore */
            }
          }
        }
      } catch (err) {
        console.error(`删除旧备份失败 ${file.name}:`, err.message);
      }
    }
  }

  return { deleted, freedSpace, remaining: backupFiles.length - deleted.length };
}

// 主函数
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const startTime = Date.now();
  const dbPath = path.resolve(options.dbPath);
  const backupDir = path.resolve(options.backupDir);

  console.log('='.repeat(60));
  console.log('SQLite 数据库备份工具');
  console.log('='.repeat(60));
  console.log(`数据库路径: ${dbPath}`);
  console.log(`备份目录: ${backupDir}`);
  console.log(`保留数量: ${options.keep}`);
  console.log(`压缩: ${options.compress ? '是' : '否'}`);
  console.log('');

  // 检查数据库文件是否存在
  if (!fs.existsSync(dbPath)) {
    console.error(`错误: 数据库文件不存在: ${dbPath}`);
    process.exit(1);
  }

  // 确保备份目录存在
  ensureDir(backupDir);

  // 生成备份文件名
  const timestamp = formatTimestamp(new Date());
  const backupFileName = `backup-${timestamp}.sqlite`;
  let backupPath = path.join(backupDir, backupFileName);

  console.log(`开始备份: ${backupFileName}`);
  console.log('');

  try {
    // 执行备份
    let backupSuccess = false;

    // 优先使用 better-sqlite3 备份 API（返回 Promise）
    backupSuccess = await backupWithBetterSqlite(dbPath, backupPath);

    // 回退到文件复制
    if (!backupSuccess) {
      backupSuccess = backupWithFileCopy(dbPath, backupPath);
    }

    if (!backupSuccess) {
      throw new Error('备份失败');
    }

    console.log('✓ 备份文件创建成功');

    // 验证备份
    console.log('正在验证备份...');
    const verifyResult = verifyBackup(backupPath);

    if (!verifyResult.valid) {
      // 验证失败，删除无效备份
      try {
        fs.unlinkSync(backupPath);
      } catch {
        /* ignore */
      }
      console.error('✗ 备份验证失败:', verifyResult.error || verifyResult.integrityCheck);
      process.exit(1);
    }

    console.log(`✓ 完整性检查: ${verifyResult.integrityCheck}`);
    console.log(`✓ 表数量: ${verifyResult.tables}`);
    console.log(`✓ 总记录数: ${verifyResult.totalRecords}`);

    // 获取备份文件大小
    const stats = fs.statSync(backupPath);
    let finalSize = stats.size;
    let finalFileName = backupFileName;

    // 压缩备份（如果需要）
    if (options.compress) {
      console.log('');
      console.log('正在压缩备份文件...');
      const compressedPath = backupPath + '.gz';
      const input = fs.createReadStream(backupPath);
      const output = fs.createWriteStream(compressedPath);
      const gzip = zlib.createGzip({ level: 9 });

      return new Promise((resolve, reject) => {
        input.pipe(gzip).pipe(output);
        output.on('close', () => {
          try {
            // 删除未压缩的文件
            fs.unlinkSync(backupPath);

            const compressedStats = fs.statSync(compressedPath);
            finalSize = compressedStats.size;
            finalFileName = backupFileName + '.gz';
            backupPath = compressedPath;

            console.log(`✓ 压缩完成: ${formatSize(stats.size)} → ${formatSize(compressedStats.size)} (节省 ${((1 - compressedStats.size / stats.size) * 100).toFixed(1)}%)`);

            finishBackup();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
        output.on('error', reject);
        input.on('error', reject);
      });
    } else {
      finishBackup();
    }

    function finishBackup() {
      const duration = Date.now() - startTime;

      // 记录元数据
      const metaFilePath = path.join(backupDir, 'backup-meta.json');
      const meta = readMetaFile(metaFilePath);

      const backupInfo = {
        timestamp: new Date().toISOString(),
        filename: finalFileName,
        sizeBytes: finalSize,
        tables: verifyResult.tables,
        tableList: verifyResult.tableList,
        totalRecords: verifyResult.totalRecords,
        integrityCheck: verifyResult.integrityCheck,
        durationMs: duration,
        compressed: options.compress,
      };

      meta.backups.unshift(backupInfo);

      // 清理旧备份
      console.log('');
      console.log('正在清理旧备份...');
      const cleanupResult = cleanupOldBackups(backupDir, options.keep);

      // 更新元数据（只保留当前存在的备份记录）
      const existingFiles = new Set(
        fs.readdirSync(backupDir).filter((f) => f.startsWith('backup-') && (f.endsWith('.sqlite') || f.endsWith('.sqlite.gz')))
      );
      meta.backups = meta.backups.filter((b) => existingFiles.has(b.filename));

      writeMetaFile(metaFilePath, meta);

      // 输出结果
      console.log('');
      console.log('='.repeat(60));
      console.log('备份完成!');
      console.log('='.repeat(60));
      console.log(`备份文件: ${finalFileName}`);
      console.log(`文件大小: ${formatSize(finalSize)}`);
      console.log(`表数量: ${verifyResult.tables}`);
      console.log(`总记录数: ${verifyResult.totalRecords}`);
      console.log(`耗时: ${(duration / 1000).toFixed(2)} 秒`);
      console.log(`剩余备份数: ${cleanupResult.remaining}`);
      if (cleanupResult.deleted.length > 0) {
        console.log(`已删除旧备份: ${cleanupResult.deleted.length} 个 (释放 ${formatSize(cleanupResult.freedSpace)})`);
      }
      console.log('='.repeat(60));
    }
  } catch (err) {
    console.error('');
    console.error('备份失败:', err.message);

    // 清理可能的不完整备份文件
    if (fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        /* ignore */
      }
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error('备份主流程异常:', err);
  process.exit(1);
});
