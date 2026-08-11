import fs from 'node:fs';
import path from 'node:path';
import { installerFileName } from './artifact-name.mjs';
import { filesExist } from './lib/artifact-utils.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const releaseDir = path.resolve(
  process.env.V2_RELEASE_DIR ?? path.join(import.meta.dirname, '..', 'release-v2'),
);
const productName = pkg.build.productName;
const exePath = path.join(releaseDir, installerFileName(pkg));
const blockMap = `${exePath}.blockmap`;

filesExist([exePath, blockMap]);

const latestYml = path.join(releaseDir, 'latest.yml');
const hasLatestYml = fs.existsSync(latestYml);
if (hasLatestYml) {
  const content = fs.readFileSync(latestYml, 'utf8');
  if (!content.includes(`version: ${pkg.version}`)) {
    console.error(`latest.yml is missing version ${pkg.version}`);
    process.exit(1);
  }
}

const unpackedDir = path.join(releaseDir, 'win-unpacked');
if (fs.existsSync(unpackedDir)) {
  const unpackedExe = path.join(unpackedDir, `${productName}.exe`);
  const legacyDb = path.join(unpackedDir, 'resources', 'legacy', 'dental.sqlite');
  const legacySchema = path.join(unpackedDir, 'resources', 'legacy', 'schema');
  for (const [label, file] of [['unpacked executable', unpackedExe], ['packaged legacy database', legacyDb]]) {
    if (!fs.existsSync(file)) {
      console.error(`missing ${label}: ${file}`);
      process.exit(1);
    }
  }
  if (!fs.existsSync(legacySchema) || !fs.readdirSync(legacySchema).some((name) => name.endsWith('.tables.ts'))) {
    console.error(`missing packaged legacy schema: ${legacySchema}`);
    process.exit(1);
  }
  const appUpdateYml = path.join(unpackedDir, 'resources', 'app-update.yml');
  if (hasLatestYml) {
    if (!fs.existsSync(appUpdateYml)) {
      console.error(`missing app-update.yml; publisher verification would be silently disabled (${appUpdateYml})`);
      process.exit(1);
    }
    const updateContent = fs.readFileSync(appUpdateYml, 'utf8');
    const publisherLine = updateContent.match(/^publisherName\s*:\s*(.+)$/m)?.[1]?.trim();
    if (!publisherLine || publisherLine === '[]' || publisherLine === "''" || publisherLine === '""') {
      console.error(`app-update.yml is missing a non-empty publisherName (${appUpdateYml})`);
      process.exit(1);
    }
  }
} else {
  console.log('win-unpacked not present; skipping unpacked resource checks');
}

const devCert = path.join(releaseDir, 'dev-cert.pfx');
if (fs.existsSync(devCert)) {
  console.error(`development certificate must not be published: ${devCert}`);
  process.exit(1);
}

const internalCert = path.join(appRoot, 'build', 'internal-signing.pfx.cer');
if (!pkg.version.includes('-internal.') && fs.existsSync(internalCert)) {
  console.error(`internal signing certificate must not be bundled in a public release: ${internalCert}`);
  process.exit(1);
}

console.log(`package verification passed: ${exePath}`);
