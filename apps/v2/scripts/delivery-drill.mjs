import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickFreePort } from './lib/smoke-runtime.mjs';
import { createDrill } from './lib/drill-runtime.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(appRoot, 'dist-electron', 'server.cjs');
const restoreScript = path.join(appRoot, 'scripts', 'restore-backup.mjs');
const verifyScript = path.join(appRoot, 'scripts', 'verify-database.mjs');
const legacyDb = path.join(appRoot, 'legacy', 'dental.sqlite');
const legacySchemaDir = path.join(appRoot, 'legacy', 'schema');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-delivery-drill-'));
const dataDir = path.join(tempRoot, 'data');
const dbPath = path.join(dataDir, 'v2.sqlite');
const backupDir = path.join(dataDir, 'backups');
const logDir = path.join(dataDir, 'logs');
// 探测空闲端口启动，避免并行 smoke 互踩造成 EADDRINUSE 假红。
const port = await pickFreePort(33000, 34999);
const jwtSecret = 'delivery-drill-secret-0123456789abcdef0123456789abcdef';
const backupKey = 'delivery-drill-backup-key-0123456789abcdef';
const adminPassword = process.env.V2_ADMIN_PASSWORD;
if (!adminPassword) {
  console.error('V2_ADMIN_PASSWORD must be set to run the delivery drill');
  process.exit(1);
}

const drill = createDrill({
  appRoot,
  serverScript,
  legacyDb,
  legacySchemaDir,
  dataDir,
  backupDir,
  logDir,
  port,
  jwtSecret,
  backupKey,
  adminPassword,
  dbPath,
  captureStderr: true,
  readyLabel: 'delivery drill',
});

const { startApi, stopApi, request, baseEnv, assert } = drill;

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: appRoot,
    env: baseEnv(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function main() {
  assert(fs.existsSync(serverScript), 'dist-electron/server.cjs not found. Run pnpm --filter @dental/v2 build && electron:compile first.');
  assert(fs.existsSync(legacyDb), 'legacy/dental.sqlite not found');
  let stderrReader = () => '';
  try {
    stderrReader = await startApi();
    const login = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    const token = login.token;
    const patientCode = `DRILL-${Date.now()}`;
    const patient = await request('/resources/patients', {
      method: 'POST',
      body: JSON.stringify({
        code: patientCode,
        name: '交付演练患者',
        gender: 'MALE',
        phone: '13700000000',
        source: 'WALK_IN',
        active: true,
      }),
    }, token);

    const backup = await request('/backups', { method: 'POST', body: '{}' }, token);
    assert(typeof backup.filename === 'string', 'backup did not return a filename');
    const backupPath = path.join(backupDir, backup.filename);
    console.log(`Backup created: filename=${backup.filename} encrypted=${backup.encrypted} size=${fs.statSync(backupPath).size}`);
    const verified = await request(`/backups/${encodeURIComponent(backup.filename)}/verify`, {}, token);
    assert(verified.integrity === 'ok', 'backup verification failed');

    await stopApi();
    fs.writeFileSync(dbPath, 'DRILL-CORRUPTED-DATABASE');
    runNodeScript(restoreScript, [backupPath, dbPath]);
    const verifyOutput = runNodeScript(verifyScript);
    assert(verifyOutput.includes('integrity ok'), 'restored database integrity check failed');

    stderrReader = await startApi();
    const relogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: adminPassword }),
    });
    const restored = await request('/resources/patients?page=1&pageSize=100', {}, relogin.token);
    const found = (restored.items ?? []).some((row) => String(row.id) === patient.id || String(row.code) === patientCode);
    assert(found, 'restored patient was not found after restart');

    console.log('Delivery drill passed: legacy import -> create data -> encrypted backup -> verify -> corrupt -> restore -> restart -> consistency check.');
    console.log(`  patient=${patient.id} backup=${backup.filename} database=${dbPath}`);
  } catch (error) {
    const details = stderrReader();
    if (details) console.error(details);
    throw error;
  } finally {
    await stopApi();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
