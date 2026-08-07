// Same-instance second-by-second safeStorage availability + set result
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const http = require('node:http');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];
const PORT = 9335;

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

  for (let i = 0; i < 10; i++) {
    const expr = `(() => {
      const { createRequire } = process.getBuiltinModule('module');
      const req = createRequire(process.cwd() + '/__probe__.cjs');
      const { safeStorage } = req('electron');
      let rt = 'n/a';
      try {
        const c = safeStorage.encryptString('x');
        rt = safeStorage.decryptString(c) === 'x' ? 'ok' : 'bad';
      } catch (e) { rt = 'ERR:' + e.message.slice(0, 60); }
      return JSON.stringify({ encAvail: safeStorage.isEncryptionAvailable(), rt });
    })()`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    let mainState = '?';
    try { mainState = r.result?.result?.value ?? JSON.stringify(r.result); } catch { mainState = JSON.stringify(r).slice(0, 120); }
    let setRet = '?';
    try { setRet = JSON.stringify(await win.evaluate(() => window.desktop.secrets.set('probe.flip', 'v'))); } catch (e) { setRet = 'ERR:' + String(e).slice(0, 80); }
    console.log(`t+${i}s  main=${mainState}  rendererSet=${setRet}`);
    await new Promise((r2) => setTimeout(r2, 1000));
  }
  sock.close();
  await app.close();
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
