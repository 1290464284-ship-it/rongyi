import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { installerFileName } from './artifact-name.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const releaseDir = path.resolve(process.env.V2_RELEASE_DIR ?? path.join(appRoot, 'release-v2'));
const installer = path.join(releaseDir, installerFileName(pkg));
const blockMap = `${installer}.blockmap`;

function sha512File(filePath) {
  const hash = crypto.createHash('sha512');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('base64');
}

if (!fs.existsSync(installer) || !fs.existsSync(blockMap)) {
  console.error('installer and blockmap are required');
  process.exit(1);
}

const size = fs.statSync(installer).size;
const sha512 = sha512File(installer);
const latestYml = [
  `version: ${pkg.version}`,
  `files:`,
  `  - url: ${path.basename(installer)}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${path.basename(installer)}`,
  `sha512: ${sha512}`,
  `releaseDate: ${new Date().toISOString()}`,
  '',
].join('\n');

fs.writeFileSync(path.join(releaseDir, 'latest.yml'), latestYml, 'utf8');
console.log(`latest.yml generated for ${pkg.version}`);
