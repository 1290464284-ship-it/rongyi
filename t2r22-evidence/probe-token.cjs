// Probe: after UI login, does secrets.set persist v2.token.enc? Capture renderer console.
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
  const logs = [];
  win.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  await win.waitForSelector('form.login-card', { timeout: 60000 });
  await win.fill('form.login-card input >> nth=0', 'admin');
  await win.fill('form.login-card input >> nth=1', 'admin123');
  await win.click('form.login-card button');
  await win.waitForSelector('h1:has-text("工作台")', { timeout: 30000 });
  await win.waitForTimeout(2000);
  const probe = await win.evaluate(async () => {
    const out = {};
    try { out.secretGet = await window.desktop.secrets.get('v2.token'); } catch (e) { out.secretGetErr = String(e); }
    try { out.refreshGet = await window.desktop.secrets.get('v2.refreshToken'); } catch (e) { out.refreshGetErr = String(e); }
    out.hasDesktop = Boolean(window.desktop);
    out.hasSecrets = Boolean(window.desktop?.secrets);
    return out;
  });
  console.log('PROBE:', JSON.stringify(probe, null, 2));
  const secretsDir = path.join(userData, 'secrets');
  console.log('secrets dir:', fs.existsSync(secretsDir) ? fs.readdirSync(secretsDir).join(', ') : 'MISSING');
  for (const f of ['backup-key', 'jwt-secret', 'v2.token.enc', 'v2.refreshToken.enc']) {
    const p = path.join(secretsDir, f);
    if (fs.existsSync(p)) {
      const b = fs.readFileSync(p);
      console.log(f, 'exists', b.length, 'bytes, head:', b.slice(0, 16).toString('hex'));
    } else {
      console.log(f, 'MISSING');
    }
  }
  console.log('--- renderer console ---');
  logs.slice(0, 60).forEach((l) => console.log(l));
  await app.close();
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
