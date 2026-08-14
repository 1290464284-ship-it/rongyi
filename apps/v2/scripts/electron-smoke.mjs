import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { _electron as electron } from '@playwright/test';
import { waitForService } from './wait-for-services.mjs';

process.on('unhandledRejection', (reason) => {
  console.error(reason instanceof Error ? reason.stack ?? reason.message : reason);
  setTimeout(() => process.exit(1), 250);
});
process.on('uncaughtException', (error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  setTimeout(() => process.exit(1), 250);
});

const appRoot = path.resolve(import.meta.dirname, '..');
const electronExe = path.join(appRoot, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');
const serverCjs = path.join(appRoot, 'dist-electron', 'server.cjs');
const viteCli = path.join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(electronExe)) {
  console.error(`Electron binary not found: ${electronExe}`);
  process.exit(1);
}
if (!fs.existsSync(serverCjs)) {
  console.error('dist-electron/server.cjs not found. Run electron:compile first.');
  process.exit(1);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-electron-smoke-'));
const userDataDir = path.join(dataDir, 'user-data');
// V2_SKIP_WEB_START=1（smoke:all）时使用调用方传入的 V2_WEB_DEV_PORT/V2_WEB_URL
// （可能指向随机空闲端口），否则默认 5180 并自启 vite。
const webPort = Number(process.env.V2_WEB_DEV_PORT) || 5180;
const adminPassword = 'ElectronSmokePass123';
const env = {
  ...process.env,
  V2_WEB_DEV_PORT: String(webPort),
  V2_WEB_URL: process.env.V2_WEB_URL || `http://localhost:${webPort}`,
  V2_ADMIN_PASSWORD: adminPassword,
  V2_DATA_DIR: dataDir,
  V2_BACKUP_DIR: path.join(dataDir, 'backups'),
  V2_LOG_DIR: path.join(dataDir, 'logs'),
  NODE_ENV: 'development',
  ELECTRON_ENABLE_LOGGING: '1',
};
// 防止外层 V2_DB_PATH 把 Electron 启动的 API 子进程重定向到错误数据库。
delete env.V2_DB_PATH;

let vite;
let electronApp;
try {
  if (process.env.V2_SKIP_WEB_START !== '1') {
    vite = spawn(process.execPath, [viteCli], {
      cwd: appRoot,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForService({ url: `http://localhost:${webPort}`, text: '<div id="root"', timeoutMs: 90_000 });
  }

  electronApp = await electron.launch({
    executablePath: electronExe,
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: appRoot,
    env,
  });
  const window = await electronApp.firstWindow({ timeout: 90_000 });
  await window.waitForLoadState('domcontentloaded');
  await window.evaluate(() => {
    window.location.hash = '#/login';
  });

  await window.fill('#login-username', 'admin');
  await window.fill('#login-password', adminPassword);
  await window.getByRole('button', { name: /\u767b\u5f55/ }).click();
  await window.getByText(/\u5de5\u4f5c\u53f0/).first().waitFor({ timeout: 60_000 });

  await window.evaluate(() => {
    window.location.hash = '#/patients';
  });
  await window.getByText(/\u60a3\u8005/).first().waitFor({ timeout: 30_000 });

  const screenshotDir = path.join(appRoot, 'data');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const screenshotPath = path.join(screenshotDir, 'electron-smoke.png');
  await window.screenshot({ path: screenshotPath });
  console.log(`electron smoke passed: ${screenshotPath}`);
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
  if (vite && typeof vite.pid === 'number') {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-vite.pid, 'SIGTERM');
      } catch {
        try { vite.kill('SIGTERM'); } catch { /* already exited */ }
      }
    }
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}
