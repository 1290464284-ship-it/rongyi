import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const runs = Math.max(1, Number(process.env.FLAKY_RUNS ?? 2));
const testPattern = process.env.FLAKY_TEST_PATTERN;
const failures = [];

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
}

if (failures.length > 0) {
  console.error(`[flaky-detect] failed runs: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(`[flaky-detect] ${runs} shuffled runs passed`);
