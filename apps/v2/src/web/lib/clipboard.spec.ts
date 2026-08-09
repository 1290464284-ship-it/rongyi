// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

describe('copyText', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof window !== 'undefined') {
      delete (window as unknown as { desktop?: unknown }).desktop;
    }
  });

  it('prefers the desktop clipboard bridge', async () => {
    const copyTextBridge = vi.fn().mockResolvedValue(true);
    (globalThis.window as unknown as { desktop: { copyText: typeof copyTextBridge } }).desktop = { copyText: copyTextBridge };
    await copyText('hello');
    expect(copyTextBridge).toHaveBeenCalledWith('hello');
  });

  it('falls back to navigator.clipboard when the bridge is missing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await copyText('fallback');
    expect(writeText).toHaveBeenCalledWith('fallback');
  });
});
