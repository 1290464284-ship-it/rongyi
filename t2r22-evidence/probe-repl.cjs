// Replicate the exact desktop:secret:set handler logic in the main process via CDP,
// and compare with the renderer IPC result.
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const http = require('node:http');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];
const PORT = 9336;

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
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${ud}`, `--inspect=${PORT}`],
  });
  const win = await app.firstWindow();
  app.on('console', (msg) => console.log('MAINCONSOLE:', msg.text().slice(0, 300)));
  await win.waitForSelector('form.login-card', { timeout: 60000 });

  let list = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { list = await getJson(`http://127.0.0.1:${PORT}/json`); if (Array.isArray(list) && list.length) break; } catch { /* retry */ }
  }
  const ws = list.find((t) => t.type === 'node') || list[0];
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

  const expr = `(() => {
    const { createRequire } = process.getBuiltinModule('module');
    const req = createRequire(process.cwd() + '/__probe__.cjs');
    const { safeStorage, app } = req('electron');
    const fs = process.getBuiltinModule('fs');
    const path = process.getBuiltinModule('path');
    const out = {};
    out.encAvail = safeStorage.isEncryptionAvailable();
    out.userData = app.getPath('userData');
    // exact handler replication
    const key = 'v2.token';
    const value = 'probe-replicate-value-0123456789abcdef';
    const secretsDir = path.join(app.getPath('userData'), 'secrets');
    const secretPath = path.join(secretsDir, key + '.enc');
    try {
      const c = safeStorage.encryptString(String(value));
      out.encLen = Buffer.from(c).length;
      out.encOk = true;
    } catch (e) { out.encErr = String(e); out.encOk = false; }
    try {
      fs.mkdirSync(path.dirname(secretPath), { recursive: true });
      fs.writeFileSync(secretPath, safeStorage.encryptString(String(value)), { mode: 0o600 });
      out.writeOk = true;
    } catch (e) { out.writeErr = String(e); out.writeOk = false; }
    try {
      const back = fs.readFileSync(secretPath);
      out.readLen = back.length;
      out.dec = safeStorage.decryptString(back);
    } catch (e) { out.readErr = String(e); }
    return JSON.stringify(out);
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log('MAIN-REPLICATE:', r.result?.result?.value ?? JSON.stringify(r).slice(0, 400));

  const rend = await win.evaluate(async () => {
    const out = {};
    try { out.setRet = await window.desktop.secrets.set('v2.token', 'probe-renderer-value-0123456789abcdef'); } catch (e) { out.setErr = String(e); }
    try { out.getRet = await window.desktop.secrets.get('v2.token'); } catch (e) { out.getErr = String(e); }
    return out;
  });
  console.log('RENDERER:', JSON.stringify(rend));
  sock.close();
  await app.close();
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
