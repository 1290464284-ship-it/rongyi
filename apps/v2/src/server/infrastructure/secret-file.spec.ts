import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('secret file', () => {
  const original = process.env.V2_SECRET_FILE;

  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) delete process.env.V2_SECRET_FILE;
    else process.env.V2_SECRET_FILE = original;
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
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
});
