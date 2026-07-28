 
const TEST_KEY_HEX = 'a'.repeat(64);

describe('encryption 加密工具', () => {
  let originalEnv: string | undefined;
  let encryptionModule: typeof import('./encryption');

  beforeAll(() => {
    originalEnv = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY_HEX;
    jest.resetModules();
    encryptionModule = require('./encryption');
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEnv;
    }
  });

  describe('encryptField / decryptField', () => {
    it('加密后的数据应能解密还原', () => {
      const plaintext = 'hello world';
      const encrypted = encryptionModule.encryptField(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(typeof encrypted).toBe('string');
      const decrypted = encryptionModule.decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('加密结果应包含三段（iv:authTag:ciphertext）', () => {
      const encrypted = encryptionModule.encryptField('test');
      const parts = (encrypted).split(':');
      expect(parts.length).toBe(3);
      expect(parts[0].length).toBe(24);
      expect(parts[1].length).toBe(32);
      expect(parts[2].length).toBeGreaterThan(0);
    });

    it('每次加密结果应不同（随机 IV）', () => {
      const plaintext = 'same text';
      const enc1 = encryptionModule.encryptField(plaintext);
      const enc2 = encryptionModule.encryptField(plaintext);
      expect(enc1).not.toBe(enc2);
      expect(encryptionModule.decryptField(enc1)).toBe(plaintext);
      expect(encryptionModule.decryptField(enc2)).toBe(plaintext);
    });

    it('decryptField 传入 null 应返回 null', () => {
      expect(encryptionModule.decryptField(null)).toBeNull();
    });

    it('decryptField 传入 undefined 应返回 null', () => {
      expect(encryptionModule.decryptField(undefined)).toBeNull();
    });

    it('encryptField 传入 null 应抛出 EncryptionError', () => {
      expect(() => {
        encryptionModule.encryptField(null);
      }).toThrow(encryptionModule.EncryptionError);
    });

    it('encryptField 传入 undefined 应抛出 EncryptionError', () => {
      expect(() => {
        encryptionModule.encryptField(undefined);
      }).toThrow(encryptionModule.EncryptionError);
    });

    it('解密格式错误的密文应抛出异常', () => {
      expect(() => {
        encryptionModule.decryptField('invalid');
      }).toThrow(encryptionModule.EncryptionError);
    });

    it('解密被篡改的密文应抛出异常', () => {
      const encrypted = encryptionModule.encryptField('test');
      const tampered = '00' + encrypted.slice(2);
      expect(() => {
        encryptionModule.decryptField(tampered);
      }).toThrow(encryptionModule.EncryptionError);
    });

    it('中文文本加密解密应正常工作', () => {
      const plaintext = '你好，世界！测试中文';
      const encrypted = encryptionModule.encryptField(plaintext);
      const decrypted = encryptionModule.decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('长文本加密解密应正常工作', () => {
      const plaintext = 'a'.repeat(1000);
      const encrypted = encryptionModule.encryptField(plaintext);
      const decrypted = encryptionModule.decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('decryptFieldWithFlag', () => {
    it('正常解密应返回 needsReencrypt=false', () => {
      const encrypted = encryptionModule.encryptField('test');
      const result = encryptionModule.decryptFieldWithFlag(encrypted);
      expect(result.plaintext).toBe('test');
      expect(result.needsReencrypt).toBe(false);
    });

    it('传入 null 应返回 { plaintext: null, needsReencrypt: false }', () => {
      const result = encryptionModule.decryptFieldWithFlag(null);
      expect(result.plaintext).toBeNull();
      expect(result.needsReencrypt).toBe(false);
    });

    it('传入 undefined 应返回 { plaintext: null, needsReencrypt: false }', () => {
      const result = encryptionModule.decryptFieldWithFlag(undefined);
      expect(result.plaintext).toBeNull();
      expect(result.needsReencrypt).toBe(false);
    });
  });

  describe('encryptBuffer / isEncryptedBuffer / decryptBufferIfEncrypted', () => {
    it('Buffer 加密后应能解密还原', () => {
      const data = Buffer.from('hello buffer test');
      const encrypted = encryptionModule.encryptBuffer(data);
      expect(encrypted).not.toEqual(data);
      expect(encryptionModule.isEncryptedBuffer(encrypted)).toBe(true);
      const decrypted = encryptionModule.decryptBufferIfEncrypted(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('isEncryptedBuffer 对未加密数据应返回 false', () => {
      const data = Buffer.from('not encrypted');
      expect(encryptionModule.isEncryptedBuffer(data)).toBe(false);
    });

    it('isEncryptedBuffer 对太短的数据应返回 false', () => {
      const data = Buffer.from('short');
      expect(encryptionModule.isEncryptedBuffer(data)).toBe(false);
    });

    it('decryptBufferIfEncrypted 对未加密数据应返回 null', () => {
      const data = Buffer.from('not encrypted');
      expect(encryptionModule.decryptBufferIfEncrypted(data)).toBeNull();
    });

    it('加密后的 Buffer 应以 DBAK 魔数开头', () => {
      const data = Buffer.from('test');
      const encrypted = encryptionModule.encryptBuffer(data);
      expect(encrypted.subarray(0, 4).toString()).toBe('DBAK');
    });

    it('加密后的 Buffer 版本号应为 1', () => {
      const data = Buffer.from('test');
      const encrypted = encryptionModule.encryptBuffer(data);
      expect(encrypted[4]).toBe(1);
    });
  });

  describe('setLegacyEncryptionKey', () => {
    it('设置有效的 legacy key 不应抛出', () => {
      const legacyKey = 'b'.repeat(64);
      expect(() => {
        encryptionModule.setLegacyEncryptionKey(legacyKey);
      }).not.toThrow();
    });

    it('设置无效的 legacy key 应抛出 EncryptionError', () => {
      expect(() => {
        encryptionModule.setLegacyEncryptionKey('invalid');
      }).toThrow(encryptionModule.EncryptionError);
    });
  });

  describe('legacy key 解密场景', () => {
    const LEGACY_KEY_HEX = 'b'.repeat(64);
    let legacyEncryptionModule: typeof import('./encryption');

    beforeAll(() => {
      process.env.ENCRYPTION_KEY = LEGACY_KEY_HEX;
      jest.resetModules();
      legacyEncryptionModule = require('./encryption');
    });

    afterAll(() => {
      process.env.ENCRYPTION_KEY = TEST_KEY_HEX;
      jest.resetModules();
      encryptionModule = require('./encryption');
    });

    it('使用 legacy key 加密的数据应能通过新密钥+legacy key 解密', () => {
      const plaintext = 'legacy encrypted data';
      const legacyEncrypted = legacyEncryptionModule.encryptField(plaintext);

      encryptionModule.setLegacyEncryptionKey(LEGACY_KEY_HEX);
      const result = encryptionModule.decryptFieldWithFlag(legacyEncrypted);

      expect(result.plaintext).toBe(plaintext);
      expect(result.needsReencrypt).toBe(true);
    });

    it('decryptField 也应能解密 legacy key 加密的数据', () => {
      const plaintext = 'legacy test for decryptField';
      const legacyEncrypted = legacyEncryptionModule.encryptField(plaintext);

      encryptionModule.setLegacyEncryptionKey(LEGACY_KEY_HEX);
      const decrypted = encryptionModule.decryptField(legacyEncrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('没有 legacy key 时解密旧数据应失败', () => {
      const plaintext = 'data without legacy key';
      const legacyEncrypted = legacyEncryptionModule.encryptField(plaintext);

      process.env.ENCRYPTION_KEY = TEST_KEY_HEX;
      jest.resetModules();
      const freshModule = require('./encryption');

      expect(() => {
        freshModule.decryptField(legacyEncrypted);
      }).toThrow(freshModule.EncryptionError);
    });
  });

  describe('EncryptionError 错误码', () => {
    it('null 输入应抛出 E_NULL_INPUT 错误码', () => {
      try {
        encryptionModule.encryptField(null);
        fail('should throw');
      } catch (err: unknown) {
        const e = err as { code: string; name: string };
        expect(e.code).toBe('E_NULL_INPUT');
        expect(e.name).toBe('EncryptionError');
      }
    });

    it('解密失败应抛出 E_DECRYPT_FAILED 错误码', () => {
      try {
        encryptionModule.decryptField('aa:bb:cc');
        fail('should throw');
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe('E_DECRYPT_FAILED');
      }
    });

    it('无效 legacy key 应抛出 E_KEY_MISSING 错误码', () => {
      try {
        encryptionModule.setLegacyEncryptionKey('short');
        fail('should throw');
      } catch (err: unknown) {
        expect((err as { code: string }).code).toBe('E_KEY_MISSING');
      }
    });
  });

  describe('decryptBufferIfEncrypted 边界情况', () => {
    it('数据长度不足 33 字节应返回 null', () => {
      const shortData = Buffer.from('DBAK\u{1}short');
      expect(encryptionModule.decryptBufferIfEncrypted(shortData)).toBeNull();
    });

    it('不支持的版本号应返回 null', () => {
      const data = Buffer.alloc(40, 0);
      data.write('DBAK', 0);
      data[4] = 99;
      expect(encryptionModule.isEncryptedBuffer(data)).toBe(true);
      expect(encryptionModule.decryptBufferIfEncrypted(data)).toBeNull();
    });

    it('篡改后的加密 Buffer 解密应抛出 EncryptionError', () => {
      const original = Buffer.from('test data for tamper');
      const encrypted = encryptionModule.encryptBuffer(original);
      encrypted[35] ^= 0xff;

      expect(() => {
        encryptionModule.decryptBufferIfEncrypted(encrypted);
      }).toThrow(encryptionModule.EncryptionError);
    });
  });

  describe('密文格式验证', () => {
    it('密文只有两段应抛出异常', () => {
      expect(() => {
        encryptionModule.decryptField('aa:bb');
      }).toThrow(encryptionModule.EncryptionError);
    });

    it('密文有四段应抛出异常', () => {
      expect(() => {
        encryptionModule.decryptField('aa:bb:cc:dd');
      }).toThrow(encryptionModule.EncryptionError);
    });

    it('空字符串密文应抛出异常', () => {
      expect(() => {
        encryptionModule.decryptField('');
      }).toThrow(encryptionModule.EncryptionError);
    });
  });

  describe('非 hex 格式密钥处理', () => {
    it('非 hex 格式的 32+ 字符密钥应通过 SHA256 哈希处理', () => {
      const passphrase = 'my-secret-passphrase-for-encryption';
      process.env.ENCRYPTION_KEY = passphrase;
      jest.resetModules();
      const moduleWithPassphrase = require('./encryption');

      const plaintext = 'test with passphrase key';
      const encrypted = moduleWithPassphrase.encryptField(plaintext);
      const decrypted = moduleWithPassphrase.decryptField(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('空字符串和特殊字符', () => {
    it('空字符串应能正常加密解密', () => {
      const encrypted = encryptionModule.encryptField('');
      const decrypted = encryptionModule.decryptField(encrypted);
      expect(decrypted).toBe('');
    });

    it('包含特殊字符的字符串应能正常加密解密', () => {
      const plaintext = 'special chars: !@#$%^&*()_+-=[]{}|;:\'",.<>?/`~';
      const encrypted = encryptionModule.encryptField(plaintext);
      const decrypted = encryptionModule.decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('包含换行符的字符串应能正常加密解密', () => {
      const plaintext = 'line1\nline2\r\nline3';
      const encrypted = encryptionModule.encryptField(plaintext);
      const decrypted = encryptionModule.decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('Unicode emoji 应能正常加密解密', () => {
      const plaintext = 'hello 🌍 world 🎉';
      const encrypted = encryptionModule.encryptField(plaintext);
      const decrypted = encryptionModule.decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('Buffer 加密解密更多场景', () => {
    it('空 Buffer 加密解密应正常工作', () => {
      const data = Buffer.from('');
      const encrypted = encryptionModule.encryptBuffer(data);
      expect(encryptionModule.isEncryptedBuffer(encrypted)).toBe(true);
      const decrypted = encryptionModule.decryptBufferIfEncrypted(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('大 Buffer 加密解密应正常工作', () => {
      const data = Buffer.alloc(10000, 'x');
      const encrypted = encryptionModule.encryptBuffer(data);
      const decrypted = encryptionModule.decryptBufferIfEncrypted(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('二进制数据 Buffer 加密解密应正常工作', () => {
      const data = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const encrypted = encryptionModule.encryptBuffer(data);
      const decrypted = encryptionModule.decryptBufferIfEncrypted(encrypted);
      expect(decrypted).toEqual(data);
    });
  });

  describe('备份独立加密密钥', () => {
    const MAIN_KEY_HEX = 'a'.repeat(64);
    const BACKUP_KEY_HEX = 'c'.repeat(64);
    let originalBackupEnv: string | undefined;

    beforeAll(() => {
      originalBackupEnv = process.env.BACKUP_ENCRYPTION_KEY;
    });

    afterAll(() => {
      if (originalBackupEnv === undefined) {
        delete process.env.BACKUP_ENCRYPTION_KEY;
      } else {
        process.env.BACKUP_ENCRYPTION_KEY = originalBackupEnv;
      }
    });

    it('getBackupEncryptionKey 应优先使用 BACKUP_ENCRYPTION_KEY', () => {
      process.env.ENCRYPTION_KEY = MAIN_KEY_HEX;
      process.env.BACKUP_ENCRYPTION_KEY = BACKUP_KEY_HEX;
      jest.resetModules();
      const mod = require('./encryption');

      expect(mod.getBackupEncryptionKey()).toEqual(Buffer.from(BACKUP_KEY_HEX, 'hex'));
    });

    it('encryptBuffer 默认使用 BACKUP_ENCRYPTION_KEY 加解密', () => {
      process.env.ENCRYPTION_KEY = MAIN_KEY_HEX;
      process.env.BACKUP_ENCRYPTION_KEY = BACKUP_KEY_HEX;
      jest.resetModules();
      const mod = require('./encryption');
      const data = Buffer.from('backup with dedicated key');

      const encrypted = mod.encryptBuffer(data);
      expect(mod.isEncryptedBuffer(encrypted)).toBe(true);
      expect(mod.decryptBufferIfEncrypted(encrypted)).toEqual(data);
    });

    it('encryptBuffer / decryptBufferIfEncrypted 支持传入显式 key', () => {
      process.env.ENCRYPTION_KEY = MAIN_KEY_HEX;
      delete process.env.BACKUP_ENCRYPTION_KEY;
      jest.resetModules();
      const mod = require('./encryption');
      const explicitKey = Buffer.from(BACKUP_KEY_HEX, 'hex');
      const data = Buffer.from('explicit key roundtrip');

      const encrypted = mod.encryptBuffer(data, explicitKey);
      expect(mod.decryptBufferIfEncrypted(encrypted, explicitKey)).toEqual(data);
    });

    it('未配置 BACKUP_ENCRYPTION_KEY 时回退到 ENCRYPTION_KEY', () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = MAIN_KEY_HEX;
      jest.resetModules();
      const mod = require('./encryption');

      const data = Buffer.from('fallback key roundtrip');
      const encrypted = mod.encryptBuffer(data);
      expect(mod.decryptBufferIfEncrypted(encrypted)).toEqual(data);
    });
  });
});
