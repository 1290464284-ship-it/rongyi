// Item 3 scenario A: manual "check updates" via UI (real app-update.yml, no publisherName).
// Expect: IPC not rejected (post-fix); offline/no-update => error or no-update toast.
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const userData = process.argv[2];
const ev = process.argv[3];
fs.mkdirSync(ev, { recursive: true });

async function main() {
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${userData}`],
  });
  const win = await app.firstWindow();
  const logs = [];
  win.on('console', (msg) => { logs.push(`[${msg.type()}] ${msg.text()}`); });
  const loginShown = await win.waitForSelector('form.login-card', { timeout: 8000 }).then(() => true).catch(() => false);
  if (loginShown) {
    await win.fill('form.login-card input >> nth=0', 'admin');
    await win.fill('form.login-card input >> nth=1', 'admin123');
    await win.click('form.login-card button');
  }
  await win.waitForSelector('h1:has-text("工作台")', { timeout: 30000 });

  // navigate to system -> desktop tab
  await win.evaluate(() => { window.location.hash = '#/system'; });
  await win.waitForSelector('h1:has-text("系统管理")', { timeout: 20000 });
  await win.waitForTimeout(1200);
  const tab = win.locator('text=桌面端');
  await tab.first().click({ timeout: 10000 }).catch(async () => {
    await win.evaluate(() => {
      const els = [...document.querySelectorAll('*')].filter((e) => e.textContent === '桌面端');
      const el = els[0];
      if (el) el.click();
    });
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(ev, 'desktop-settings-page.png') });

  // click 检查更新
  const btn = win.locator('button:has-text("检查更新")');
  const btnCount = await btn.count();
  console.log('check-update button count:', btnCount);
  let clicked = false;
  if (btnCount > 0) {
    await btn.first().click({ timeout: 8000 });
    clicked = true;
  }
  // direct IPC result (hard evidence that desktop:check-updates is not rejected post-fix)
  const direct = await win.evaluate(async () => {
    try {
      const r = await window.desktop.checkUpdates();
      return { ok: true, result: r };
    } catch (e) { return { ok: false, err: String(e) }; }
  });
  console.log('DIRECT checkUpdates IPC:', JSON.stringify(direct));
  await win.waitForTimeout(3000);
  const snapshots = [];
  for (let i = 0; i < 14; i++) {
    const txt = await win.evaluate(() => {
      const all = (document.body.innerText || '').replace(/\n+/g, ' | ');
      const toast = [...document.querySelectorAll('.ant-message-notice, .ant-notification-notice, [role="alert"]')]
        .map((e) => e.textContent.trim()).filter(Boolean);
      return { all: all.slice(-300), toast };
    });
    snapshots.push(txt);
    await win.waitForTimeout(1000);
  }
  const hits = snapshots
    .map((s, i) => ({ i, t: s.toast, tail: s.all }))
    .filter((s) => /更新|版本|失败|错误|不支持|最新|已是最新/i.test(JSON.stringify(s.t) + s.tail));
  console.log('SNAPSHOT HITS:', JSON.stringify(hits, null, 1).slice(0, 2000));
  await win.screenshot({ path: path.join(ev, 'check-updates-result.png') });
  const pageText = await win.evaluate(() => (document.body.innerText || '').replace(/\n+/g, ' | ').slice(0, 600));
  console.log('PAGE TEXT:', pageText.slice(0, 400));
  console.log('--- renderer console (relevant) ---');
  logs.filter((l) => /update|更新|error|untrusted/i.test(l)).slice(0, 20).forEach((l) => console.log(l));
  await app.close();
  console.log('ITEM3A DONE, clicked=' + clicked);
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
