import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const removable = ['release-v2', 'coverage', 'dist-web', 'dist-electron', 'logs'];

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
