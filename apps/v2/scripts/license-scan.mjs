import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packagePath = path.resolve(import.meta.dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const allowed = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Unlicense',
  'MPL-2.0',
]);

const issues = [];
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  try {
    const depPkg = resolvePackage(name);
    const license = depPkg.license
      ? typeof depPkg.license === 'string' ? depPkg.license : depPkg.license.type
      : 'UNKNOWN';
    if (!allowed.has(String(license).trim())) issues.push(`${name}: ${license}`);
  } catch {
    issues.push(`${name}: cannot resolve package.json`);
  }
}

if (issues.length > 0) {
  console.error(issues.join('\n'));
  process.exit(1);
}
console.log(`license scan passed (${Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length} direct dependencies)`);

function resolvePackage(name) {
  try {
    return require(`${name}/package.json`);
  } catch {
    const entry = require.resolve(name);
    let dir = path.dirname(entry);
    while (dir && dir !== path.dirname(dir)) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed.name === name) return parsed;
      }
      dir = path.dirname(dir);
    }
  }
  throw new Error(`cannot resolve ${name}`);
}
