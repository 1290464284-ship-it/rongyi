import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('secret file', () => {
  const original = process.env.V2_SECRET_FILE;

  afterEach(() => {
    if (original === undefined) delete process.env.V2_SECRET_FILE;
    else process.env.V2_SECRET_FILE = original;
  });

  it('returns null without env or when the file is corrupt', async () => {
    vi.resetModules();
    const { secretFileValue } = await import('./secret-file');
    delete process.env.V2_SECRET_FILE;
    expect(secretFileValue('jwt')).toBeNull();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secret-file-'));
    const file = path.join(dir, 'secrets.json');
    process.env.V2_SECRET_FILE = file;

    fs.writeFileSync(file, '{bad json', 'utf8');
    expect(secretFileValue('jwt')).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads valid secrets and reuses the cache', async () => {
    vi.resetModules();
    const { secretFileValue } = await import('./secret-file');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-secret-file-'));
    const file = path.join(dir, 'secrets.json');
    process.env.V2_SECRET_FILE = file;
    fs.writeFileSync(file, JSON.stringify({ jwt: 'jwt-value', backupKey: 'backup-value' }), 'utf8');
    expect(secretFileValue('jwt')).toBe('jwt-value');
    expect(secretFileValue('backupKey')).toBe('backup-value');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
