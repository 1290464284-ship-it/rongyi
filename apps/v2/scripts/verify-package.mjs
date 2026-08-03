import fs from 'node:fs';
import path from 'node:path';
import { installerFileName } from './artifact-name.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const releaseDir = path.resolve(import.meta.dirname, '..', 'release-v2');
const productName = pkg.build.productName;
const exePath = path.join(releaseDir, installerFileName(pkg));
const unpackedExe = path.join(releaseDir, 'win-unpacked', `${productName}.exe`);
const blockMap = `${exePath}.blockmap`;

const required = [exePath, unpackedExe, blockMap];
for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`missing artifact: ${file}`);
    process.exit(1);
  }
}

const latestYml = path.join(releaseDir, 'latest.yml');
if (fs.existsSync(latestYml)) {
  const content = fs.readFileSync(latestYml, 'utf8');
  if (!content.includes(`version: ${pkg.version}`)) {
    console.error(`latest.yml is missing version ${pkg.version}`);
    process.exit(1);
  }
}

const legacyDb = path.join(releaseDir, 'win-unpacked', 'resources', 'legacy', 'dental.sqlite');
const legacySchema = path.join(releaseDir, 'win-unpacked', 'resources', 'legacy', 'schema');
if (!fs.existsSync(legacyDb)) {
  console.error(`missing packaged legacy database: ${legacyDb}`);
  process.exit(1);
}
if (!fs.existsSync(legacySchema) || !fs.readdirSync(legacySchema).some((name) => name.endsWith('.tables.ts'))) {
  console.error(`missing packaged legacy schema: ${legacySchema}`);
  process.exit(1);
}

const devCert = path.join(releaseDir, 'dev-cert.pfx');
if (fs.existsSync(devCert)) {
  console.error(`development certificate must not be published: ${devCert}`);
  process.exit(1);
}

console.log(`package verification passed: ${exePath}`);
