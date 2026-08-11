import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

process.on('unhandledRejection', (reason) => {
  console.error(reason instanceof Error ? reason.stack ?? reason.message : reason);
  setTimeout(() => process.exit(1), 250);
});
process.on('uncaughtException', (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  setTimeout(() => process.exit(1), 250);
});

const appRoot = path.resolve(import.meta.dirname, '..');
const exePath = path.join(appRoot, 'release-v2', 'win-unpacked', 'Dental Clinic V2.exe');
if (!fs.existsSync(exePath)) {
  console.error(`packaged app missing; run electron:dist first: ${exePath}`);
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-packaged-ui-'));
const userDataDir = path.join(dataDir, 'user-data');
const adminPassword = 'PackagedUiSmoke123!';
const env = {
  ...process.env,
  V2_PORT: String(port),
  V2_DATA_DIR: dataDir,
  V2_BACKUP_DIR: path.join(dataDir, 'backups'),
  V2_LOG_DIR: path.join(dataDir, 'logs'),
  V2_LEGACY_DB_PATH: path.join(appRoot, 'legacy', 'dental.sqlite'),
  V2_LEGACY_SCHEMA_DIR: path.join(appRoot, 'legacy', 'schema'),
  V2_JWT_SECRET: 'packaged-ui-smoke-jwt-0123456789abcdef0123456789abcdef',
  V2_BACKUP_KEY: 'packaged-ui-backup-key-0123456789abcdef',
  V2_ADMIN_PASSWORD: adminPassword,
  NODE_ENV: 'development',
  ELECTRON_ENABLE_LOGGING: '1',
};
// 打包版运行时数据固定放在临时 userData，外层 V2_DB_PATH 不允许泄漏进来。
delete env.V2_DB_PATH;

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

  const title = await window.title();
  const loginHeading = await window.getByRole('heading').allTextContents();
  console.log('packaged login window', { title, loginHeading });

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
  await window.getByText(/\u60a3\u8005/).first().waitFor({ timeout: 30_000 });

  const screenshotDir = path.join(appRoot, 'data');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, 'packaged-ui-smoke.png');
  await window.screenshot({ path: screenshotPath });
  console.log(`packaged UI smoke passed: ${screenshotPath}`);
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
