import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { installerFileName } from './artifact-name.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const releaseDir = path.join(appRoot, 'release-v2');
const installer = path.join(releaseDir, installerFileName(pkg));
const blockMap = `${installer}.blockmap`;

if (!fs.existsSync(installer) || !fs.existsSync(blockMap)) {
  console.error('installer and blockmap are required');
  process.exit(1);
}

const buffer = fs.readFileSync(installer);
const sha512 = crypto.createHash('sha512').update(buffer).digest('base64');
const latestYml = [
  `version: ${pkg.version}`,
  `files:`,
  `  - url: ${path.basename(installer)}`,
  `    sha512: ${sha512}`,
  `    size: ${buffer.length}`,
  `path: ${path.basename(installer)}`,
  `sha512: ${sha512}`,
  `releaseDate: ${new Date().toISOString()}`,
  '',
].join('\n');

fs.writeFileSync(path.join(releaseDir, 'latest.yml'), latestYml, 'utf8');
console.log(`latest.yml generated for ${pkg.version}`);
