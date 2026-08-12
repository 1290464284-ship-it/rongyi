import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRegistry } from './flaky-quarantine-manager.mjs';

const appRoot = path.resolve(path.dirname(pathToFileURL(import.meta.url).pathname), '..');
const historyPath = path.join(appRoot, 'flaky-quarantine', 'history.json');
const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];
const quarantined = loadRegistry().quarantinedTests.length;
const runs = history.length;
const failures = history.filter((entry) => !entry.passed).length;
const recent = history.slice(-10);
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
