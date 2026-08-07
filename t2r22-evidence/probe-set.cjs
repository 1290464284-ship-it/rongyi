// Focused: does desktop.secrets.set persist? Capture console with timestamps.
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const userData = process.argv[2];

async function main() {
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${userData}`],
  });
  const win = await app.firstWindow();
  const t0 = Date.now();
  win.on('console', (msg) => console.log(`+${Date.now() - t0}ms [${msg.type()}] ${msg.text().slice(0, 160)}`));
  await win.waitForSelector('form.login-card', { timeout: 60000 });
  console.log(`+${Date.now() - t0}ms login page`);
  // direct set probe BEFORE login
  const pre = await win.evaluate(async () => {
    const out = {};
    try { out.setRet = await window.desktop.secrets.set('v2.token', 'probe-pre-login-value'); } catch (e) { out.setErr = String(e); }
    try { out.getRet = await window.desktop.secrets.get('v2.token'); } catch (e) { out.getErr = String(e); }
    out.href = location.href;
    return out;
  });
  console.log('PRE-LOGIN SET PROBE:', JSON.stringify(pre));
  const secretsDir = path.join(userData, 'secrets');
  console.log('v2.token.enc after pre probe:', fs.existsSync(path.join(secretsDir, 'v2.token.enc')));

  // UI login
  await win.fill('form.login-card input >> nth=0', 'admin');
  await win.fill('form.login-card input >> nth=1', 'admin123');
  await win.click('form.login-card button');
  await win.waitForSelector('h1:has-text("工作台")', { timeout: 30000 });
  console.log(`+${Date.now() - t0}ms dashboard`);
  await win.waitForTimeout(2500);
  const post = await win.evaluate(async () => {
    const out = {};
    try { out.getRet = await window.desktop.secrets.get('v2.token'); } catch (e) { out.getErr = String(e); }
    out.len = out.getRet ? out.getRet.length : 0;
    out.href = location.href;
    return out;
  });
  console.log('POST-LOGIN GET PROBE:', JSON.stringify(post));
  for (const f of ['v2.token.enc', 'v2.refreshToken.enc']) {
    const p = path.join(secretsDir, f);
    console.log(f, fs.existsSync(p) ? 'EXISTS ' + fs.statSync(p).size + 'B' : 'MISSING');
  }
  await app.close();
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
