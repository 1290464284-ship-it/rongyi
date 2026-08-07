// Item 5: error window -> retry -> main window rebuild
// 1. fresh userData, seed good DB, then CORRUPT data/v2.sqlite with garbage bytes
// 2. launch packaged exe -> API fails -> error window appears (~30s, waitForApi timeout)
// 3. restore sqlite, click "重试启动" (desktop:restart-api) -> "本地服务已恢复..." message
// 4. close error window -> spawn second instance -> main window rebuilt via second-instance
// Usage: node item5.cjs <appdataDir> <evidenceDir>
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const userData = process.argv[2];
const ev = process.argv[3];
fs.mkdirSync(ev, { recursive: true });
const results = {};

async function main() {
  // ---------- 0. seed then corrupt ----------
  const seedRes = spawnSync(process.execPath, [
    'D:/Desktop/rongyi/t2r22-evidence/seed-data.cjs',
    path.join(userData, 'data'),
    '3985',
  ], { encoding: 'utf8', timeout: 60000 });
  console.log('seed stdout:', (seedRes.stdout || '').slice(-500));
  if (seedRes.status !== 0) throw new Error('seed failed: ' + (seedRes.stderr || ''));
  const sqlite = path.join(userData, 'data', 'v2.sqlite');
  const backup = path.join(ev, 'v2.sqlite.bak');
  fs.copyFileSync(sqlite, backup);
  fs.writeFileSync(sqlite, Buffer.concat([Buffer.from('GARBAGE NOT A DATABASE\r\n'), Buffer.alloc(4096, 0xff)]));
  results.corrupted = fs.statSync(sqlite).size;
  console.log('corrupted v2.sqlite, size=', results.corrupted);

  // ---------- 1. launch -> error window ----------
  console.log('launching packaged app...');
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${userData}`],
    timeout: 120000,
  });
  results.appProcessPid = app.process().pid;
  const t0 = Date.now();
  const errWin = await app.waitForEvent('window', { timeout: 90000 });
  results.errorWindowMs = Date.now() - t0;
  await errWin.waitForSelector('#msg', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200)); // let error.js fill msg
  results.errorTitle = await errWin.evaluate(() => document.querySelector('h1')?.textContent ?? null);
  results.errorMsg = await errWin.evaluate(() => document.getElementById('msg')?.textContent ?? null);
  results.errorUrl = errWin.url();
  console.log('error window after', results.errorWindowMs, 'ms:', results.errorTitle, '|', results.errorMsg);
  console.log('error URL:', results.errorUrl);
  await errWin.screenshot({ path: path.join(ev, '05-error-window.png') });

  // ---------- 2. restore sqlite then retry ----------
  fs.copyFileSync(backup, sqlite);
  console.log('sqlite restored, clicking retry...');
  await errWin.click('#retry');
  const t1 = Date.now();
  let retryMsg = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    retryMsg = await errWin.evaluate(() => document.getElementById('msg')?.textContent ?? null);
    if (retryMsg && retryMsg.includes('本地服务已恢复')) break;
  }
  results.retryMs = Date.now() - t1;
  results.retryMsg = retryMsg;
  console.log('retry result after', results.retryMs, 'ms:', retryMsg);
  await errWin.screenshot({ path: path.join(ev, '06-retry-ok.png') });
  if (!retryMsg || !retryMsg.includes('本地服务已恢复')) throw new Error('retry did not recover: ' + retryMsg);

  // ---------- 3. close error window, second spawn -> main window ----------
  await errWin.close();
  await new Promise((r) => setTimeout(r, 1500));
  console.log('error window closed, spawning second instance...');
  const second = spawn(EXE, [`--user-data-dir=${userData}`], {
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    stdio: 'ignore',
    detached: true,
  });
  second.unref();
  const t2 = Date.now();
  const mainWin = await app.waitForEvent('window', { timeout: 60000 });
  results.mainWindowMs = Date.now() - t2;
  await mainWin.waitForSelector('form.login-card', { timeout: 60000 });
  results.mainUrl = mainWin.url();
  results.mainHasLoginCard = true;
  console.log('main window after', results.mainWindowMs, 'ms; url:', results.mainUrl);
  await mainWin.screenshot({ path: path.join(ev, '07-main-window.png') });

  await app.close();
  fs.writeFileSync(path.join(ev, 'results-5.json'), JSON.stringify(results, null, 2));
  console.log('DONE', JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
