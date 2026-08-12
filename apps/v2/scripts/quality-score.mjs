import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutationScore, openApiPathMetrics } from './lib/quality-metrics.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath, fallback = null) {
  const full = path.join(appRoot, relativePath);
  if (!fs.existsSync(full)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return fallback;
  }
}

function coverageMetrics() {
  const data = readJson('coverage/coverage-final.json', {});
  let statements = 0;
  let branches = 0;
  let functions = 0;
  let lines = 0;
  let statementsHit = 0;
  let branchesHit = 0;
  let functionsHit = 0;
  let linesHit = 0;

  for (const file of Object.values(data)) {
    statements += Object.keys(file.s ?? {}).length;
    branches += Object.keys(file.b ?? {}).length;
    functions += Object.keys(file.f ?? {}).length;
    for (const count of Object.values(file.s ?? {})) if (count > 0) statementsHit += 1;
    for (const branch of Object.values(file.b ?? {})) {
      if (Array.isArray(branch) && branch.some((count) => count > 0)) branchesHit += 1;
    }
    for (const count of Object.values(file.f ?? {})) if (count > 0) functionsHit += 1;
    for (const [line, count] of Object.entries(file.l ?? {})) {
      if (!line.startsWith('_')) {
        lines += 1;
        if (count > 0) linesHit += 1;
      }
    }
  }
  return {
    statements: statements ? statementsHit / statements : 1,
    branches: branches ? branchesHit / branches : 1,
    functions: functions ? functionsHit / functions : 1,
    lines: lines ? linesHit / lines : 1,
  };
}

function flakyMetrics() {
  const history = readJson('flaky-quarantine/history.json', []);
  const runs = history.length;
  const failures = history.filter((entry) => !entry.passed).length;
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

const coverage = coverageMetrics();
const flaky = flakyMetrics();
const mutation = mutationMetrics();
const openapi = openApiPathMetrics({
  coreDoc: readJson('openapi.json', {}),
  generatedDoc: readJson('openapi.generated.json', {}),
  routeEntries: readJson('openapi-routes.json', []),
});

const quality = {
  generatedAt: new Date().toISOString(),
  coverage,
  flaky,
  mutation,
  openapi: {
    ...openapi,
    routeInventory: openapi.routeEntries,
  },
};

const outPath = process.env.V2_QUALITY_PATH ?? path.join(appRoot, 'quality-score.json');
fs.writeFileSync(outPath, `${JSON.stringify(quality, null, 2)}\n`);
console.log(JSON.stringify(quality, null, 2));
