import { describe, expect, it, vi } from 'vitest';
import { loadElectronModule } from './load-electron';

interface CertTrustModule {
  ensureInternalCertTrusted(): { ok: boolean; reason?: string; error?: string };
}

describe('electron cert trust', () => {
  it('returns cert-missing when the bundled certificate is absent', () => {
    const existsSync = vi.fn().mockReturnValue(false);
    const execFileSync = vi.fn();
    const mod = loadElectronModule<CertTrustModule>('../../../electron/cert-trust.cjs', {
      'node:child_process': { execFileSync },
      'node:fs': { existsSync },
    });
    expect(mod.ensureInternalCertTrusted()).toEqual({ ok: false, reason: 'cert-missing' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('installs the certificate through powershell when present', () => {
    const existsSync = vi.fn().mockReturnValue(true);
    const execFileSync = vi.fn().mockReturnValue('');
    const mod = loadElectronModule<CertTrustModule>('../../../electron/cert-trust.cjs', {
      'node:child_process': { execFileSync },
      'node:fs': { existsSync },
    });
    expect(mod.ensureInternalCertTrusted()).toEqual({ ok: true });
    expect(execFileSync).toHaveBeenCalledWith(
      'powershell',
      expect.arrayContaining(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command']),
      expect.objectContaining({ timeout: 15000 }),
    );
  });

  it('returns a non-fatal reason when powershell fails', () => {
    const existsSync = vi.fn().mockReturnValue(true);
    const execFileSync = vi.fn().mockImplementation(() => {
      throw new Error('store busy');
    });
    const mod = loadElectronModule<CertTrustModule>('../../../electron/cert-trust.cjs', {
      'node:child_process': { execFileSync },
      'node:fs': { existsSync },
    });
    const result = mod.ensureInternalCertTrusted();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('powershell-store-add');
    expect(result.error).toContain('store busy');
  });

  it('is disabled when V2_DISABLE_CERT_TRUST is set', () => {
    const previous = process.env.V2_DISABLE_CERT_TRUST;
    process.env.V2_DISABLE_CERT_TRUST = '1';
    try {
      const existsSync = vi.fn().mockReturnValue(true);
      const execFileSync = vi.fn();
      const mod = loadElectronModule<CertTrustModule>('../../../electron/cert-trust.cjs', {
        'node:child_process': { execFileSync },
        'node:fs': { existsSync },
      });
      expect(mod.ensureInternalCertTrusted()).toEqual({ ok: false, reason: 'disabled' });
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.V2_DISABLE_CERT_TRUST;
      else process.env.V2_DISABLE_CERT_TRUST = previous;
    }
  });
});
