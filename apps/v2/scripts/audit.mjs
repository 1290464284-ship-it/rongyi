import { execSync } from 'node:child_process';
import path from 'node:path';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');
try {
  const output = execSync('pnpm audit --registry=https://registry.npmjs.org --audit-level=high', {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  console.log(output);
} catch (error) {
  // pnpm audit 失败时 stderr 通常包含具体的漏洞摘要，不能只留 stdout。
  console.error(error.stdout ?? '');
  console.error(error.stderr ?? error.message);
  process.exit(1);
}
