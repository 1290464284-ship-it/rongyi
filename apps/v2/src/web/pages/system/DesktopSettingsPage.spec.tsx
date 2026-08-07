// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DesktopSettingsPage } from './DesktopSettingsPage';
import { ToastProvider } from '../../components/toast';

interface TestBridge {
  getApiPort: ReturnType<typeof vi.fn>;
  restartApi: ReturnType<typeof vi.fn>;
  setAutoLaunch: ReturnType<typeof vi.fn>;
  getAutoLaunch: ReturnType<typeof vi.fn>;
  checkUpdates: ReturnType<typeof vi.fn>;
  installUpdate?: ReturnType<typeof vi.fn>;
  downloadUpdate?: ReturnType<typeof vi.fn>;
  onUpdateEvent?: ReturnType<typeof vi.fn>;
  onApiStatus?: ReturnType<typeof vi.fn>;
}

function installBridge(overrides: Partial<TestBridge> = {}) {
  const bridge: TestBridge = {
    getApiPort: vi.fn().mockResolvedValue(3180),
    restartApi: vi.fn().mockResolvedValue(3181),
    setAutoLaunch: vi.fn().mockResolvedValue(true),
    getAutoLaunch: vi.fn().mockResolvedValue(true),
    checkUpdates: vi.fn().mockResolvedValue({ status: 'available', version: '2.0.0' }),
    downloadUpdate: vi.fn().mockResolvedValue({ status: 'done' }),
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
    render(<ToastProvider><DesktopSettingsPage /></ToastProvider>);
    expect(screen.getByText('当前运行在浏览器预览模式。')).toBeDefined();
  });

  it('loads settings and runs desktop actions', async () => {
    const bridge = installBridge();
    render(<ToastProvider><DesktopSettingsPage /></ToastProvider>);
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
    expect(await screen.findByText('发现新版本 2.0.0，点击"下载更新"按钮开始下载')).toBeDefined();
    expect(screen.getByRole('button', { name: '下载更新' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '下载更新' }));
    expect(bridge.downloadUpdate).toHaveBeenCalled();
    expect(bridge.getApiPort).toHaveBeenCalled();
  });

  it('reports desktop action failures', async () => {
    const bridge = installBridge({
      setAutoLaunch: vi.fn().mockRejectedValue(new Error('auto failed')),
      restartApi: vi.fn().mockRejectedValue(new Error('restart failed')),
      checkUpdates: vi.fn().mockRejectedValue(new Error('update failed')),
    });
    render(<ToastProvider><DesktopSettingsPage /></ToastProvider>);
    await screen.findByText('3180');

    fireEvent.click(screen.getByRole('button', { name: '切换开机自启' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '重启 API' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect((await screen.findAllByText('操作失败，请稍后重试')).length).toBeGreaterThan(0);

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

    bridge.checkUpdates.mockResolvedValueOnce({ status: 'error', message: '自定义更新检查失败' });
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('自定义更新检查失败')).toBeDefined();

    bridge.checkUpdates.mockResolvedValueOnce({ status: 'error' });
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(await screen.findByText('检查失败')).toBeDefined();
  });

  it('subscribes to update events and installs a downloaded update', async () => {
    let updateCallback: ((event: Record<string, unknown>) => void) | undefined;
    let apiCallback: ((event: Record<string, unknown>) => void) | undefined;
    const unsubscribe = vi.fn();
    const bridge = installBridge({
      installUpdate: vi.fn().mockResolvedValue(true),
      onUpdateEvent: vi.fn((callback: (event: Record<string, unknown>) => void) => {
        updateCallback = callback;
        return unsubscribe;
      }),
      onApiStatus: vi.fn((callback: (event: Record<string, unknown>) => void) => {
        apiCallback = callback;
        return unsubscribe;
      }),
    });
    render(<ToastProvider><DesktopSettingsPage /></ToastProvider>);
    await screen.findByText('3180');

    updateCallback?.({});
    updateCallback?.({ type: 'progress' });
    expect(await screen.findByText('更新下载中：%')).toBeDefined();
    updateCallback?.({ type: 'available' });
    expect(await screen.findByText('发现新版本 ，点击"下载更新"按钮开始下载')).toBeDefined();
    updateCallback?.({ type: 'error' });
    expect(await screen.findByText('更新失败')).toBeDefined();
    apiCallback?.({});
    apiCallback?.({ status: 'ready' });
    expect(await screen.findByText('本地服务已就绪（端口 ）')).toBeDefined();

    updateCallback?.({ type: 'checking' });
    expect(await screen.findByText('正在检查更新')).toBeDefined();
    updateCallback?.({ type: 'progress', percent: 42 });
    expect(await screen.findByText('更新下载中：42%')).toBeDefined();
    updateCallback?.({ type: 'available', version: '2.2.0' });
    expect(await screen.findByText('发现新版本 2.2.0，点击"下载更新"按钮开始下载')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '下载更新' }));
    expect(bridge.downloadUpdate).toHaveBeenCalled();
    updateCallback?.({ type: 'none' });
    expect(await screen.findByText('当前已是最新版本')).toBeDefined();
    updateCallback?.({ type: 'error', message: 'update event error' });
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();
    updateCallback?.({ type: 'downloaded', version: '2.1.0' });
    expect(await screen.findByText('更新已下载，可重启安装')).toBeDefined();
    apiCallback?.({ status: 'crashed' });
    expect(await screen.findByText('本地服务异常，请检查端口占用或数据目录权限')).toBeDefined();
    apiCallback?.({ status: 'restarting' });
    expect(await screen.findByText('本地服务正在重启...')).toBeDefined();
    apiCallback?.({ status: 'ready', port: 3456 });
    expect(await screen.findByText('本地服务已就绪（端口 3456）')).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: '立即重启安装' }));
    expect(bridge.installUpdate).toHaveBeenCalled();
    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('handles rejected settings loads and install fallbacks', async () => {
    let updateCallback: ((event: Record<string, unknown>) => void) | undefined;
    installBridge({
      getApiPort: vi.fn().mockRejectedValue(new Error('port failed')),
      getAutoLaunch: vi.fn().mockRejectedValue(new Error('launch failed')),
      onUpdateEvent: vi.fn((callback: (event: Record<string, unknown>) => void) => {
        updateCallback = callback;
        return () => undefined;
      }),
      onApiStatus: vi.fn(() => () => undefined),
    });
    render(<ToastProvider><DesktopSettingsPage /></ToastProvider>);
    expect((await screen.findAllByText('未知')).length).toBe(2);

    updateCallback?.({ type: 'downloaded', version: '2.4.0' });
    fireEvent.click(await screen.findByRole('button', { name: '立即重启安装' }));
    expect(await screen.findByText('当前环境不支持自动安装更新')).toBeDefined();
  });

  it('reports update install failures', async () => {
    let updateCallback: ((event: Record<string, unknown>) => void) | undefined;
    const bridge = installBridge({
      installUpdate: vi.fn().mockRejectedValue(new Error('install failed')),
      onUpdateEvent: vi.fn((callback: (event: Record<string, unknown>) => void) => {
        updateCallback = callback;
        return () => undefined;
      }),
      onApiStatus: vi.fn(() => () => undefined),
    });
    render(<ToastProvider><DesktopSettingsPage /></ToastProvider>);
    await screen.findByText('3180');
    updateCallback?.({ type: 'downloaded', version: '2.5.0' });
    fireEvent.click(await screen.findByRole('button', { name: '立即重启安装' }));
    expect(await screen.findByText('操作失败，请稍后重试')).toBeDefined();

    bridge.installUpdate?.mockRejectedValueOnce('boom');
    fireEvent.click(screen.getByRole('button', { name: '立即重启安装' }));
    expect(await screen.findByText('安装更新失败')).toBeDefined();
  });
});
