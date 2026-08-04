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
  console.error(error.stdout ?? error.message);
  process.exit(1);
}
