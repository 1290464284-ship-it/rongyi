// M-05: 统一清理运行时产物（本地开发机用，CI 无需运行）。
//
// 默认删除的安全集（全部被 git 忽略）：
//   coverage/  coverage-web/  dist/  dist-web/  dist-electron/
//   release-v2/  release-v2-internal/  logs/v2.log
//   根目录 v2.sqlite / v2.sqlite-wal / v2.sqlite-shm
// data/ 与 pre-migration/ 单独处理（可能含用户数据/迁移快照，默认只报告占用，
// 需显式 --include-data / --include-pre-migration 才删除）。
// legacy/dental.sqlite 由 generate-legacy-resources.mjs 依赖，本脚本永不删除。
//
// 用法：
//   node scripts/clean-artifacts.mjs [--dry-run] [--include-data] [--include-pre-migration]
import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const includeData = flags.has('--include-data');
const includePreMigration = flags.has('--include-pre-migration');

function fmt(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(1)}KB`
      : `${bytes}B`;
}

function entrySize(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) total += entrySize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

function removeEntry(relative) {
  const target = path.resolve(appRoot, relative);
  if (!target.startsWith(appRoot + path.sep)) {
    throw new Error(`refusing to remove path outside app root: ${target}`);
  }
  const size = entrySize(target);
  if (dryRun) {
    console.log(`[dry-run] would remove ${relative} (${fmt(size)})`);
  } else {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`removed ${relative} (${fmt(size)})`);
  }
  return size;
}

let freed = 0;

// 安全集：直接删除。
const safeEntries = [
  'coverage',
  'coverage-web',
  'dist',
  'dist-web',
  'dist-electron',
  'release-v2',
  'release-v2-internal',
  'logs/v2.log',
];
for (const entry of safeEntries) {
  if (fs.existsSync(path.join(appRoot, entry))) freed += removeEntry(entry);
}
for (const name of ['v2.sqlite', 'v2.sqlite-wal', 'v2.sqlite-shm']) {
  if (fs.existsSync(path.join(appRoot, name))) freed += removeEntry(name);
}

// data/ 单独处理：默认只报告。
const dataDir = path.join(appRoot, 'data');
if (fs.existsSync(dataDir)) {
  console.log(`\ndata/ (单独处理，需 --include-data 才删除):`);
  for (const name of ['v2.sqlite', 'backups', 'files']) {
    const target = path.join(dataDir, name);
    if (fs.existsSync(target)) console.log(`  ${path.relative(appRoot, target)}: ${fmt(entrySize(target))}`);
  }
  if (includeData) {
    for (const name of ['v2.sqlite', 'backups', 'files']) {
      if (fs.existsSync(path.join(dataDir, name))) freed += removeEntry(path.join('data', name));
    }
  }
}

// pre-migration/ 单独处理：默认只报告（迁移快照，确认迁移完成后才删）。
const preMigrationDir = path.join(appRoot, 'pre-migration');
if (fs.existsSync(preMigrationDir)) {
  console.log(`\npre-migration/ (单独处理，需 --include-pre-migration 才删除): ${fmt(entrySize(preMigrationDir))}`);
  if (includePreMigration) freed += removeEntry('pre-migration');
}

// legacy/ 永不删除（M-07 的 generate-legacy-resources.mjs 依赖 dental.sqlite）。
const legacyDir = path.join(appRoot, 'legacy');
if (fs.existsSync(legacyDir)) {
  console.log(`\nlegacy/ 保留（generate-legacy-resources.mjs 依赖）: ${fmt(entrySize(legacyDir))}`);
}

console.log(`\n${dryRun ? 'dry-run 总计（未实际删除）' : '已释放'}：${fmt(freed)}`);
