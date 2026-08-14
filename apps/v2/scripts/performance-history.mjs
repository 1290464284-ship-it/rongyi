import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const historyPath = path.join(repoRoot, 'apps/v2/performance/history.json');
const latestPath = path.join(repoRoot, 'apps/v2/performance/latest.json');
const snapshotLatestPath = path.join(repoRoot, 'apps/v2/performance/snapshot-latest.json');

// 跨平台启动 pnpm：Windows 上 pnpm 是 .cmd/.ps1 shim，必须经 ComSpec + '/c'
// 启动；POSIX（CI 的 ubuntu-latest，pnpm/action-setup 已将 pnpm 加入 PATH）
// 上直接 spawn 'pnpm' 即可。与 flaky-detect.mjs 同一模式。
function runPnpm(args) {
  return process.platform === 'win32'
    ? spawnSync(process.env.ComSpec, ['/c', 'pnpm', ...args], {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
      })
    : spawnSync('pnpm', args, {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
      });
}
const result = runPnpm(['--filter', '@dental/v2', 'benchmark:load']);
const snapshotResult = runPnpm(['--filter', '@dental/v2', 'benchmark:snapshots']);

const history = fs.existsSync(historyPath)
  ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
  : [];
history.push({
  timestamp: new Date().toISOString(),
  passed: result.status === 0 && snapshotResult.status === 0,
  exitCode: result.status || snapshotResult.status || 0,
  metrics: fs.existsSync(latestPath)
    ? JSON.parse(fs.readFileSync(latestPath, 'utf8'))
    : null,
  snapshotMetrics: fs.existsSync(snapshotLatestPath)
    ? JSON.parse(fs.readFileSync(snapshotLatestPath, 'utf8'))
    : null,
});
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, `${JSON.stringify(history.slice(-100), null, 2)}\n`);

if (result.status !== 0) process.exit(result.status ?? 1);
if (snapshotResult.status !== 0) process.exit(snapshotResult.status ?? 1);
console.log('performance history updated');
