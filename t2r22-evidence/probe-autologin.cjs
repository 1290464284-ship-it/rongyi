// Restart auto-login assertion: userData already has persisted token -> NO login page, dashboard direct.
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const userData = process.argv[2];
const ev = process.argv[3];
fs.mkdirSync(ev, { recursive: true });

async function main() {
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${userData}`],
  });
  const win = await app.firstWindow();
  const t0 = Date.now();
  const loginShown = await win.waitForSelector('form.login-card', { timeout: 10000 }).then(() => true).catch(() => false);
  const t1 = Date.now();
  let dashMs = null;
  let dashOk = false;
  try {
    await win.waitForSelector('h1:has-text("工作台")', { timeout: 25000 });
    dashMs = Date.now() - (loginShown ? t1 : t0);
    dashOk = true;
  } catch (e) {
    const state = await win.evaluate(() => ({
      href: location.href,
      text: (document.body.innerText || '').replace(/\n+/g, ' | ').slice(0, 200),
    })).catch(() => ({ evalFailed: true }));
    console.log('DASH TIMEOUT, page state:', JSON.stringify(state));
    throw e;
  }
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(ev, 'auto-login.png') });
  console.log('RESULT: loginPageShown=' + loginShown, 'dashboardDirect=' + dashOk, 'dashMs=' + dashMs, 'url=' + win.url());
  await app.close();
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
