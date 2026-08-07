// Probe: does --user-data-dir redirect the packaged app's userData?
// Usage: node probe-ud.cjs <userDataDir>
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];

async function main() {
  console.log('launching with --user-data-dir=' + ud);
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${ud}`],
  });
  console.log('main pid', app.process().pid);
  const started = Date.now();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('form.login-card', { timeout: 90000 });
    console.log('login page after', Date.now() - started, 'ms; url =', win.url());
  } catch (e) {
    console.error('NO LOGIN PAGE:', e.message);
  }
  await new Promise((r) => setTimeout(r, 2000));
  console.log('userData dir listing:', fs.existsSync(ud) ? fs.readdirSync(ud) : 'MISSING');
  const data = path.join(ud, 'data');
  console.log('data dir listing:', fs.existsSync(data) ? fs.readdirSync(data) : 'MISSING');
  await app.close();
  console.log('PROBE DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
