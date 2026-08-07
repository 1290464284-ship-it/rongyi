// Probe: does the error window have window.desktop? does error.js run?
// Usage: node item5-probe.cjs <appdataDir>
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const userData = process.argv[2];

async function main() {
  // corrupt (assume already seeded by caller or seed here)
  const sqlite = path.join(userData, 'data', 'v2.sqlite');
  if (!fs.existsSync(sqlite)) {
    const seedRes = spawnSync(process.execPath, [
      'D:/Desktop/rongyi/t2r22-evidence/seed-data.cjs',
      path.join(userData, 'data'), '3986',
    ], { encoding: 'utf8', timeout: 60000 });
    if (seedRes.status !== 0) throw new Error('seed failed');
  }
  fs.copyFileSync(sqlite, sqlite + '.bak');
  fs.writeFileSync(sqlite, Buffer.concat([Buffer.from('GARBAGE'), Buffer.alloc(4096, 0xff)]));

  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${userData}`],
    timeout: 120000,
  });
  const errWin = await app.waitForEvent('window', { timeout: 90000 });
  await errWin.waitForSelector('#msg', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1500));
  const info = await errWin.evaluate(() => ({
    msg: document.getElementById('msg')?.textContent,
    desktopType: typeof window.desktop,
    desktopKeys: window.desktop ? Object.keys(window.desktop) : null,
    retryClickBound: typeof document.getElementById('retry')?.onclick,
    scripts: Array.from(document.scripts).map((s) => s.src),
    readyState: document.readyState,
  }));
  console.log(JSON.stringify(info, null, 2));
  // try clicking retry anyway
  try {
    await errWin.click('#retry');
    await new Promise((r) => setTimeout(r, 2000));
    info.afterClick = await errWin.evaluate(() => document.getElementById('msg')?.textContent);
  } catch (e) {
    info.clickError = String(e);
  }
  console.log('afterClick:', info.afterClick, 'clickError:', info.clickError);
  await app.close();
  fs.copyFileSync(sqlite + '.bak', sqlite); // restore
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
