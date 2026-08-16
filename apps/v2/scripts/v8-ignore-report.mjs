// v8 ignore 标记 ratchet（审计 P1-3 治理机制）：统计 src 下 `v8 ignore` 标记
// 总数，超过 committed 基线即失败——覆盖率排除只能减少、不得随意增加；
// 确需新增时必须有 docs/architecture/coverage-exclusions.md 的登记理由，
// 并显式执行 V2_V8_UPDATE_BASELINE=1 更新基线。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(appRoot, 'src');
const baselinePath = process.env.V2_V8_BASELINE ?? path.join(appRoot, 'quality', 'v8-ignore-baseline.json');

function countMarkers() {
  let total = 0;
  const perFile = {};
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        const count = (text.match(/v8 ignore/g) ?? []).length;
        if (count > 0) {
          perFile[path.relative(appRoot, full)] = count;
          total += count;
        }
      }
    }
  }
  return { total, perFile };
}

const { total, perFile } = countMarkers();
if (process.env.V2_V8_UPDATE_BASELINE === '1') {
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), total, perFile }, null, 2)}\n`,
  );
  console.log(`v8 ignore baseline updated: ${total} markers across ${Object.keys(perFile).length} files`);
  process.exit(0);
}
if (!fs.existsSync(baselinePath)) {
  console.error('v8-ignore baseline missing; run with V2_V8_UPDATE_BASELINE=1 to create it');
  process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
console.log(`v8 ignore markers: ${total} (baseline ${baseline.total})`);
const baselinePerFile = (baseline.perFile ?? {}) as Record<string, number>;
// 单文件 ratchet：A 文件删除、B 文件新增等量标记同样会被拦截，
// 防止把关键文件（router/repository 等授权与数据访问路径）的新排除混过去。
const violations: string[] = [];
for (const [file, count] of Object.entries(perFile)) {
  const allowed = baselinePerFile[file] ?? 0;
  if (count > allowed) {
    violations.push(`${file}: ${count} markers (baseline ${allowed})`);
  }
}
if (total > baseline.total || violations.length > 0) {
  if (violations.length > 0) {
    console.error('per-file v8 ignore marker increase (baseline allows none without registration):');
    for (const line of violations) console.error(`  ${line}`);
  }
  console.error(
    `v8 ignore marker count ${total} exceeds committed baseline ${baseline.total}; ` +
      'remove markers or document rationale in docs/architecture/coverage-exclusions.md ' +
      'and update the baseline with V2_V8_UPDATE_BASELINE=1',
  );
  process.exit(1);
}
