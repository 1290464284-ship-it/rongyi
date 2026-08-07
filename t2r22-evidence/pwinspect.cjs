// Inspect safeStorage state in a PLAYWRIGHT-launched app via --inspect (main process).
// Usage: node pwinspect.cjs <userDataDir> <secretFile>
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const http = require('node:http');
const { spawn } = require('node:child_process');

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
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1', T2R22_TARGET: target },
    args: [`--user-data-dir=${ud}`, `--inspect=${PORT}`],
  });
  const win = await app.firstWindow();
  await win.waitForTimeout(3000);
  const boot = await win.evaluate(() => ({ href: location.href, text: (document.body.innerText || '').replace(/\n+/g, ' | ').slice(0, 80) }));
  console.log('boot:', JSON.stringify(boot));

  let list = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { list = await getJson(`http://127.0.0.1:${PORT}/json`); if (Array.isArray(list) && list.length) break; } catch { /* retry */ }
  }
  if (!list || !list.length) { console.log('NO INSPECTOR'); await app.close(); process.exit(1); }
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
    const { safeStorage } = req('electron');
    const fs = process.getBuiltinModule('fs');
    const out = {};
    out.encAvail = safeStorage.isEncryptionAvailable();
    out.argv = process.argv.slice(1);
    try {
      const c = safeStorage.encryptString('roundtrip-value-0123456789');
      out.rtLen = Buffer.from(c).length;
      out.rtDec = safeStorage.decryptString(c).slice(0, 12);
    } catch (e) { out.rtErr = String(e); }
    try {
      const data = fs.readFileSync(process.env.T2R22_TARGET);
      out.fileLen = data.length;
      const plain = safeStorage.decryptString(data);
      out.fileDecOk = true;
      out.fileDecHead = plain.slice(0, 8);
      out.fileDecLen = Buffer.from(plain).length;
    } catch (e) { out.fileDecErr = String(e); }
    return JSON.stringify(out);
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log('MAIN:', r.result?.result?.value ?? JSON.stringify(r, null, 2));
  sock.close();
  await app.close();
  console.log('PWINSPECT DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
