import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const outPath = process.env.V2_SBOM_PATH ?? path.join(appRoot, 'sbom.cdx.json');

// 审计 P2-2：SBOM 升级为全量 CycloneDX（含传递依赖），由 cdxgen 对
// pnpm workspace 递归扫描生成。cdxgen 不可用时回退为直接依赖清单并
// 以非零退出，保证 CI 门禁不静默降级。
const cdxgen = spawnSync(
  'pnpm',
  ['dlx', '@cyclonedx/cdxgen', '--no-banner', '-o', outPath, '-r', repoRoot],
  { cwd: repoRoot, encoding: 'utf8' },
);
if (cdxgen.status === 0 && fs.existsSync(outPath)) {
  console.log(`Full SBOM written: ${outPath}`);
  process.exit(0);
}
console.error('cdxgen full SBOM generation failed; falling back to direct-dependency list');
if (cdxgen.stderr) console.error(cdxgen.stderr.slice(-2000));

// ── 回退：直接依赖清单（诊断用；仍以失败退出，不静默降级门禁）──────────────
try {
  const listResult = spawnSync(
    process.env.ComSpec,
    ['/c', 'pnpm', 'list', '--depth', '0', '--json'],
    { cwd: appRoot, encoding: 'utf8' },
  );
  const raw = JSON.parse(listResult.stdout);
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
  console.error(`Fallback SBOM written: ${outPath} (${components.length} direct components)`);
} catch (error) {
  console.error('Fallback SBOM generation also failed:', error);
}
process.exit(1);
