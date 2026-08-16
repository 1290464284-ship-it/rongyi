import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { extractFailedFiles } from './lib/flaky-parse.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runs = Math.max(1, Number(process.env.FLAKY_RUNS ?? 2));
const testPattern = process.env.FLAKY_TEST_PATTERN;
const failures = [];
const historyPath = path.join(repoRoot, 'apps/v2/flaky-quarantine/history.json');
const history = fs.existsSync(historyPath)
  ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
  : [];

for (let run = 1; run <= runs; run += 1) {
  const args = ['--filter', '@dental/v2', 'exec', 'vitest', 'run', '--sequence.shuffle'];
  if (testPattern) args.push(testPattern);
  console.log(`[flaky-detect] run ${run}/${runs}: pnpm ${args.join(' ')}`);
  // 跨平台启动 pnpm：Windows 上 pnpm 是 .cmd/.ps1 shim，必须经 ComSpec + '/c'
  // 启动；POSIX（CI 的 ubuntu-latest，pnpm/action-setup 已将 pnpm 加入 PATH）
  // 上直接 spawn 'pnpm' 即可。按平台分支，避免 ComSpec undefined 崩溃。
  // 捕获输出（而非 stdio: 'inherit'）以便失败时解析失败测试路径并写入历史，
  // 让瞬时失败留下取证痕迹（R78-05）。
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec, ['/c', 'pnpm', ...args], {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
      })
    : spawnSync('pnpm', args, {
        cwd: repoRoot,
        env: process.env,
        encoding: 'utf8',
      });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  // 保留与 stdio: 'inherit' 一致的控制台输出体验（整轮结束后回放）。
  process.stdout.write(output);
  const passed = result.status === 0;
  const entry = {
    timestamp: new Date().toISOString(),
    run,
    passed,
  };
  if (!passed) {
    const failedFiles = extractFailedFiles(output);
    if (failedFiles.length > 0) entry.failedFiles = failedFiles.slice(0, 100);
    if (result.error) entry.spawnError = result.error.message;
    failures.push(run);
  }
  history.push(entry);
}

fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, `${JSON.stringify(history.slice(-100), null, 2)}\n`);

if (failures.length > 0) {
  console.error(`[flaky-detect] failed runs: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`[flaky-detect] ${runs} shuffled runs passed`);
