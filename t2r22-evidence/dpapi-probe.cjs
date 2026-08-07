// DPAPI round-trip probe via safeStorage.
// Usage: electron dpapi-probe.cjs <file> enc|dec
const { app, safeStorage } = require('electron');
const fs = require('fs');

const p = process.argv[2];
const mode = process.argv[3];

app.whenReady().then(() => {
  console.log('encryptionAvailable =', safeStorage.isEncryptionAvailable());
  try {
    if (mode === 'enc') {
      const v = 't2r22-dpapi-probe-secret-0123456789abcdef';
      fs.writeFileSync(p, safeStorage.encryptString(v));
      console.log('ENC OK, bytes =', fs.readFileSync(p).length, 'prefix =', fs.readFileSync(p).subarray(0, 3).toString());
    } else {
      const plain = safeStorage.decryptString(fs.readFileSync(p));
      console.log('DEC OK, len =', plain.length, 'head =', plain.slice(0, 12));
    }
  } catch (e) {
    console.log('FAIL:', e.message);
  }
  app.exit(0);
});
