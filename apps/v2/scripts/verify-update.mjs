import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { installerFileName } from './artifact-name.mjs';
import { filesExist } from './lib/artifact-utils.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const releaseDir = path.resolve(
  process.env.V2_RELEASE_DIR ?? path.join(import.meta.dirname, '..', 'release-v2'),
);
const installer = path.join(releaseDir, installerFileName(pkg));
const blockMap = `${installer}.blockmap`;
const latestYml = path.join(releaseDir, 'latest.yml');
filesExist([installer, blockMap, latestYml]);

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

const content = fs.readFileSync(latestYml, 'utf8');
if (!content.includes(`version: ${pkg.version}`) || !content.includes('sha512:') || !content.includes('path:')) {
  console.error('latest.yml is incomplete');
  process.exit(1);
}

// Round7 H7：重新计算安装包 sha512 并与 latest.yml 交叉比对，形成校验闭环。
// 之前只检查字段存在，installer 在 update:metadata 之后被替换也检测不到。
const sha512Match = content.match(/^\s*sha512:\s*([A-Za-z0-9+/=]+)$/m);
if (!sha512Match) {
  console.error('latest.yml is missing sha512 value');
  process.exit(1);
}
const expectedSha512 = sha512Match[1];
const actualSha512 = sha512File(installer);
if (actualSha512 !== expectedSha512) {
  console.error(`sha512 mismatch: latest.yml=${expectedSha512}, installer=${actualSha512}`);
  process.exit(1);
}
console.log('update metadata verification passed (sha512 closed loop)');
