// Item 3 scenario B: copied win-unpacked with publisherName + local generic provider.
// Expect: update found (9.9.9) -> autoDownload -> ERR_UPDATER_INVALID_SIGNATURE error text.
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const EXE = 'C:/Users/Administrator/AppData/Local/Temp/upd-b/Dental Clinic V2.exe';
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
  await win.evaluate(() => { window.location.hash = '#/system'; });
  await win.waitForSelector('h1:has-text("系统管理")', { timeout: 20000 });
  await win.waitForTimeout(1200);
  await win.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter((e) => e.textContent === '桌面端');
    if (els[0]) els[0].click();
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(ev, 'b-desktop-page.png') });

  const btn = win.locator('button:has-text("检查更新")');
  const btnCount = await btn.count();
  console.log('check-update button count:', btnCount);
  if (btnCount > 0) await btn.first().click({ timeout: 8000 });

  const snapshots = [];
  for (let i = 0; i < 25; i++) {
    const txt = await win.evaluate(() => {
      const all = (document.body.innerText || '').replace(/\n+/g, ' | ');
      const statusZone = all.slice(-400);
      const toast = [...document.querySelectorAll('.ant-message-notice, .ant-notification-notice, [role="alert"]')]
        .map((e) => e.textContent.trim()).filter(Boolean);
      return { zone: statusZone, toast };
    });
    snapshots.push(txt);
    await win.waitForTimeout(1000);
  }
  const hits = snapshots
    .map((s, i) => ({ i, zone: s.zone, toast: s.toast }))
    .filter((s) => /9\.9\.9|新版本|下载|签名|SIGNATURE|错误|失败|不是|owner/i.test(JSON.stringify(s)));
  console.log('SNAPSHOT HITS:', JSON.stringify(hits, null, 1).slice(0, 3000));
  await win.screenshot({ path: path.join(ev, 'b-final.png') });
  console.log('--- console (update-related) ---');
  logs.filter((l) => /update|更新|签名|signature|error|untrusted/i.test(l)).slice(0, 25).forEach((l) => console.log(l));
  await app.close();
  console.log('ITEM3B DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
