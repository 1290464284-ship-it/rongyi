import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolveSimulatedDataDir } from './simulated-data.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const port = 38000 + Math.floor(Math.random() * 1000);
const adminPassword = process.env.V2_ADMIN_PASSWORD ?? 'REDACTED';
const backupKey = 'simulated-data-backup-key-0123456789abcdef';
const jwtSecret = 'simulated-data-jwt-0123456789abcdef0123456789abcdef';

const simDir = resolveSimulatedDataDir();
if (!simDir) {
  console.error('Simulated clinic database not found. Run simulate:clinic-data first.');
  process.exit(1);
}

const base = `http://127.0.0.1:${port}/api/v2`;
const apiEnv = {
  ...process.env,
  V2_PORT: String(port),
  V2_HOST: '127.0.0.1',
  NODE_ENV: 'development',
  V2_DATA_DIR: simDir,
  V2_BACKUP_DIR: path.join(simDir, 'backups'),
  V2_LOG_DIR: path.join(simDir, 'logs'),
  V2_LEGACY_DB_PATH: legacyDb,
  V2_LEGACY_SCHEMA_DIR: legacySchemaDir,
  V2_DB_PATH: path.join(simDir, 'v2.sqlite'),
  V2_JWT_SECRET: jwtSecret,
  V2_BACKUP_KEY: backupKey,
  V2_ADMIN_PASSWORD: adminPassword,
  V2_BASE_URL: base,
};

function waitForApi(timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Simulated API did not become ready'));
        return;
      }
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // retry
      }
      setTimeout(() => void attempt(), 500);
    };
    void attempt();
  });
}

let apiProcess = null;
try {
  apiProcess = spawn(process.execPath, [serverScript], {
    cwd: appRoot,
    env: apiEnv,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  await waitForApi();
  const smoke = spawnSync(process.execPath, [path.join(appRoot, 'scripts', 'api-smoke.mjs')], {
    cwd: appRoot,
    env: apiEnv,
    stdio: 'inherit',
  });
  if (smoke.status !== 0) {
    throw new Error(`api-smoke failed against simulated data with exit code ${smoke.status}`);
  }
  console.log(`simulated data smoke passed: ${simDir}`);
} finally {
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
}
