import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface RedactModule {
  redactSensitiveText(text: string): string;
}

describe('electron redact', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function loadRedact() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-redact-'));
    return loadElectronModule<RedactModule>('../../../electron/redact.cjs', {
      electron: { app: { getPath: () => tempDir } },
    });
  }

  it('masks phone numbers and id card numbers', () => {
    const mod = loadRedact();
    expect(mod.redactSensitiveText('患者电话 13800138000 已回访')).toBe('患者电话 138****8000 已回访');
    expect(mod.redactSensitiveText('id=110101199001011234 校验')).toBe('id=1101**********1234 校验');
  });

  it('keeps non-PII text intact', () => {
    const mod = loadRedact();
    const text = '订单号 2026081300012345，金额 1234.56，ok';
    expect(mod.redactSensitiveText(text)).toBe(text);
  });

  it('accepts non-string input without throwing', () => {
    const mod = loadRedact();
    expect(mod.redactSensitiveText(undefined as unknown as string)).toBe('undefined');
    expect(mod.redactSensitiveText(13800138000 as unknown as string)).toContain('****');
  });
});
