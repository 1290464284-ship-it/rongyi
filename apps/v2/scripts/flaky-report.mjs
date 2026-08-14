import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './flaky-quarantine-manager.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const historyPath = path.join(appRoot, 'flaky-quarantine', 'history.json');
const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];
const quarantined = loadRegistry().quarantinedTests.length;
const recent = history.slice(-3);
const runs = recent.length;
const failures = recent.filter((entry) => !entry.passed).length;
const recentFailures = recent.filter((entry) => !entry.passed).length;

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  runs,
  failures,
  flakinessRate: runs === 0 ? 0 : Number((failures / runs).toFixed(3)),
  recentRuns: recent.length,
  recentFailures,
  quarantinedTests: quarantined,
}, null, 2));
