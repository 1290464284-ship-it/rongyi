import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageStats, mutationScore, openApiPathMetrics } from './lib/quality-metrics.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath, fallback = null) {
  const full = path.join(appRoot, relativePath);
  return readJsonFile(full, fallback);
}

function readJsonFile(full, fallback = null) {
  if (!fs.existsSync(full)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return fallback;
  }
}

function flakyMetrics() {
  const history = readJson('flaky-quarantine/history.json', []);
  const recent = history.slice(-3);
  const runs = recent.length;
  const failures = recent.filter((entry) => !entry.passed).length;
  return { runs, failures, flakinessRate: runs ? failures / runs : 0 };
}

function mutationMetrics() {
  const report = readJson('reports/mutation/mutation.json', null);
  if (!report) return { score: null };
  const files = report.files ? Object.values(report.files) : [];
  const summary = files.reduce(
    (acc, file) => {
      const fileScore = mutationScore(file.mutants);
      acc.killed += fileScore.killed;
      acc.survived += fileScore.survived;
      acc.noCoverage += fileScore.noCoverage;
      return acc;
    },
    { killed: 0, survived: 0, noCoverage: 0 },
  );
  const total = summary.killed + summary.survived + summary.noCoverage;
  return { ...summary, score: total ? summary.killed / total : null };
}

const serverCoverage = coverageStats(readJson('coverage/coverage-final.json', {}));
const webCoverage = coverageStats(readJson('coverage-web/coverage-final.json', {}));
const flaky = flakyMetrics();
const mutation = mutationMetrics();
const openapi = openApiPathMetrics({
  coreDoc: readJson('openapi.json', {}),
  generatedDoc: readJson('openapi.generated.json', {}),
  routeEntries: readJson('openapi-routes.json', []),
});

const quality = {
  generatedAt: new Date().toISOString(),
  score: null,
  coverage: {
    server: serverCoverage,
    web: webCoverage,
  },
  flaky,
  mutation,
  openapi: {
    ...openapi,
    routeInventory: openapi.routeEntries,
  },
};
quality.score = Math.round(
  10_000 * (
    0.2 * serverCoverage.branches
    + 0.2 * webCoverage.branches
    + 0.2 * (mutation.score ?? 0)
    + 0.25 * openapi.routePathCoverage
    + 0.1 * (1 - flaky.flakinessRate)
    + 0.05 * serverCoverage.lines
  ),
) / 100;

const historyPath = process.env.V2_QUALITY_HISTORY ?? path.join(appRoot, 'quality/history.json');
const history = readJsonFile(historyPath, []);
history.push({
  timestamp: quality.generatedAt,
  score: quality.score,
  coverage: quality.coverage,
  flaky,
  mutation: { score: mutation.score },
  openapi: { routePathCoverage: openapi.routePathCoverage },
});
fs.mkdirSync(path.dirname(historyPath), { recursive: true });
fs.writeFileSync(historyPath, `${JSON.stringify(history.slice(-100), null, 2)}\n`);

const failures = [];
const recent = history.slice(-3);
if (recent.length >= 3) {
  const [older, previous, current] = recent;
  if (current.score < previous.score && previous.score < older.score) {
    failures.push(`quality score declined for two consecutive runs: ${older.score} -> ${previous.score} -> ${current.score}`);
  }
}
const baselinePath = path.join(appRoot, 'quality-baseline.json');
if (process.env.V2_QUALITY_UPDATE_BASELINE === '1') {
  fs.writeFileSync(baselinePath, `${JSON.stringify({ generatedAt: quality.generatedAt, score: quality.score }, null, 2)}\n`);
} else if (fs.existsSync(baselinePath)) {
  const baseline = readJsonFile(baselinePath, null);
  if (baseline && typeof baseline.score === 'number' && quality.score < baseline.score) {
    failures.push(`quality score ${quality.score} below committed baseline ${baseline.score}`);
  }
}

const outPath = process.env.V2_QUALITY_PATH ?? path.join(appRoot, 'quality-score.json');
fs.writeFileSync(outPath, `${JSON.stringify(quality, null, 2)}\n`);
console.log(JSON.stringify(quality, null, 2));
if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
