// Replicate Playwright's exact electron launch: --inspect=0 --remote-debugging-port=0
// Usage: node pwrepro.cjs <userDataDir>
const { spawn } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runOnce(tag) {
  const child = spawn(EXE, [`--user-data-dir=${ud}`, '--inspect=0', '--remote-debugging-port=0'], {
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  await sleep(12000);
  const logPath = path.join(ud, 'logs', 'desktop.log');
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '(no desktop.log)';
  console.log(`[${tag}] api-initial-start-failed=${log.includes('api-initial-start-failed')}`);
  console.log(`[${tag}] stderr: ` + out.split('\n').filter(Boolean).slice(-4).join(' | '));
  spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  await sleep(2000);
}

async function main() {
  fs.rmSync(path.join(ud, 'secrets'), { recursive: true, force: true });
  fs.rmSync(path.join(ud, 'logs'), { recursive: true, force: true });
  await runOnce('RUN1');
  await runOnce('RUN2');
  console.log('PWREPRO DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
