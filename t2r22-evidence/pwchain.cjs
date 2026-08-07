// Full reproduction chain: Playwright launch writes secret, then launch again.
// Usage: node pwchain.cjs <userDataDir> <dataSourceDir>
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const { spawn } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];
const dataSrc = process.argv[3];

function ensureData() {
  if (!fs.existsSync(path.join(ud, 'data', 'v2.sqlite'))) {
    fs.mkdirSync(path.join(ud, 'data'), { recursive: true });
    const walk = (src, dst) => {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, f.name);
        const d = path.join(dst, f.name);
        if (f.isDirectory()) walk(s, d);
        else fs.copyFileSync(s, d);
      }
    };
    walk(dataSrc, path.join(ud, 'data'));
  }
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  fs.rmSync(path.join(ud, 'secrets'), { recursive: true, force: true });
  fs.rmSync(path.join(ud, 'logs'), { recursive: true, force: true });
  ensureData();

  // RUN1 via Playwright
  {
    const app = await _electron.launch({
      executablePath: EXE,
      env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
      args: [`--user-data-dir=${ud}`],
    });
    await app.firstWindow();
    await sleep(4000);
    await app.close();
    const p = path.join(ud, 'secrets', 'jwt-secret');
    const b = fs.readFileSync(p);
    console.log('[PW-RUN1] secret bytes =', b.length, 'prefix =', b.subarray(0, 3).toString());
  }

  // RUN2 via Playwright
  {
    const app = await _electron.launch({
      executablePath: EXE,
      env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
      args: [`--user-data-dir=${ud}`],
    });
    const win = await app.firstWindow();
    await sleep(4000);
    const st = await win.evaluate(() => ({ href: location.href, text: (document.body.innerText || '').slice(0, 60) }));
    console.log('[PW-RUN2]', JSON.stringify(st));
    await app.close();
  }

  // RUN3 via direct spawn
  {
    const child = spawn(EXE, [`--user-data-dir=${ud}`], { env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' }, stdio: 'ignore' });
    await sleep(12000);
    const logPath = path.join(ud, 'logs', 'desktop.log');
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    console.log('[SPAWN-RUN3] api-initial-start-failed =', log.includes('api-initial-start-failed'));
    spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    await sleep(2000);
  }
  console.log('PWCHAIN DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
