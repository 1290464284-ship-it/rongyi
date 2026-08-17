import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface SecretsModule {
  getOrCreateSecret(fileName?: string): string | undefined;
  secretPath(key: string): string;
}

describe('electron secrets', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('validates secret keys and rejects path separators', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secrets-test-'));
    const electron = {
      app: { getPath: () => tempDir },
      dialog: {},
      safeStorage: { isEncryptionAvailable: () => true },
    };
    const mod = loadElectronModule<SecretsModule>('../../../electron/secrets.cjs', { electron });
    expect(mod.secretPath('v2.token')).toBe(path.join(tempDir, 'secrets', 'v2.token.enc'));
    expect(() => mod.secretPath('../escape')).toThrow('Invalid secret key');
    expect(() => mod.secretPath('a/b')).toThrow('Invalid secret key');
  });

  it('creates and reuses a secret', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secrets-test-'));
    const electron = {
      app: { getPath: () => tempDir },
      dialog: {},
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
        decryptString: (buffer: Buffer) => buffer.toString('utf8').slice(4),
      },
    };
    const mod = loadElectronModule<SecretsModule>('../../../electron/secrets.cjs', { electron });
    const first = mod.getOrCreateSecret();
    const second = mod.getOrCreateSecret();
    expect(first).toHaveLength(96);
    expect(second).toBe(first);
    expect(fs.existsSync(path.join(tempDir, 'secrets', 'jwt-secret'))).toBe(true);
  });

  it('migrates an existing plaintext secret when safeStorage is available', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secrets-test-'));
    const plain = 'a'.repeat(64);
    const secretsDir = path.join(tempDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.writeFileSync(path.join(secretsDir, 'jwt-secret'), plain, 'utf8');
    const decryptString = vi.fn().mockImplementation(() => {
      throw new Error('cannot decrypt');
    });
    const electron = {
      app: { getPath: () => tempDir },
      dialog: {},
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value: string) => Buffer.from(`enc:${value}`),
        decryptString,
      },
    };
    const mod = loadElectronModule<SecretsModule>('../../../electron/secrets.cjs', { electron });
    expect(mod.getOrCreateSecret()).toBe(plain);
    expect(fs.readFileSync(path.join(secretsDir, 'jwt-secret')).toString('utf8').startsWith('enc:')).toBe(true);
  });

  it('fails closed when safeStorage is unavailable: session-only jwt and no backup key on disk', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secrets-test-'));
    const electron = {
      app: { getPath: () => tempDir },
      dialog: { showMessageBoxSync: vi.fn() },
      safeStorage: { isEncryptionAvailable: () => false },
    };
    const mod = loadElectronModule<SecretsModule>('../../../electron/secrets.cjs', { electron });
    const jwt = mod.getOrCreateSecret();
    expect(jwt).toHaveLength(96);
    // 绝不落盘明文
    expect(fs.existsSync(path.join(tempDir, 'secrets', 'jwt-secret'))).toBe(false);
    // 备份密钥不生成（返回 undefined → secret 文件省略该键，API 拒绝创建备份）
    expect(mod.getOrCreateSecret('backup-key')).toBeUndefined();
    expect(fs.existsSync(path.join(tempDir, 'secrets', 'backup-key'))).toBe(false);
    // 会话内不持久化：再次调用得到新的随机密钥
    expect(mod.getOrCreateSecret()).not.toBe(jwt);
  });
});
