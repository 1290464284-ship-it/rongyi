import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('secret file', () => {
  const original = process.env.V2_SECRET_FILE;
  const originalPlatform = process.platform;

  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) delete process.env.V2_SECRET_FILE;
    else process.env.V2_SECRET_FILE = original;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns null without env or when the file is corrupt', async () => {
    vi.resetModules();
    const { secretFileValue } = await import('./secret-file');
    delete process.env.V2_SECRET_FILE;
    expect(secretFileValue('jwt')).toBeNull();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secret-file-'));
    const file = path.join(dir, 'secrets.json');
    process.env.V2_SECRET_FILE = file;

    fs.writeFileSync(file, '{bad json', { encoding: 'utf8', mode: 0o600 });
    expect(secretFileValue('jwt')).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the secret file path is missing', async () => {
    vi.resetModules();
    const { secretFileValue } = await import('./secret-file');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secret-file-missing-'));
    process.env.V2_SECRET_FILE = path.join(dir, 'missing.json');
    expect(secretFileValue('jwt')).toBeNull();
    expect(secretFileValue('backupKey')).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('treats non-string secret fields as absent', async () => {
    vi.resetModules();
    const { secretFileValue } = await import('./secret-file');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secret-file-types-'));
    const file = path.join(dir, 'secrets.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ jwt: 123, backupKey: { a: 1 }, wechatAppId: 1, wechatAppSecret: [], adminPassword: true }),
      { encoding: 'utf8', mode: 0o600 },
    );
    process.env.V2_SECRET_FILE = file;
    expect(secretFileValue('jwt')).toBeNull();
    expect(secretFileValue('backupKey')).toBeNull();
    expect(secretFileValue('wechatAppId')).toBeNull();
    expect(secretFileValue('wechatAppSecret')).toBeNull();
    expect(secretFileValue('adminPassword')).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads valid secrets and reuses the cache', async () => {
    vi.resetModules();
    const { secretFileValue } = await import('./secret-file');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secret-file-'));
    const file = path.join(dir, 'secrets.json');
    process.env.V2_SECRET_FILE = file;
    fs.writeFileSync(file, JSON.stringify({ jwt: 'jwt-value', backupKey: 'backup-value' }), { encoding: 'utf8', mode: 0o600 });
    expect(secretFileValue('jwt')).toBe('jwt-value');
    expect(secretFileValue('backupKey')).toBe('backup-value');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('treats non-string secret fields as missing', async () => {
    vi.resetModules();
    const { secretFileValue } = await import('./secret-file');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secret-file-types-'));
    const file = path.join(dir, 'secrets.json');
    process.env.V2_SECRET_FILE = file;
    fs.writeFileSync(file, JSON.stringify({
      jwt: 123,
      backupKey: null,
      wechatAppId: true,
      wechatAppSecret: {},
      adminPassword: [],
    }), { encoding: 'utf8', mode: 0o600 });
    expect(secretFileValue('jwt')).toBeNull();
    expect(secretFileValue('backupKey')).toBeNull();
    expect(secretFileValue('wechatAppId')).toBeNull();
    expect(secretFileValue('wechatAppSecret')).toBeNull();
    expect(secretFileValue('adminPassword')).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects non-owner-only secret file modes on POSIX', async () => {
    vi.resetModules();
    const { assertOwnerOnlySecretFile } = await import('./secret-file');
    expect(() => assertOwnerOnlySecretFile(0o100644, 'linux')).toThrow(/owner-only/);
    expect(() => assertOwnerOnlySecretFile(0o100640, 'linux')).toThrow(/owner-only/);
    expect(() => assertOwnerOnlySecretFile(0o100600, 'linux')).not.toThrow();
    expect(() => assertOwnerOnlySecretFile(0o100666, 'win32')).not.toThrow();
  });

  it('reads secrets through the POSIX owner-only path', async () => {
    vi.resetModules();
    vi.spyOn(fs, 'openSync').mockReturnValue(42);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({
      uid: typeof process.getuid === 'function' ? process.getuid() : -1,
      mode: 0o100600,
    } as never);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ jwt: 'posix-value' }));
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined as never);
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    process.env.V2_SECRET_FILE = 'posix-secrets.json';
    const { secretFileValue } = await import('./secret-file');
    expect(secretFileValue('jwt')).toBe('posix-value');
  });

  it('rethrows non-ENOENT secret file errors', async () => {
    vi.resetModules();
    const denied = new Error('permission denied') as NodeJS.ErrnoException;
    denied.code = 'EACCES';
    vi.spyOn(fs, 'openSync').mockImplementation(() => {
      throw denied;
    });
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    process.env.V2_SECRET_FILE = 'denied.json';
    const { secretFileValue } = await import('./secret-file');
    expect(() => secretFileValue('jwt')).toThrow('permission denied');
  });

  it('reads string wechat and admin secret fields', async () => {
    vi.resetModules();
    const { secretFileValue } = await import('./secret-file');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secret-file-str-'));
    const file = path.join(dir, 'secrets.json');
    process.env.V2_SECRET_FILE = file;
    fs.writeFileSync(
      file,
      JSON.stringify({
        jwt: 'jwt-value',
        backupKey: 'backup-value',
        wechatAppId: 'wx-app-id',
        wechatAppSecret: 'wx-app-secret',
        adminPassword: 'admin-pass',
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
    expect(secretFileValue('wechatAppId')).toBe('wx-app-id');
    expect(secretFileValue('wechatAppSecret')).toBe('wx-app-secret');
    expect(secretFileValue('adminPassword')).toBe('admin-pass');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects secrets owned by another user on POSIX', async () => {
    vi.resetModules();
    vi.spyOn(fs, 'openSync').mockReturnValue(42);
    vi.spyOn(fs, 'fstatSync').mockReturnValue({ uid: 999, mode: 0o100600 } as never);
    vi.spyOn(fs, 'closeSync').mockReturnValue(undefined as never);
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    Object.defineProperty(process, 'getuid', { value: () => 1234, configurable: true });
    try {
      process.env.V2_SECRET_FILE = 'other-owner.json';
      const { secretFileValue } = await import('./secret-file');
      expect(() => secretFileValue('jwt')).toThrow('owned by the current user');
    } finally {
      Reflect.deleteProperty(process, 'getuid');
    }
  });
});
