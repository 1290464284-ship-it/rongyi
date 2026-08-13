import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const historyPath = path.join(repoRoot, 'apps/v2/performance/history.json');
const latestPath = path.join(repoRoot, 'apps/v2/performance/latest.json');
const snapshotLatestPath = path.join(repoRoot, 'apps/v2/performance/snapshot-latest.json');
const result = spawnSync(
  process.env.ComSpec,
  ['/c', 'pnpm', '--filter', '@dental/v2', 'benchmark:load'],
  { cwd: repoRoot, env: process.env, stdio: 'inherit' },
);
const snapshotResult = spawnSync(
  process.env.ComSpec,
  ['/c', 'pnpm', '--filter', '@dental/v2', 'benchmark:snapshots'],
  { cwd: repoRoot, env: process.env, stdio: 'inherit' },
);

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
