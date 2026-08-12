import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const outPath = process.env.V2_SBOM_PATH ?? path.join(appRoot, 'sbom.cdx.json');
const result = spawnSync(
  process.env.ComSpec,
  ['/c', 'pnpm', 'list', '--depth', '0', '--json'],
  { cwd: appRoot, encoding: 'utf8' },
);
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(result.status ?? 1);
}

const raw = JSON.parse(result.stdout);
const rootPackage = raw.find((pkg) => pkg.name === '@dental/v2') ?? raw[raw.length - 1];
const components = Object.entries(rootPackage.dependencies ?? {}).map(([name, info]) => ({
  type: 'library',
  'bom-ref': `${name}@${info.version}`,
  name,
  version: info.version,
}));

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      'bom-ref': `${rootPackage.name}@${rootPackage.version}`,
      name: rootPackage.name,
      version: rootPackage.version,
    },
  },
  components,
};

fs.writeFileSync(outPath, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`SBOM written: ${outPath} (${components.length} components)`);
