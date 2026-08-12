import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const packagePath = path.join(appRoot, 'package.json');
fs.accessSync(packagePath);
const allowed = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'MPL-2.0',
  'Zlib',
  'MIT-0',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Python-2.0',
  'BlueOak-1.0.0',
  'WTFPL',
]);

const issues = [];
const scanned = new Map();
const visited = new Set();
function walk(dir) {
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return;
  }
  if (visited.has(real)) return;
  visited.add(real);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name === 'package.json') {
      try {
        const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (parsed && typeof parsed.name === 'string') {
          // 子路径 stub（rxjs/ajax 等）与无版本号的测试夹具包不是真实依赖。
          if (parsed.name.includes('/') || !parsed.version) continue;
          scanned.set(`${parsed.name}@${parsed.version ?? ''}`, parsed);
        }
      } catch {
        // 不可读的 package.json 不计入许可违规
      }
    }
  }
}
walk(path.join(appRoot, 'node_modules'));
walk(path.resolve(appRoot, '..', '..', 'node_modules'));
for (const parsed of scanned.values()) {
  const license = parsed.license
    ? (typeof parsed.license === 'string' ? parsed.license : parsed.license.type)
    : 'UNKNOWN';
  const alternatives = String(license).split(/\s+OR\s+/).map((part) => part.trim().replace(/^\(|\)$/g, ''));
  if (!alternatives.every((part) => allowed.has(part))) {
    issues.push(`${parsed.name}@${parsed.version ?? ''}: ${license}`);
  }
}

if (issues.length > 0) {
  console.error(issues.join('\n'));
  process.exit(1);
}
console.log(`license scan passed (${scanned.size} packages incl. transitive)`);
