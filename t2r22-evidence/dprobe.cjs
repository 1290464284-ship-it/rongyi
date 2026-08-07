// DPAPI reproduction with the packaged exe: launch, wait, record log state, kill, relaunch.
// Usage: node dprobe.cjs <userDataDir> <dataSourceDir>
const { spawn } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];
const dataSrc = process.argv[3];

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runOnce(tag) {
  // ensure data dir present (seed copy)
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
  const child = spawn(EXE, [`--user-data-dir=${ud}`], {
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  await sleep(12000);
  const logPath = path.join(ud, 'logs', 'desktop.log');
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '(no desktop.log)';
  const alive = (() => { try { process.kill(child.pid, 0); return true; } catch { return false; } })();
  console.log(`[${tag}] alive=${alive}`);
  console.log(`[${tag}] api-initial-start-failed=${log.includes('api-initial-start-failed')}`);
  console.log(`[${tag}] desktop.log tail:\n` + log.split('\n').slice(-5).join('\n'));
  console.log(`[${tag}] stderr tail: ` + out.split('\n').slice(-8).join(' | '));
  // kill hard
  spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  await sleep(2000);
}

async function main() {
  fs.rmSync(path.join(ud, 'secrets'), { recursive: true, force: true });
  fs.rmSync(path.join(ud, 'logs'), { recursive: true, force: true });
  await runOnce('RUN1');
  await runOnce('RUN2');
  console.log('DPROBE DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
