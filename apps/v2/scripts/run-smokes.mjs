import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(appRoot, '..', '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const apiUrl = process.env.V2_API_URL ?? 'http://localhost:3180/api/v2/health';
const webUrl = process.env.V2_WEB_URL ?? 'http://localhost:5180';
const timeoutMs = Number(process.env.V2_WAIT_TIMEOUT_MS ?? 90_000);
const children = [];

function shellCommand(args) {
  return ['pnpm', '--filter', '@dental/v2', ...args]
    .map((part) => (/[\s"]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part))
    .join(' ');
}

function startDev(label, args) {
  const isWindows = process.platform === 'win32';
  const options = {
    cwd: root,
    shell: isWindows,
    stdio: 'inherit',
    env: process.env,
  };
  const child = isWindows
    ? spawn(shellCommand(args), options)
    : spawn(pnpm, ['--filter', '@dental/v2', ...args], options);
  children.push(child);
  child.on('error', (error) => {
    console.error(`${label} failed to start`, error);
  });
  return child;
}

function stopDev() {
  for (const child of children.splice(0)) {
    if (!child || typeof child.pid !== 'number') continue;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          // process already exited
        }
      }
    }
  }
}

async function waitFor(url, label, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (predicate(response)) {
        console.log(`${label} ready`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

function runSmoke(args) {
  const isWindows = process.platform === 'win32';
  const options = {
    cwd: root,
    shell: isWindows,
    stdio: 'inherit',
    env: process.env,
  };
  const result = isWindows
    ? spawnSync(shellCommand(args), options)
    : spawnSync(pnpm, ['--filter', '@dental/v2', ...args], options);
  if (result.status !== 0) {
    throw new Error(`${args.join(' ')} failed with exit code ${result.status}`);
  }
}

try {
  startDev('api', ['dev:api']);
  startDev('web', ['dev:web']);

  await waitFor(apiUrl, 'api', (response) => response.ok);
  await waitFor(webUrl, 'web', async (response) => {
    const text = await response.text();
    return response.ok && text.includes('root');
  });

  runSmoke(['run', 'smoke:api']);
  runSmoke(['run', 'smoke:ui']);
  runSmoke(['run', 'test:load']);
  console.log('full smoke passed');
} finally {
  stopDev();
}
