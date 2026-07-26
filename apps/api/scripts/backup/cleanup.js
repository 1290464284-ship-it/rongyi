#!/usr/bin/env node
/**
 * SQLite 备份清理脚本
 *
 * 功能：
 * 1. 按数量保留备份（--keep N）
 * 2. 按天数保留备份（--keep-days N）
 * 3. 支持 dry-run 模式
 * 4. 输出删除的文件列表和释放的空间
 */

const fs = require('fs');
const path = require('path');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    backupDir: 'backups',
    keep: 30,
    keepDays: null,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--backup-dir':
        options.backupDir = args[++i];
        break;
      case '--keep':
        options.keep = parseInt(args[++i], 10);
        break;
      case '--keep-days':
        options.keepDays = parseInt(args[++i], 10);
        break;
      case '--dry-run':
        options.dryRun = true;
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
SQLite 备份清理工具

用法:
  node scripts/backup/cleanup.js [选项]

选项:
  --backup-dir <路径>   备份目录（默认: backups/）
  --keep <数量>         按数量保留最近的 N 个备份（默认: 30）
  --keep-days <天数>    按天数保留最近 N 天的备份（覆盖 --keep）
  --dry-run             试运行模式，只显示将要删除的文件，不实际删除
  -h, --help            显示帮助信息

说明:
  - 默认按数量保留，保留最近 30 个备份
  - 使用 --keep-days 时，将按时间保留指定天数内的备份
  - --dry-run 模式可用于预览清理效果

示例:
  node scripts/backup/cleanup.js
  node scripts/backup/cleanup.js --keep 50
  node scripts/backup/cleanup.js --keep-days 30
  node scripts/backup/cleanup.js --dry-run --keep 10
  node scripts/backup/cleanup.js --backup-dir ./my-backups --keep-days 7
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
function formatDateTime(date) {
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

// 写入备份元数据
function writeMetaFile(metaFilePath, meta) {
  fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2), { encoding: 'utf-8' });
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

// 按数量筛选要删除的备份
function selectByCount(backupFiles, keepCount) {
  if (backupFiles.length <= keepCount) {
    return [];
  }
  return backupFiles.slice(keepCount);
}

// 按天数筛选要删除的备份
function selectByDays(backupFiles, days) {
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
  return backupFiles.filter((f) => f.mtimeMs < cutoffTime);
}

// 删除备份文件
function deleteBackupFiles(filesToDelete, dryRun) {
  const deleted = [];
  let freedSpace = 0;

  for (const file of filesToDelete) {
    try {
      if (!dryRun) {
        fs.unlinkSync(file.path);

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
      }

      deleted.push({
        name: file.name,
        size: file.size,
        mtime: file.mtime,
      });
      freedSpace += file.size;
    } catch (err) {
      console.error(`删除失败 ${file.name}:`, err.message);
    }
  }

  return { deleted, freedSpace };
}

// 主函数
function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  const backupDir = path.resolve(options.backupDir);

  console.log('='.repeat(70));
  console.log('SQLite 备份清理工具');
  console.log('='.repeat(70));
  console.log(`备份目录: ${backupDir}`);

  if (options.dryRun) {
    console.log('模式: 试运行 (dry-run) - 不会实际删除文件');
  }

  // 检查备份目录是否存在
  if (!fs.existsSync(backupDir)) {
    console.error('错误: 备份目录不存在');
    process.exit(1);
  }

  // 获取备份文件列表
  const backupFiles = getBackupFiles(backupDir);
  console.log(`当前备份数: ${backupFiles.length}`);
  console.log('');

  if (backupFiles.length === 0) {
    console.log('(没有备份文件需要清理)');
    console.log('='.repeat(70));
    return;
  }

  // 确定要删除的文件
  let filesToDelete = [];
  let strategy = '';

  if (options.keepDays !== null) {
    strategy = `按天数保留（保留最近 ${options.keepDays} 天）`;
    filesToDelete = selectByDays(backupFiles, options.keepDays);
  } else {
    strategy = `按数量保留（保留最近 ${options.keep} 个）`;
    filesToDelete = selectByCount(backupFiles, options.keep);
  }

  console.log(`清理策略: ${strategy}`);
  console.log('');

  if (filesToDelete.length === 0) {
    console.log('✓ 没有需要清理的备份文件');
    console.log('='.repeat(70));
    return;
  }

  // 显示将要删除的文件
  console.log(`将要删除 ${filesToDelete.length} 个备份文件:`);
  console.log('');
  console.log('序号  ' + '文件名'.padEnd(40) + '  ' + '大小'.padEnd(12) + '  ' + '修改时间');
  console.log('-'.repeat(70));

  filesToDelete.forEach((file, index) => {
    const num = String(index + 1).padStart(2, ' ');
    console.log(
      `${num}   ${file.name.padEnd(40)}  ${formatSize(file.size).padEnd(12)}  ${formatDateTime(file.mtime)}`
    );
  });

  console.log('');
  const totalSize = filesToDelete.reduce((sum, f) => sum + f.size, 0);
  console.log(`预计释放空间: ${formatSize(totalSize)}`);
  console.log('');

  // 执行删除
  const result = deleteBackupFiles(filesToDelete, options.dryRun);

  // 更新元数据文件
  const metaFilePath = path.join(backupDir, 'backup-meta.json');
  if (!options.dryRun && fs.existsSync(metaFilePath)) {
    const meta = readMetaFile(metaFilePath);
    const deletedNames = new Set(result.deleted.map((d) => d.name));
    meta.backups = meta.backups.filter((b) => !deletedNames.has(b.filename));
    writeMetaFile(metaFilePath, meta);
  }

  // 输出结果
  if (options.dryRun) {
    console.log('试运行完成。以上文件将会被删除（未实际执行）。');
  } else {
    console.log('='.repeat(70));
    console.log('清理完成!');
    console.log('='.repeat(70));
    console.log(`已删除: ${result.deleted.length} 个备份文件`);
    console.log(`释放空间: ${formatSize(result.freedSpace)}`);
    console.log(`剩余备份: ${backupFiles.length - result.deleted.length} 个`);
  }
  console.log('='.repeat(70));
}

main();
