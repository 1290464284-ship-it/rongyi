import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runs = Math.max(1, Number(process.env.FLAKY_RUNS ?? 2));
const testPattern = process.env.FLAKY_TEST_PATTERN;
const failures = [];
const historyPath = path.join(repoRoot, 'apps/v2/flaky-quarantine/history.json');
const history = fs.existsSync(historyPath)
  ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
  : [];

for (let run = 1; run <= runs; run += 1) {
  const args = ['--filter', '@dental/v2', 'exec', 'vitest', 'run', '--sequence.shuffle.files'];
  if (testPattern) args.push(testPattern);
  console.log(`[flaky-detect] run ${run}/${runs}: pnpm ${args.join(' ')}`);
  const result = spawnSync(process.env.ComSpec, ['/c', 'pnpm', ...args], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) failures.push(run);
  history.push({
    timestamp: new Date().toISOString(),
    run,
    passed: result.status === 0,
  });
}

fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, `${JSON.stringify(history.slice(-100), null, 2)}\n`);

if (failures.length > 0) {
  console.error(`[flaky-detect] failed runs: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`[flaky-detect] ${runs} shuffled runs passed`);
