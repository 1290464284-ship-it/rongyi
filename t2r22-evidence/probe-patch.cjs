// Patch safeStorage functions via CDP to observe what the IPC handler actually sees.
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const http = require('node:http');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];
const PORT = 9337;

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
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      console.log('MAIN-LOG:', args.slice(0, 300));
      return;
    }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const id = ++idc;
    pending.set(id, resolve);
    sock.send(JSON.stringify({ id, method, params }));
  });

  await send('Runtime.enable', {});
  const patch = `(() => {
    const origHas = Set.prototype.has;
    const origS = String;
    Set.prototype.has = function (v) {
      const r = origHas.call(this, v);
      try {
        const sv = origS(v);
        if (sv.includes('token') || sv.includes('refresh')) {
          console.log('[PATCH] Set.has(' + sv + ') -> ' + r + ' ; this.size=' + this.size + ' ; keys=[' + Array.from(this).join(',') + ']');
        }
      } catch (e) { console.log('[PATCH] Set.has inspect err', String(e)); }
      return r;
    };
    const { createRequire } = process.getBuiltinModule('module');
    const req = createRequire(process.cwd() + '/__probe__.cjs');
    const { safeStorage } = req('electron');
    const origA = safeStorage.isEncryptionAvailable.bind(safeStorage);
    const origE = safeStorage.encryptString.bind(safeStorage);
    const origD = safeStorage.decryptString.bind(safeStorage);
    safeStorage.isEncryptionAvailable = () => { const r = origA(); console.log('[PATCH] isEncryptionAvailable ->', r); return r; };
    safeStorage.encryptString = (v) => { try { const r = origE(v); console.log('[PATCH] encryptString OK len=', Buffer.from(r).length); return r; } catch (e) { console.log('[PATCH] encryptString ERR:', e.message); throw e; } };
    safeStorage.decryptString = (b) => { try { const r = origD(b); console.log('[PATCH] decryptString OK len=', Buffer.from(r).length); return r; } catch (e) { console.log('[PATCH] decryptString ERR:', e.message.slice(0,80)); throw e; } };
    return 'patched';
  })()`;
  const pr = await send('Runtime.evaluate', { expression: patch, returnByValue: true });
  console.log('PATCH RESULT:', pr.result?.result?.value ?? JSON.stringify(pr).slice(0, 200));

  const rend = await win.evaluate(async () => {
    const out = {};
    try { out.setRet = await window.desktop.secrets.set('v2.token', 'probe-patched-value-0123456789abcdef'); } catch (e) { out.setErr = String(e); }
    try { out.getRet = await window.desktop.secrets.get('v2.token'); } catch (e) { out.getErr = String(e); }
    return out;
  });
  console.log('RENDERER:', JSON.stringify(rend));
  sock.close();
  await app.close();
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
