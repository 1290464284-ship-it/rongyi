// Verify IPC guard behavior in packaged app with hash routing.
// Usage: node ver-ipc.cjs <userDataDir>
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];

async function main() {
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1' },
    args: [`--user-data-dir=${ud}`],
  });
  const win = await app.firstWindow();
  await win.waitForTimeout(4000);
  const boot = await win.evaluate(() => ({ href: location.href, text: (document.body.innerText || '').slice(0, 200) }));
  console.log('--- boot state ---');
  console.log(JSON.stringify(boot, null, 2));
  await win.waitForSelector('form.login-card', { timeout: 30000 });
  console.log('--- before login ---');
  const pre = await win.evaluate(async () => {
    const out = { href: location.href };
    try { out.secretsGet = await window.desktop.secrets.get('v2.token'); } catch (e) { out.secretsGetErr = String(e); }
    try { out.secretsSet = await window.desktop.secrets.set('v2.token', 'probe'); } catch (e) { out.secretsSetErr = String(e); }
    try { out.apiPort = await window.desktop.getApiPort(); } catch (e) { out.apiPortErr = String(e); }
    try { out.checkUpdates = await window.desktop.checkUpdates(); } catch (e) { out.checkUpdatesErr = String(e); }
    return out;
  });
  console.log(JSON.stringify(pre, null, 2));

  // login
  await win.fill('form.login-card input >> nth=0', 'admin');
  await win.fill('form.login-card input >> nth=1', 'REDACTED');
  await win.click('form.login-card button');
  await win.waitForSelector('h1:has-text("工作台")', { timeout: 30000 });
  console.log('--- after login ---');
  const post = await win.evaluate(async () => {
    const out = { href: location.href };
    try { out.secretsGet = (await window.desktop.secrets.get('v2.token') ?? '').slice(0, 12); } catch (e) { out.secretsGetErr = String(e); }
    try { out.secretsSet = await window.desktop.secrets.set('v2.token', 'after-login'); } catch (e) { out.secretsSetErr = String(e); }
    return out;
  });
  console.log(JSON.stringify(post, null, 2));

  // reload → does the session survive (persistence test)?
  await win.reload();
  await win.waitForSelector('form.login-card, h1', { timeout: 30000 });
  const afterReload = await win.evaluate(() => ({
    href: location.href,
    loginVisible: !!document.querySelector('form.login-card'),
    bodyText: (document.body.innerText || '').slice(0, 80),
  }));
  console.log('--- after reload ---');
  console.log(JSON.stringify(afterReload, null, 2));

  await app.close();
  console.log('VER-DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
