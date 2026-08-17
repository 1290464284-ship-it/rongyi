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

  it('E-3: stays in sync with the server-side redaction rules', async () => {
    // 两份脱敏实现（electron/redact.cjs 与 server/infrastructure/redact.ts）为人工同步副本，
    // 本用例以一批样本 pin 两者输出完全一致，防止规则漂移。
    const serverRedact = await import('../infrastructure/redact');
    const mod = loadRedact();
    const samples = [
      '患者电话 13800138000 已回访',
      'id=110101199001011234 校验',
      '联系 15912345678 与 11010119900101123x 混合',
      '订单号 2026081300012345，金额 1234.56，ok',
      '无敏感信息文本',
      '1[3-9] 边界测试 138001380001 超长号码',
      '身份证 11010119900101123 17 位不掩码',
      '',
    ];
    for (const sample of samples) {
      expect(mod.redactSensitiveText(sample)).toBe(serverRedact.redactSensitiveText(sample));
    }
  });
});
