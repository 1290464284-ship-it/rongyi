import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';
import { resolveSimulatedDataDir } from './simulated-data.mjs';
import { SIM_ADMIN_PASSWORD } from './lib/sim-admin.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const exePath = path.join(appRoot, 'release-v2', 'win-unpacked', 'Dental Clinic V2.exe');
if (!fs.existsSync(exePath)) {
  console.error(`packaged app missing; run electron:dist first: ${exePath}`);
  process.exit(1);
}

const sourceSimDir = resolveSimulatedDataDir();
if (!sourceSimDir) {
  console.error('Simulated clinic database not found. Run simulate:clinic-data first.');
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('unable to allocate a free port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

const port = await freePort();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-packaged-ui-sim-'));
const userDataDir = path.join(dataDir, 'user-data');
// 打包版 API 使用 Electron userData/data/v2.sqlite，模拟库必须复制到该位置，
// 而不是 dataDir 根目录（api-env 白名单也不会转发 V2_DB_PATH/V2_DATA_DIR）。
const appDataDir = path.join(userDataDir, 'data');
fs.mkdirSync(appDataDir, { recursive: true });
// 模拟库管理员密码固定为 v2-sim-admin-password（simulate-clinic-data.ts
// 硬编码）；本 smoke 复制模拟库，登录必须用固定口令（同 disaster-drill）。
const adminPassword = SIM_ADMIN_PASSWORD;
for (const suffix of ['', '-wal', '-shm']) {
  const source = path.join(sourceSimDir, `v2.sqlite${suffix}`);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(appDataDir, `v2.sqlite${suffix}`));
}

const env = {
  ...process.env,
  V2_PORT: String(port),
  V2_BACKUP_DIR: path.join(dataDir, 'backups'),
  V2_LOG_DIR: path.join(dataDir, 'logs'),
  V2_LEGACY_DB_PATH: path.join(appRoot, 'legacy', 'dental.sqlite'),
  V2_LEGACY_SCHEMA_DIR: path.join(appRoot, 'legacy', 'schema'),
  V2_JWT_SECRET: 'packaged-ui-sim-jwt-0123456789abcdef0123456789abcdef',
  V2_BACKUP_KEY: 'packaged-ui-sim-backup-key-0123456789abcdef',
  V2_ADMIN_PASSWORD: adminPassword,
  V2_DISABLE_AUTO_UPDATE: '1',
  NODE_ENV: 'development',
  ELECTRON_ENABLE_LOGGING: '1',
};

let electronApp;
try {
  electronApp = await electron.launch({
    executablePath: exePath,
    env,
    args: [`--user-data-dir=${userDataDir}`],
  });
  const window = await electronApp.firstWindow({ timeout: 90_000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(5000);

  const passwordInput = window.locator('input[type="password"]');
  if ((await passwordInput.count()) > 0) {
    await window.fill('input', 'admin');
    await passwordInput.fill(adminPassword);
    await window.getByRole('button', { name: /\u767b\u5f55/ }).click();
  }
  await window.getByText(/\u5de5\u4f5c\u53f0/).first().waitFor({ timeout: 60_000 });
  if (await window.getByRole('heading', { name: '新手引导' }).count()) {
    await window.getByRole('button', { name: '完成' }).click();
  }

  await window.evaluate(() => {
    window.location.hash = '#/patients';
  });
  await window.getByRole('heading', { name: /患者/ }).waitFor({ timeout: 30_000 });
  await window.getByText(/P\d{6}/).first().waitFor({ timeout: 30_000 });

  const screenshotDir = path.join(appRoot, 'data');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, 'packaged-ui-simulated-smoke.png');
  await window.screenshot({ path: screenshotPath });
  console.log(`packaged UI simulated smoke passed: ${screenshotPath}`);
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
