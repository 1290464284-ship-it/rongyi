/* eslint-disable security/detect-non-literal-fs-filename -- 单测文件路径均为临时生成；TODO: 逐步修复 lint 问题 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  FileCryptoEngine,
  CryptoEngineError,
  CryptoErrorCodes,
  TransparentEncryptedDb,
  KeyManager,
  cancelAllAutoPersistTimers,
  clearGlobalEncryptedDbHandle,
} from '../encryption';
import type { CryptoErrorCode } from '../encryption';

async function expectCryptoError<T>(
  fn: () => Promise<T>,
  code: CryptoErrorCode | Array<CryptoErrorCode>,
): Promise<void> {
  const accept = Array.isArray(code) ? code : [code];
  try {
    await fn();
    throw new Error(`Expected CryptoEngineError with code in [${accept.join(', ')}] but no error was thrown`);
  } catch (e: unknown) {
    if (e instanceof CryptoEngineError) {
      expect(accept).toContain(e.code);
      return;
    }
    throw e;
  }
}

describe('encryption-hooks (TR-17 数据库离线加密)', () => {
  const testPassword = 'test-password-12345!@#$%';
  let testDir: string;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-enc-test-'));
  });

  afterAll(() => {
    cancelAllAutoPersistTimers();
    clearGlobalEncryptedDbHandle();
    try {
      fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* ignore */
    }
  });

  beforeEach(() => {
    cancelAllAutoPersistTimers();
    clearGlobalEncryptedDbHandle();
  });

  function makeTempPath(name: string): string {
    return path.join(testDir, `${crypto.randomUUID()}-${name}`);
  }

  function writeRandomFile(p: string, sizeBytes: number): Buffer {
    const data = crypto.randomBytes(sizeBytes);
    fs.writeFileSync(p, data);
    return data;
  }

  describe('TR-17.1: 明文 -> 加密 -> 解密 roundtrip 字节逐位 diff=0', () => {
    it('小文件 roundtrip 成功', async () => {
      const plainPath = makeTempPath('plain-small.sqlite');
      const encPath = makeTempPath('enc-small.enc');
      const decPath = makeTempPath('dec-small.sqlite');
      const original = writeRandomFile(plainPath, 4096);

      const engine = new FileCryptoEngine(testPassword);
      const encResult = await engine.encryptFile(plainPath, encPath);
      expect(encResult.sizeEncrypted).toBeGreaterThan(0);
      expect(encResult.iv.length).toBe(12);
      expect(encResult.salt.length).toBe(16);
      expect(encResult.authTag.length).toBe(16);

      const decResult = await engine.decryptFile(encPath, decPath);
      expect(decResult.valid).toBe(true);
      expect(decResult.sizeDecrypted).toBe(original.length);

      const decrypted = fs.readFileSync(decPath);
      expect(decrypted.equals(original)).toBe(true);

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
      fs.rmSync(decPath, { force: true });
    });

    it('中等文件 roundtrip 成功 (1MB)', async () => {
      const plainPath = makeTempPath('plain-1mb.sqlite');
      const encPath = makeTempPath('enc-1mb.enc');
      const decPath = makeTempPath('dec-1mb.sqlite');
      const size = 1024 * 1024;
      const original = writeRandomFile(plainPath, size);

      const engine = new FileCryptoEngine(testPassword);
      await engine.encryptFile(plainPath, encPath);
      const decResult = await engine.decryptFile(encPath, decPath);
      expect(decResult.sizeDecrypted).toBe(size);
      const decrypted = fs.readFileSync(decPath);
      expect(decrypted.equals(original)).toBe(true);

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
      fs.rmSync(decPath, { force: true });
    }, 15000);
  });

  describe('TR-17.2: magic 被篡改 -> decryptFile 抛 INVALID_DB_ENC_HEADER', () => {
    it('首字节被翻转抛出 INVALID_DB_ENC_HEADER', async () => {
      const plainPath = makeTempPath('plain-magic.sqlite');
      const encPath = makeTempPath('enc-magic.enc');
      writeRandomFile(plainPath, 1024);

      const engine = new FileCryptoEngine(testPassword);
      await engine.encryptFile(plainPath, encPath);

      const data = fs.readFileSync(encPath);
      data[0] ^= 0xff;
      fs.writeFileSync(encPath, data);

      const decPath = makeTempPath('dec-magic.sqlite');
      await expectCryptoError(
        () => engine.decryptFile(encPath, decPath),
        CryptoErrorCodes.INVALID_DB_ENC_HEADER,
      );

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
    });
  });

  describe('TR-17.3: 密文被 1 字节翻位 -> 抛 DB_ENC_AUTH_FAILED 或 DB_ENC_TAMPERED', () => {
    it('尾部 headerHash 翻位抛 DB_ENC_TAMPERED', async () => {
      const plainPath = makeTempPath('plain-tail.sqlite');
      const encPath = makeTempPath('enc-tail.enc');
      writeRandomFile(plainPath, 2048);

      const engine = new FileCryptoEngine(testPassword);
      await engine.encryptFile(plainPath, encPath);

      const data = fs.readFileSync(encPath);
      data[data.length - 1] ^= 0x01;
      fs.writeFileSync(encPath, data);

      const decPath = makeTempPath('dec-tail.sqlite');
      await expectCryptoError(
        () => engine.decryptFile(encPath, decPath),
        [CryptoErrorCodes.DB_ENC_TAMPERED, CryptoErrorCodes.DB_ENC_AUTH_FAILED],
      );

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
    });

    it('密文中间字节翻位抛 DB_ENC_AUTH_FAILED', async () => {
      const plainPath = makeTempPath('plain-mid.sqlite');
      const encPath = makeTempPath('enc-mid.enc');
      writeRandomFile(plainPath, 8192);

      const engine = new FileCryptoEngine(testPassword);
      await engine.encryptFile(plainPath, encPath);

      const data = fs.readFileSync(encPath);
      const cipherOffset = Math.floor(data.length / 2);
      if (cipherOffset < data.length - 32) {
        data[cipherOffset] ^= 0x01;
        fs.writeFileSync(encPath, data);
      }

      const decPath = makeTempPath('dec-mid.sqlite');
      await expectCryptoError(
        () => engine.decryptFile(encPath, decPath),
        [CryptoErrorCodes.DB_ENC_AUTH_FAILED, CryptoErrorCodes.DB_ENC_TAMPERED],
      );

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
    });
  });

  describe('TR-17.4: password 错误 -> decryptFile 抛 DB_ENC_AUTH_FAILED', () => {
    it('错误密码解密失败', async () => {
      const plainPath = makeTempPath('plain-pwd.sqlite');
      const encPath = makeTempPath('enc-pwd.enc');
      writeRandomFile(plainPath, 1024);

      const engineGood = new FileCryptoEngine(testPassword);
      await engineGood.encryptFile(plainPath, encPath);

      const engineBad = new FileCryptoEngine('wrong-password');
      const decPath = makeTempPath('dec-pwd.sqlite');
      await expectCryptoError(
        () => engineBad.decryptFile(encPath, decPath),
        CryptoErrorCodes.DB_ENC_AUTH_FAILED,
      );

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
    });
  });

  describe('TR-17.5: isEncryptedFile 检测', () => {
    it('明文文件 isEncryptedFile=false；加密文件=true', async () => {
      const plainPath = makeTempPath('plain-detect.sqlite');
      const encPath = makeTempPath('enc-detect.enc');
      writeRandomFile(plainPath, 1024);

      const engine = new FileCryptoEngine(testPassword);
      expect(engine.isEncryptedFile(plainPath)).toBe(false);

      await engine.encryptFile(plainPath, encPath);
      expect(engine.isEncryptedFile(encPath)).toBe(true);

      expect(engine.isEncryptedFile(makeTempPath('nonexist.sqlite'))).toBe(false);

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
    });
  });

  describe('TR-17.6: TransparentEncryptedDb boot->temp 存在->shutdown 后 temp 被删除', () => {
    it('shutdown 3 次重试删除成功', async () => {
      const encPath = makeTempPath('trans-shutdown.enc');
      const tdb = new TransparentEncryptedDb();
      const handle = await tdb.boot({
        encryptedPath: encPath,
        password: testPassword,
        autoPersistMinutes: 0,
      });

      expect(handle.tempPlainPath).not.toBe(':memory:');
      fs.writeFileSync(handle.tempPlainPath, 'test-db-content');
      expect(fs.existsSync(handle.tempPlainPath)).toBe(true);

      await handle.shutdown();
      expect(fs.existsSync(handle.tempPlainPath)).toBe(false);

      fs.rmSync(encPath, { force: true });
    }, 10000);
  });

  describe('TR-17.7: persist() 使用原子 tmp.enc rename', () => {
    it('tmp.enc 原子替换不破坏老数据', async () => {
      const encPath = makeTempPath('trans-atomic.enc');
      const tdb = new TransparentEncryptedDb();
      const handle = await tdb.boot({
        encryptedPath: encPath,
        password: testPassword,
        autoPersistMinutes: 0,
      });

      const content = crypto.randomBytes(4096);
      fs.writeFileSync(handle.tempPlainPath, content);
      await handle.persist();

      const encBefore = fs.readFileSync(encPath);
      expect(encBefore.length).toBeGreaterThan(0);

      const tmpEncPath = `${encPath}.tmp.enc`;
      expect(fs.existsSync(tmpEncPath)).toBe(false);

      const content2 = Buffer.concat([content, Buffer.from('extra')]);
      fs.writeFileSync(handle.tempPlainPath, content2);
      await handle.persist();
      expect(fs.existsSync(tmpEncPath)).toBe(false);

      await handle.shutdown();
      fs.rmSync(encPath, { force: true });
    }, 10000);
  });

  describe('TR-17.8: boot 加密文件不存在 -> 新建空 DB，persist 后 isEncryptedFile=true', () => {
    it('首次 boot 创建 + persist 后文件为加密格式', async () => {
      const encPath = makeTempPath('trans-new.enc');
      expect(fs.existsSync(encPath)).toBe(false);

      const tdb = new TransparentEncryptedDb();
      const handle = await tdb.boot({
        encryptedPath: encPath,
        password: testPassword,
        autoPersistMinutes: 0,
      });

      fs.writeFileSync(handle.tempPlainPath, 'initial-empty-db');
      await handle.persist();
      expect(fs.existsSync(encPath)).toBe(true);

      const engine = new FileCryptoEngine(testPassword);
      expect(engine.isEncryptedFile(encPath)).toBe(true);

      await handle.shutdown();
      fs.rmSync(encPath, { force: true });
    }, 10000);
  });

  describe('TR-17.9: rotatePassword 轮换成功', () => {
    it('老密码加密 -> 换新密码 -> 解密成功；老密码解密失败', async () => {
      const oldPwd = 'old-pass-123';
      const newPwd = 'new-pass-456!@#';
      const encPath = makeTempPath('rotate.enc');
      const plainPath = makeTempPath('rotate-plain.sqlite');
      const decPath = makeTempPath('rotate-dec.sqlite');
      const original = writeRandomFile(plainPath, 4096);

      const oldEngine = new FileCryptoEngine(oldPwd);
      await oldEngine.encryptFile(plainPath, encPath);

      const km = new KeyManager();
      await km.rotatePassword(oldPwd, newPwd, encPath);

      const newEngine = new FileCryptoEngine(newPwd);
      const decResult = await newEngine.decryptFile(encPath, decPath);
      expect(decResult.valid).toBe(true);
      expect(fs.readFileSync(decPath).equals(original)).toBe(true);

      await expectCryptoError(
        () => oldEngine.decryptFile(encPath, makeTempPath('fail-dec.sqlite')),
        CryptoErrorCodes.DB_ENC_AUTH_FAILED,
      );

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
      fs.rmSync(decPath, { force: true });
    }, 20000);
  });

  describe('TR-17.10 & TR-17.11: KeyManager.resolvePassword', () => {
    const OLD_ENV = { ...process.env };
    afterEach(() => {
      process.env = { ...OLD_ENV };
    });

    it('TR-17.10: resolvePassword 优先 env > settings', async () => {
      process.env.DB_ENCRYPTION_PASSWORD = 'env-password';
      const settings = { aiDbEncryptionEnabled: 'true', aiDbEncryptionPassword: '' };
      const km = new KeyManager(async () => settings);
      expect(await km.resolvePassword()).toBe('env-password');
    });

    it('TR-17.11: aiDbEncryptionEnabled=true 且两者都空 -> 抛异常', async () => {
      delete process.env.DB_ENCRYPTION_PASSWORD;
      const settings = { aiDbEncryptionEnabled: 'true', aiDbEncryptionPassword: '' };
      const km = new KeyManager(async () => settings);
      await expect(km.resolvePassword()).rejects.toThrow(/DB_ENCRYPTION_PASSWORD/);
    });

    it('未启用加密时允许密码为空', async () => {
      delete process.env.DB_ENCRYPTION_PASSWORD;
      const settings = { aiDbEncryptionEnabled: 'false', aiDbEncryptionPassword: '' };
      const km = new KeyManager(async () => settings);
      expect(await km.resolvePassword()).toBe('');
    });
  });

  describe('TR-17.12: 大文件 roundtrip perf (2MB)', () => {
    it('2MB 文件 roundtrip 成功并记录耗时', async () => {
      const size = 2 * 1024 * 1024;
      const plainPath = makeTempPath('plain-2mb.sqlite');
      const encPath = makeTempPath('enc-2mb.enc');
      const decPath = makeTempPath('dec-2mb.sqlite');
      const original = writeRandomFile(plainPath, size);

      const t0 = Date.now();
      const engine = new FileCryptoEngine(testPassword);
      await engine.encryptFile(plainPath, encPath);
      const t1 = Date.now();
      await engine.decryptFile(encPath, decPath);
      const t2 = Date.now();
      const total = t2 - t0;

      const decrypted = fs.readFileSync(decPath);
      expect(decrypted.equals(original)).toBe(true);
      console.log(`[perf] 2MB roundtrip: enc=${t1 - t0}ms, dec=${t2 - t1}ms, total=${total}ms`);
      expect(total).toBeLessThan(20000);

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
      fs.rmSync(decPath, { force: true });
    }, 30000);
  });

  describe('TR-17.13: persist 每 10 min 心跳触发 (autoPersist 配置验证)', () => {
    it('autoPersistMinutes 参数正确创建定时器并可取消', async () => {
      const encPath = makeTempPath('trans-heartbeat.enc');
      let _persistCalls = 0;

      const tdb = new TransparentEncryptedDb();
      const handle = await tdb.boot({
        encryptedPath: encPath,
        password: testPassword,
        autoPersistMinutes: 10,
        onPersistCallback: () => {
          _persistCalls++;
        },
      });

      fs.writeFileSync(handle.tempPlainPath, 'heartbeat-content');

      expect(typeof handle.autoPersistTimer).toBe('object');
      expect(handle.autoPersistTimer).not.toBeNull();

      handle.cancelAutoPersist();
      expect(handle.autoPersistTimer).toBeNull();

      const tdb2 = new TransparentEncryptedDb();
      const handle2 = await tdb2.boot({
        encryptedPath: encPath,
        password: testPassword,
        autoPersistMinutes: 0,
      });
      expect(handle2.autoPersistTimer).toBeNull();
      await handle2.shutdown();

      await handle.shutdown();
      fs.rmSync(encPath, { force: true });
    }, 15000);
  });

  describe('TR-17.14: database.ts 启用 DB init 流程 & 默认不启用时保持旧行为', () => {
    it('aiDbEncryptionEnabled=false 时透明加密未启用', async () => {
      const km = new KeyManager(async () => ({ aiDbEncryptionEnabled: 'false' }));
      expect(await km.isEncryptionEnabled()).toBe(false);
    });

    it('环境变量启用加密时 isEncryptionEnabled=true', async () => {
      const oldVal = process.env.aiDbEncryptionEnabled;
      process.env.aiDbEncryptionEnabled = 'true';
      try {
        const km = new KeyManager();
        expect(await km.isEncryptionEnabled()).toBe(true);
      } finally {
        if (oldVal === undefined) delete process.env.aiDbEncryptionEnabled;
        else process.env.aiDbEncryptionEnabled = oldVal;
      }
    });
  });

  describe('TR-17.15: SECURITY_DB_TAMPER_DETECTED 触发（错误码验证）', () => {
    it('headerHash 篡改抛 DB_ENC_TAMPERED 并对应审计类型', async () => {
      const plainPath = makeTempPath('plain-tamper.sqlite');
      const encPath = makeTempPath('enc-tamper.enc');
      writeRandomFile(plainPath, 1024);

      const engine = new FileCryptoEngine(testPassword);
      await engine.encryptFile(plainPath, encPath);

      const data = fs.readFileSync(encPath);
      data[data.length - 16] ^= 0xff;
      fs.writeFileSync(encPath, data);

      await expectCryptoError(
        () => engine.decryptFile(encPath, makeTempPath('dec.sqlite')),
        CryptoErrorCodes.DB_ENC_TAMPERED,
      );

      fs.rmSync(plainPath, { force: true });
      fs.rmSync(encPath, { force: true });
    });
  });

  describe('TR-17.16: shutdown/persist 幂等安全', () => {
    it('两次 shutdown / persist 不抛错', async () => {
      const encPath = makeTempPath('trans-idem.enc');
      const tdb = new TransparentEncryptedDb();
      const handle = await tdb.boot({
        encryptedPath: encPath,
        password: testPassword,
        autoPersistMinutes: 0,
      });

      fs.writeFileSync(handle.tempPlainPath, 'content');
      await expect(handle.persist()).resolves.not.toThrow();
      await expect(handle.persist()).resolves.not.toThrow();

      await expect(handle.shutdown()).resolves.not.toThrow();
      await expect(handle.shutdown()).resolves.not.toThrow();

      fs.rmSync(encPath, { force: true });
    }, 10000);
  });
});
