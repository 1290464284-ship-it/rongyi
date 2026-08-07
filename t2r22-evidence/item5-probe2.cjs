const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const userData = process.argv[2];
async function main() {
  const sqlite = path.join(userData, "data", "v2.sqlite");
  if (!fs.existsSync(sqlite)) { throw new Error("need seeded dir"); }
  fs.writeFileSync(sqlite, Buffer.concat([Buffer.from('GARBAGE'), Buffer.alloc(4096, 0xff)]));
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${userData}`],
    timeout: 120000,
  });
  app.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
  const errWin = await app.waitForEvent('window', { timeout: 90000 });
  errWin.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
  await errWin.waitForSelector('#msg', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 2500));
  const r = await errWin.evaluate(() => {
    const out = { msg: document.getElementById('msg').textContent };
    try {
      const m = new URLSearchParams(location.search).get('msg');
      out.search = location.search;
      out.parsedMsg = m;
      document.getElementById('msg').textContent = 'MANUAL-SET:' + m;
      out.manualSetOk = document.getElementById('msg').textContent;
    } catch (e) { out.evalErr = String(e); }
    return out;
  });
  console.log('EVAL:', JSON.stringify(r, null, 2));
  await app.close();
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
