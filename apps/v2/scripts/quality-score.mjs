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
  // 等价变异白名单（用户拍板口径，见 docs/audits/多维度评分-拉满运动-2026-08-13.md）：
  // 每条目精确匹配「文件:行号:变异算子:替换代码」，命中即按已击杀折算。
  // 防自欺：条目必须精确命中一个幸存变异，否则记为失效并拒绝出分。
  const whitelist = readJson('quality/equivalent-mutants.json', { entries: [] });
  const entries = Array.isArray(whitelist.entries) ? whitelist.entries : [];
  const whitelistKeys = new Set(
    entries.map((entry) => `${entry.file}:${entry.line}:${entry.mutator}:${entry.replacement}`),
  );
  const keyOf = (filePath, line, mutator, replacement) => {
    const normalized = filePath.replace(/\\/g, '/');
    const marker = 'apps/v2/';
    const index = normalized.lastIndexOf(marker);
    const relative = index >= 0 ? normalized.slice(index + marker.length) : normalized;
    return `${relative}:${line}:${mutator}:${replacement}`;
  };
  const staleEntries = [];
  const summary = { killed: 0, survived: 0, noCoverage: 0, equivalent: 0 };
  for (const [filePath, file] of Object.entries(report.files ?? {})) {
    for (const mutant of file.mutants ?? []) {
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
        summary.killed += 1;
      } else if (mutant.status === 'Survived') {
        const key = keyOf(filePath, mutant.location?.start?.line, mutant.mutatorName, mutant.replacement);
        if (whitelistKeys.has(key)) {
          summary.equivalent += 1;
          whitelistKeys.delete(key);
        } else {
          summary.survived += 1;
        }
      } else if (mutant.status === 'NoCoverage') {
        summary.noCoverage += 1;
      }
    }
  }
  for (const key of whitelistKeys) {
    staleEntries.push(`equivalent-mutant whitelist entry no longer matches a survived mutant (stale): ${key}`);
  }
  const total = summary.killed + summary.equivalent + summary.survived + summary.noCoverage;
  return {
    ...summary,
    staleWhitelistEntries: staleEntries,
    score: total ? (summary.killed + summary.equivalent) / total : null,
  };
}

const serverCoverage = coverageStats(readJson('coverage/coverage-final.json', null));
const webCoverage = coverageStats(readJson('coverage-web/coverage-final.json', null));
const flaky = flakyMetrics();
const mutation = mutationMetrics();
const openapi = openApiPathMetrics({
  coreDoc: readJson('openapi.json', {}),
  generatedDoc: readJson('openapi.generated.json', {}),
  routeEntries: readJson('openapi-routes.json', []),
});

// 防自欺（P1-2）：任一关键输入缺失/不可读/为空时直接失败，
// 绝不把空输入折算成 100% 并覆盖提交的质量分产物。
const failures = [];
if (!serverCoverage) {
  failures.push('coverage/coverage-final.json is missing, empty, or unreadable; run test:coverage first');
}
if (!webCoverage) {
  failures.push('coverage-web/coverage-final.json is missing, empty, or unreadable; run test:coverage:web first');
}
if (openapi.routePathCoverage == null) {
  failures.push('openapi-routes.json is missing or empty; run generate:openapi-routes first');
}
if (mutation.score == null) {
  failures.push('reports/mutation/mutation.json is missing, empty, or unreadable; run test:mutation first');
}
for (const stale of mutation.staleWhitelistEntries ?? []) {
  failures.push(stale);
}
if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error('quality score not computed; refusing to overwrite quality-score.json with incomplete inputs');
  process.exit(1);
}

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
