// Recursively decrypt the layered secret file to recover the original E1 bytes.
// Usage: node unlayer.cjs <userDataDir> <secretFile>
const { spawn } = require('node:child_process');
const http = require('node:http');

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
    stdio: 'ignore',
  });
  let list = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { list = await getJson(`http://127.0.0.1:${PORT}/json`); if (Array.isArray(list) && list.length) break; } catch { /* retry */ }
  }
  if (!list || !list.length) { console.log('NO INSPECTOR'); child.kill(); process.exit(1); }
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
  await new Promise((r) => setTimeout(r, 3000));
  const expr = `(() => {
    const { createRequire } = process.getBuiltinModule('module');
    const req = createRequire(process.cwd() + '/__probe__.cjs');
    const { safeStorage } = req('electron');
    const fs = process.getBuiltinModule('fs');
    const layers = [];
    let data = fs.readFileSync(process.env.T2R22_TARGET);
    for (let i = 0; i < 12; i++) {
      try {
        const plain = safeStorage.decryptString(data);
        const b = Buffer.from(plain, 'utf8');
        const head = b.subarray(0, 3).toString();
        const looksHex = /^[0-9a-f]{96}$/.test(plain.trim());
        layers.push({ i, len: b.length, head, looksHex, first64: plain.slice(0, 64) });
        if (looksHex) { layers.push({ finalSecret: plain.trim() }); break; }
        data = b;
      } catch (e) {
        layers.push({ i, decryptError: e.message });
        break;
      }
    }
    return JSON.stringify(layers);
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log('LAYERS:', r.result?.result?.value ?? JSON.stringify(r, null, 2));
  sock.close();
  spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  await new Promise((r2) => setTimeout(r2, 1500));
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
