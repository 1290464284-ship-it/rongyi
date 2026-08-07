// Reload persistence test: login, reload, check if session survives.
// Usage: node reload-test.cjs <userDataDir>
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];

async function main() {
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${ud}`],
  });
  const win = await app.firstWindow();
  await win.waitForSelector('form.login-card', { timeout: 60000 });
  await win.fill('form.login-card input >> nth=0', 'admin');
  await win.fill('form.login-card input >> nth=1', 'REDACTED');
  await win.click('form.login-card button');
  await win.waitForSelector('h1:has-text("工作台")', { timeout: 30000 });
  console.log('logged in; dashboard visible');

  // secrets.get from renderer (the persistence path)
  let secretsGetResult = null;
  try {
    const t = await win.evaluate(() => window.desktop.secrets.get('v2.token'));
    secretsGetResult = t ? 'token-present:' + String(t).slice(0, 8) : 'null';
  } catch (e) {
    secretsGetResult = 'THROW: ' + String(e).slice(0, 120);
  }
  console.log('secrets.get ->', secretsGetResult);

  // reload
  await win.reload();
  await win.waitForSelector('form.login-card, h1', { timeout: 30000 });
  await win.waitForTimeout(2500);
  const st = await win.evaluate(() => ({
    href: location.href,
    loginVisible: !!document.querySelector('form.login-card'),
    bodySnippet: (document.body.innerText || '').replace(/\n+/g, ' | ').slice(0, 120),
  }));
  console.log('after reload:', JSON.stringify(st, null, 2));
  await win.screenshot({ path: 'D:/Desktop/rongyi/t2r22-evidence/05-reload-session.png' });
  await app.close();
  console.log('RELOAD-TEST DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
