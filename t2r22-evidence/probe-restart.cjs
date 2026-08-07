// Restart auto-login closed loop: login once, restart, expect NO login page.
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const userData = process.argv[2];
const ev = process.argv[3];
fs.mkdirSync(ev, { recursive: true });

async function launch() {
  return _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${userData}`],
  });
}

async function main() {
  // run 1: login
  let app = await launch();
  let win = await app.firstWindow();
  await win.waitForSelector('form.login-card', { timeout: 60000 });
  await win.fill('form.login-card input >> nth=0', 'admin');
  await win.fill('form.login-card input >> nth=1', 'REDACTED');
  await win.click('form.login-card button');
  await win.waitForSelector('h1:has-text("工作台")', { timeout: 30000 });
  const t1 = Date.now();
  await win.screenshot({ path: path.join(ev, 'r1-dashboard.png') });
  await win.waitForTimeout(1500);
  await app.close();
  console.log('run1 login OK, token files:', fs.existsSync(path.join(userData, 'secrets/v2.token.enc')));

  // run 2: relaunch, expect auto-login (dashboard without typing credentials)
  app = await launch();
  win = await app.firstWindow();
  const t0 = Date.now();
  const loginPageShown = await win.waitForSelector('form.login-card', { timeout: 8000 }).then(() => true).catch(() => false);
  let dashMs = null;
  let dashOk = false;
  if (!loginPageShown) {
    const d = Date.now();
    try {
      await win.waitForSelector('h1:has-text("工作台")', { timeout: 25000 });
      dashMs = Date.now() - d;
      dashOk = true;
    } catch (e) {
      const state = await win.evaluate(() => ({
        href: location.href,
        text: (document.body.innerText || '').replace(/\n+/g, ' | ').slice(0, 200),
      })).catch(() => ({ evalFailed: true }));
      console.log('run2 DASH TIMEOUT, page state:', JSON.stringify(state));
      throw e;
    }
  }
  await win.waitForTimeout(1200);
  await win.screenshot({ path: path.join(ev, 'r2-restart.png') });
  console.log('run2: loginPageShown=' + loginPageShown, 'dashboardDirect=' + dashOk, 'dashMs=' + dashMs);
  const url = win.url();
  console.log('run2 URL:', url);
  await app.close();
  console.log('RESTART TEST DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
