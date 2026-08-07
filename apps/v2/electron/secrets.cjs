const { app, safeStorage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function isUsablePlainSecret(plain) {
  return typeof plain === 'string' && plain.length >= 32 && !/[\u0000-\u001f\u007f]/.test(plain);
}

function getOrCreateSecret(fileName = 'jwt-secret') {
  const secretsDir = path.join(app.getPath('userData'), 'secrets');
  const secretPath = path.join(secretsDir, fileName);
  fs.mkdirSync(secretsDir, { recursive: true });
  try {
    const existing = fs.readFileSync(secretPath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const plain = safeStorage.decryptString(existing);
        if (plain.length >= 32) return plain;
      } catch {
        // 解密失败：可能是 safeStorage 引入前的旧明文文件，也可能是损坏/后端翻转的密文。
        // 仅当内容是可用明文时才视为旧明文并重新加密；否则删除重新生成——
        // 把二进制密文当明文回传会让 JWT 密钥含 NUL 字节，spawn 环境校验失败。
        const plain = existing.toString('utf8').trim();
        if (isUsablePlainSecret(plain)) {
          fs.writeFileSync(secretPath, safeStorage.encryptString(plain), { mode: 0o600 });
          return plain;
        }
        console.warn(`secret file ${fileName} is unreadable or corrupt; regenerating`);
        fs.rmSync(secretPath, { force: true });
      }
    } else {
      const plain = existing.toString('utf8').trim();
      if (isUsablePlainSecret(plain)) return plain;
      console.warn(`secret file ${fileName} is unreadable or corrupt; regenerating`);
      fs.rmSync(secretPath, { force: true });
    }
  } catch {
    // first run or unreadable secret; create a fresh one below
  }
  // R2-P1-13: 重生成 backup-key 会让既有 .enc 备份永久不可解密，须显式告知。
  if (fileName === 'backup-key') {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    try {
      if (fs.existsSync(backupDir) && fs.readdirSync(backupDir).some((name) => name.endsWith('.enc'))) {
        console.warn('backup-key regenerated: existing encrypted backups cannot be decrypted with the new key');
        dialog.showMessageBoxSync({
          type: 'warning',
          title: '备份密钥已更换',
          message: '检测到备份密钥文件丢失或损坏，系统已生成新密钥。',
          detail: '此前创建的加密备份（.enc）将无法用新密钥解密。如需恢复旧备份，请从备份中还原原密钥文件，或保留旧密钥文件后重启。',
          buttons: ['我知道了'],
        });
      }
    } catch {
      // best effort: 目录不可读时静默跳过，不阻塞启动
    }
  }
  const secret = crypto.randomBytes(48).toString('hex');
  const encrypted = safeStorage.isEncryptionAvailable();
  fs.writeFileSync(secretPath, encrypted ? safeStorage.encryptString(secret) : secret, { mode: 0o600 });
  if (!encrypted) console.warn('safeStorage unavailable; secrets stored in plaintext');
  return secret;
}

function secretPath(key) {
  // T2R-22: 白名单 key 形如 'v2.token' / 'v2.refreshToken'（含点号），原字符集
  // [a-zA-Z0-9_-] 会把它们全部判为非法 → get/set/delete 静默失败，safeStorage
  // 令牌持久化形同虚设（每次启动须重登）。放行 '.' 且仍禁止 '/' '\' 等路径分隔符。
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) throw new Error('Invalid secret key');
  const secretsDir = path.join(app.getPath('userData'), 'secrets');
  return path.join(secretsDir, `${key}.enc`);
}


module.exports = { getOrCreateSecret, secretPath };
