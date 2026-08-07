import fs from 'node:fs';
import path from 'node:path';
import { installerFileName } from './artifact-name.mjs';
import { filesExist } from './lib/artifact-utils.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const releaseDir = path.resolve(import.meta.dirname, '..', 'release-v2');
const installer = path.join(releaseDir, installerFileName(pkg));
const blockMap = `${installer}.blockmap`;
const latestYml = path.join(releaseDir, 'latest.yml');
filesExist([installer, blockMap, latestYml]);
const content = fs.readFileSync(latestYml, 'utf8');
if (!content.includes(`version: ${pkg.version}`) || !content.includes('sha512:') || !content.includes('path:')) {
  console.error('latest.yml is incomplete');
  process.exit(1);
}
console.log('update metadata verification passed');
