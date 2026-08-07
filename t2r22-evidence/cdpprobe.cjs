// Launch the packaged app with --inspect and drive the MAIN process via Node inspector CDP.
// Usage: node cdpprobe.cjs <userDataDir> <secretFile>
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];
const target = process.argv[3];
const PORT = 9334;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const child = spawn(EXE, [`--user-data-dir=${ud}`, `--inspect=${PORT}`], {
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1', T2R22_TARGET: target },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errOut = '';
  child.stderr.on('data', (d) => (errOut += d));
  child.stdout.on('data', () => {});
  // wait for inspector
  let list = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { list = await getJson(`http://127.0.0.1:${PORT}/json`); if (Array.isArray(list) && list.length) break; } catch { /* retry */ }
  }
  if (!list || !list.length) { console.log('NO INSPECTOR', errOut.slice(-2000)); child.kill(); process.exit(1); }
  const ws = list.find((t) => t.type === 'node') || list[0];
  console.log('inspector target:', ws.title, ws.webSocketDebuggerUrl.slice(0, 60));

  // use playwright's chromium connectOverCDP to talk to the inspector? No — use raw WS via node's WebSocket (node 24 has global WebSocket)
  const sock = new WebSocket(ws.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  let idc = 0;
  const pending = new Map();
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const id = ++idc;
    pending.set(id, resolve);
    sock.send(JSON.stringify({ id, method, params }));
  });
  // wait a bit for app boot
  await new Promise((r) => setTimeout(r, 3000));
  const expr = `(async () => {
    const out = {};
    out.argv = process.argv.slice(1);
    out.env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /ELECTRON|PASSWORD|T2R22|NODE_OPTIONS|USERPROFILE|APPDATA|LOCALAPPDATA/i.test(k)));
    const { createRequire } = process.getBuiltinModule('module');
    const req = createRequire(process.cwd() + '/__probe__.cjs');
    const { safeStorage } = req('electron');
    const fs = process.getBuiltinModule('fs');
    out.encAvail = safeStorage.isEncryptionAvailable();
    try {
      const c = safeStorage.encryptString('roundtrip-value-0123456789');
      out.rtLen = Buffer.from(c).length;
      out.rtPrefix = Buffer.from(c).subarray(0, 3).toString();
      out.rtDec = safeStorage.decryptString(c);
    } catch (e) { out.rtErr = String(e); }
    const t = process.env.T2R22_TARGET;
    try {
      const data = fs.readFileSync(t);
      out.fileLen = data.length;
      out.filePrefix = data.subarray(0, 3).toString();
      const plain = safeStorage.decryptString(data);
      out.fileDecOk = true;
      out.fileDecHead = plain.slice(0, 12);
    } catch (e) { out.fileDecErr = String(e); }
    return JSON.stringify(out);
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log('RESULT:', r.result?.result?.value ?? JSON.stringify(r, null, 2));
  sock.close();
  spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  await new Promise((r2) => setTimeout(r2, 2000));
  console.log('CDPPROBE DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
