// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DesktopSettingsPage } from './DesktopSettingsPage';

interface TestBridge {
  getApiPort: ReturnType<typeof vi.fn>;
  restartApi: ReturnType<typeof vi.fn>;
  setAutoLaunch: ReturnType<typeof vi.fn>;
  getAutoLaunch: ReturnType<typeof vi.fn>;
  checkUpdates: ReturnType<typeof vi.fn>;
}

function installBridge(overrides: Partial<TestBridge> = {}) {
  const bridge: TestBridge = {
    getApiPort: vi.fn().mockResolvedValue(3180),
    restartApi: vi.fn().mockResolvedValue(3181),
    setAutoLaunch: vi.fn().mockResolvedValue(true),
    getAutoLaunch: vi.fn().mockResolvedValue(true),
    checkUpdates: vi.fn().mockResolvedValue({ status: 'available', version: '2.0.0' }),
    ...overrides,
  };
  Object.defineProperty(window, 'desktop', { value: bridge, configurable: true });
  return bridge;
}

describe('DesktopSettingsPage', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { desktop?: unknown }).desktop;
    vi.restoreAllMocks();
  });

  it('shows browser preview mode without a desktop bridge', () => {
    render(<DesktopSettingsPage />);
    expect(screen.getByText('当前运行在浏览器预览模式。')).toBeDefined();
  });

  it('loads settings and runs desktop actions', async () => {
    const bridge = installBridge();
    render(<DesktopSettingsPage />);
    expect(await screen.findByText('3180')).toBeDefined();
    expect(screen.getByText('已开启')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '切换开机自启' }));
    expect(await screen.findByText('开机自启已关闭')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '切换开机自启' }));
    expect(await screen.findByText('开机自启已开启')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '重启 API' }));
    expect(await screen.findByText('3181')).toBeDefined();
    expect(screen.getByText('API 已重启')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('发现新版本 2.0.0')).toBeDefined();
    expect(bridge.getApiPort).toHaveBeenCalled();
  });

  it('reports desktop action failures', async () => {
    const bridge = installBridge({
      setAutoLaunch: vi.fn().mockRejectedValue(new Error('auto failed')),
      restartApi: vi.fn().mockRejectedValue(new Error('restart failed')),
      checkUpdates: vi.fn().mockRejectedValue(new Error('update failed')),
    });
    render(<DesktopSettingsPage />);
    await screen.findByText('3180');

    fireEvent.click(screen.getByRole('button', { name: '切换开机自启' }));
    expect(await screen.findByText('auto failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '重启 API' }));
    expect(await screen.findByText('restart failed')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('update failed')).toBeDefined();

    bridge.setAutoLaunch.mockRejectedValueOnce('boom');
    fireEvent.click(screen.getByRole('button', { name: '切换开机自启' }));
    expect(await screen.findByText('切换开机自启失败')).toBeDefined();

    bridge.restartApi.mockRejectedValueOnce('boom');
    fireEvent.click(screen.getByRole('button', { name: '重启 API' }));
    expect(await screen.findByText('重启 API 失败')).toBeDefined();

    bridge.checkUpdates.mockRejectedValueOnce('boom');
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('检查失败')).toBeDefined();

    bridge.checkUpdates.mockResolvedValueOnce({ status: 'none' });
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('当前已是最新版本')).toBeDefined();

    bridge.checkUpdates.mockResolvedValueOnce({ status: 'error', message: 'custom update message' });
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('custom update message')).toBeDefined();
  });
});
