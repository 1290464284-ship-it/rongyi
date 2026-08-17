import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './flaky-quarantine-manager.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const historyPath = path.join(appRoot, 'flaky-quarantine', 'history.json');
const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];
const quarantined = loadRegistry().quarantinedTests.length;
// 近 14 天时间窗：偶发抖动（间歇性顺序泄漏）不会因连续几次全绿滑出统计。
const windowStart = Date.now() - 14 * 86_400_000;
const recent = history.filter((entry) => {
  const time = typeof entry.timestamp === 'string' ? new Date(entry.timestamp).getTime() : 0;
  return Number.isFinite(time) && time >= windowStart;
});
const runs = recent.length;
const failures = history.filter((entry) => !entry.passed).length;
const recentFailures = recent.filter((entry) => !entry.passed).length;

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  runs,
  failures,
  flakinessRate: runs === 0 ? 0 : Number((recentFailures / runs).toFixed(3)),
  recentRuns: recent.length,
  recentFailures,
  quarantinedTests: quarantined,
}, null, 2));
