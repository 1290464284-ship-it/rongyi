// GUI test 1+2: file:// renderer login, list/detail APIs (CORS), image load (CORP)
// Usage: node gui-1-2.mjs <appdataDir> <evidenceDir>
const { _electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const appdata = process.argv[2];
const ev = process.argv[3];
fs.mkdirSync(ev, { recursive: true });

const results = {};

async function main() {
  console.log('launching packaged app...');
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, APPDATA: appdata, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [],
  });
  results.appProcessPid = app.process().pid;
  const win = await app.firstWindow();
  const started = Date.now();
  await win.waitForSelector('form.login-card', { timeout: 60000 });
  results.loginPageMs = Date.now() - started;
  console.log('login page appeared after', results.loginPageMs, 'ms');
  await win.screenshot({ path: path.join(ev, '01-login-page.png') });
  console.log('URL:', win.url());

  // login
  await win.fill('form.login-card input >> nth=0', 'admin');
  await win.fill('form.login-card input >> nth=1', 'admin123');
  await win.click('form.login-card button');
  await win.waitForSelector('h1:has-text("工作台")', { timeout: 30000 });
  await win.screenshot({ path: path.join(ev, '02-dashboard.png') });
  console.log('dashboard loaded');

  // navigate to patients list via hash
  await win.evaluate(() => { window.location.hash = '#/patients'; });
  await win.waitForSelector('h1:has-text("患者档案")', { timeout: 20000 });
  await win.waitForTimeout(2500); // let table fetch settle
  await win.screenshot({ path: path.join(ev, '03-patients-list.png') });
  console.log('patients list page loaded');

  // CORS: raw fetch from file:// renderer to API
  const cors = await win.evaluate(async () => {
    const out = {};
    const desktop = window.desktop;
    const port = await desktop.getApiPort();
    const origin = `http://127.0.0.1:${port}`;
    out.apiPort = port;
    const token = await desktop.secrets.get('v2.token');
    out.tokenPresent = Boolean(token) && token.length > 20;
    const headers = { Authorization: `Bearer ${token}` };
    // list
    try {
      const res = await fetch(`${origin}/api/v2/patients?page=1&pageSize=20`, { headers });
      out.listStatus = res.status;
      out.listAcao = res.headers.get('access-control-allow-origin');
      const body = await res.json();
      out.listSuccess = body.success;
      out.listCount = body.data?.items?.length ?? body.data?.length ?? null;
      out.firstPatient = body.data?.items?.[0] ?? body.data?.[0] ?? null;
    } catch (e) { out.listError = String(e); }
    // detail (use first patient id)
    const pid = out.firstPatient?.id;
    if (pid) {
      try {
        const res = await fetch(`${origin}/api/v2/patients/${pid}`, { headers });
        out.detailStatus = res.status;
        out.detailAcao = res.headers.get('access-control-allow-origin');
        const body = await res.json();
        out.detailSuccess = body.success;
        out.detailId = body.data?.id;
      } catch (e) { out.detailError = String(e); }
    }
    // appointments list too
    try {
      const res = await fetch(`${origin}/api/v2/appointments?page=1&pageSize=20`, { headers });
      const body = await res.json();
      out.apptStatus = res.status;
      out.apptCount = body.data?.items?.length ?? null;
    } catch (e) { out.apptError = String(e); }
    return out;
  });
  results.cors = cors;
  console.log('CORS results:', JSON.stringify(cors, null, 2));

  // CORP: upload a 1x1 png then load it as <img> from file:// page
  const corp = await win.evaluate(async () => {
    const out = {};
    const desktop = window.desktop;
    const port = await desktop.getApiPort();
    const origin = `http://127.0.0.1:${port}`;
    const token = await desktop.secrets.get('v2.token');
    const headers = { Authorization: `Bearer ${token}` };
    // 1x1 red png
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    try {
      const up = await fetch(`${origin}/api/v2/files`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'image/png', 'X-File-Name': 'corp-test.png' },
        body: bytes,
      });
      out.uploadStatus = up.status;
      const upBody = await up.json();
      out.fileUrl = upBody.data?.url;
      out.fileId = upBody.data?.id;
      if (out.fileUrl) {
        // load via <img> (CORP-sensitive: no CORS needed for <img>, CORP must allow cross-origin)
        const loaded = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ ok: false });
          img.src = origin + out.fileUrl;
        });
        out.img = loaded;
      }
    } catch (e) { out.uploadError = String(e); }
    return out;
  });
  results.corp = corp;
  console.log('CORP results:', JSON.stringify(corp, null, 2));

  // screenshot with the loaded image rendered on page
  await win.evaluate(() => {
    const img = document.createElement('img');
    img.id = 'corp-img';
    img.style.cssText = 'position:fixed;bottom:8px;right:8px;width:64px;height:64px;border:2px solid lime;z-index:99999;';
    document.body.appendChild(img);
  });
  await win.screenshot({ path: path.join(ev, '04-corp-image.png') });

  await app.close();
  fs.writeFileSync(path.join(ev, 'results-1-2.json'), JSON.stringify(results, null, 2));
  console.log('DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
