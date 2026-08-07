// Inspect the main-process environment when launched via Playwright,
// and test safeStorage round-trip + decrypt of a pre-existing file.
// Usage: node envprobe.cjs <userDataDir> <secretFileToDecrypt>
const { _electron } = require('D:/Desktop/rongyi/source/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');

const EXE = 'D:/Desktop/rongyi/source/apps/v2/release-v2/win-unpacked/Dental Clinic V2.exe';
const ud = process.argv[2];
const target = process.argv[3];

async function main() {
  const app = await _electron.launch({
    executablePath: EXE,
    env: { ...process.env, V2_DISABLE_AUTO_UPDATE: '1', T2R22_TARGET: target },
    args: [`--user-data-dir=${ud}`],
  });
  const info = await app.evaluate(async ({ app: electronApp, safeStorage }) => {
    const nodeProcess = require('node:process');
    const fs = require('node:fs');
    const out = {};
    out.argv = nodeProcess.argv.slice(1);
    out.electronEnv = Object.fromEntries(
      Object.entries(nodeProcess.env).filter(([k]) => /ELECTRON|PLAYWRIGHT|T2R22|NODE_OPTIONS|USERPROFILE|APPDATA/i.test(k)),
    );
    out.encAvail = safeStorage.isEncryptionAvailable();
    try {
      const c = safeStorage.encryptString('roundtrip-value-0123456789');
      out.rtEncLen = Buffer.from(c).length;
      out.rtDec = safeStorage.decryptString(c);
    } catch (e) { out.rtErr = String(e); }
    const t = nodeProcess.env.T2R22_TARGET;
    try {
      const data = fs.readFileSync(t);
      out.fileLen = data.length;
      out.filePrefix = data.subarray(0, 3).toString();
      const plain = safeStorage.decryptString(data);
      out.fileDecOk = true;
      out.fileDecHead = plain.slice(0, 12);
    } catch (e) { out.fileDecErr = String(e); }
    return out;
  });
  console.log(JSON.stringify(info, null, 2));
  await app.close();
  console.log('ENVPROBE DONE');
}

main().catch((e) => { console.error('FAILED', e); process.exit(1); });
