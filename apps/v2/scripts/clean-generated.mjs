import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const removable = new Set(['release-v2', 'release-v2-internal', 'coverage', 'coverage-web', 'logs']);
for (const entry of fs.readdirSync(appRoot)) {
  if (entry === 'dist' || entry.startsWith('dist-')) removable.add(entry);
}

for (const name of removable) {
  const target = path.resolve(appRoot, name);
  if (target.startsWith(appRoot + path.sep) && fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`removed ${path.relative(appRoot, target)}`);
  }
}

const dataDir = path.resolve(appRoot, 'data');
const marker = path.join(dataDir, '.restore-pending.json');
if (marker.startsWith(dataDir + path.sep) && fs.existsSync(marker)) {
  fs.rmSync(marker, { force: true });
  console.log('removed data/.restore-pending.json');
}
const stagedDir = path.join(dataDir, 'backups');
if (fs.existsSync(stagedDir)) {
  for (const file of fs.readdirSync(stagedDir)) {
    if (file.startsWith('.staged-')) {
      const target = path.join(stagedDir, file);
      if (target.startsWith(stagedDir + path.sep)) {
        fs.rmSync(target, { force: true });
        console.log(`removed data/backups/${file}`);
      }
    }
  }
}
