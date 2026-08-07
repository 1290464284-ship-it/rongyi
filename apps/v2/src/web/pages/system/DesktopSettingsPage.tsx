import { useEffect, useState } from 'react';
import { resetApiBase } from '../../lib/api';
import { errorMessage, friendlyError } from '../../lib/messages';
import { useToast } from '../../lib/toast-context';

interface DesktopBridge {
  getApiPort: () => Promise<number>;
  restartApi: () => Promise<number>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  getAutoLaunch: () => Promise<boolean>;
  checkUpdates: () => Promise<{ status: string; version?: string; message?: string }>;
  // S-H1: 用户确认后显式触发下载（autoDownload=false，发现新版本不再自动下载）。
  downloadUpdate?: () => Promise<{ status: string; message?: string }>;
  installUpdate?: () => Promise<boolean>;
  onUpdateEvent?: (callback: (event: Record<string, unknown>) => void) => () => void;
  onApiStatus?: (callback: (event: Record<string, unknown>) => void) => () => void;
}

export function DesktopSettingsPage() {
  const { showToast } = useToast();
  const desktop = (window as unknown as { desktop?: DesktopBridge }).desktop;
  const [apiPort, setApiPort] = useState<number | null>(null);
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState('');

  useEffect(() => {
    if (!desktop) return;
    desktop.getApiPort().then(setApiPort).catch(() => setApiPort(null));
    desktop.getAutoLaunch().then(setAutoLaunch).catch(() => setAutoLaunch(null));
    const unsubscribers: Array<() => void> = [];
    if (desktop.onUpdateEvent) {
      unsubscribers.push(desktop.onUpdateEvent((event) => {
        const type = String(event.type ?? '');
        if (type === 'progress') setUpdateStatus(`更新下载中：${String(event.percent ?? '')}%`);
        else if (type === 'available') {
          setUpdateAvailable(String(event.version ?? ''));
          setUpdateStatus(`发现新版本 ${String(event.version ?? '')}，点击"下载更新"按钮开始下载`);
        }
        else if (type === 'downloaded') {
          setUpdateAvailable(null);
          setUpdateStatus('更新已下载，可重启安装');
        }
        else if (type === 'none') {
          setUpdateAvailable(null);
          setUpdateStatus('当前已是最新版本');
        }
        else if (type === 'error') {
          setUpdateAvailable(null);
          setUpdateStatus(friendlyError(String(event.message ?? '更新失败')));
        }
        else if (type === 'checking') setUpdateStatus('正在检查更新');
      }));
    }
    if (desktop.onApiStatus) {
      unsubscribers.push(desktop.onApiStatus((event) => {
        const status = String(event.status ?? '');
        if (status === 'crashed') setApiStatus('本地服务异常，请检查端口占用或数据目录权限');
        else if (status === 'restarting') setApiStatus('本地服务正在重启...');
        else if (status === 'ready') setApiStatus(`本地服务已就绪（端口 ${String(event.port ?? '')}）`);
      }));
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [desktop]);

  if (!desktop) return <div className="page"><div className="page-head"><h1>桌面端设置</h1></div><p>当前运行在浏览器预览模式。</p></div>;
  const bridge = desktop;

  async function toggleAutoLaunch() {
    setUpdateStatus('');
    try {
      const next = !autoLaunch;
      await bridge.setAutoLaunch(next);
      setAutoLaunch(next);
      showToast(`开机自启已${next ? '开启' : '关闭'}`, 'success');
    } catch (error) {
      showToast(errorMessage(error, '切换开机自启失败'), 'error');
    }
  }

  async function restartApi() {
    setUpdateStatus('');
    try {
      const port = await bridge.restartApi();
      resetApiBase();
      setApiPort(port);
      showToast('API 已重启', 'success');
    } catch (error) {
      showToast(errorMessage(error, '重启 API 失败'), 'error');
    }
  }

  async function checkUpdates() {
    try {
      const result = await bridge.checkUpdates();
      if (result.status === 'error') {
        showToast(result.message ? friendlyError(result.message) : '检查失败', 'error');
        setUpdateStatus('');
      } else if (result.status === 'disabled') {
        setUpdateStatus('当前环境不支持在线更新');
      } else {
        if (result.status === 'available') setUpdateAvailable(result.version ?? '');
        setUpdateStatus(result.status === 'available' ? `发现新版本 ${result.version}，点击"下载更新"按钮开始下载` : result.status === 'none' ? '当前已是最新版本' : result.message ?? '检查失败');
      }
    } catch (error) {
      showToast(errorMessage(error, '检查失败'), 'error');
      setUpdateStatus('');
    }
  }

  // S-H1: 用户确认后显式触发下载（autoDownload=false 不再自动下载）。
  async function downloadUpdate() {
    try {
      if (!bridge.downloadUpdate) {
        showToast('当前环境不支持自动下载更新', 'info');
        return;
      }
      const result = await bridge.downloadUpdate();
      if (result.status === 'error') {
        showToast(result.message ? friendlyError(result.message) : '下载失败', 'error');
        setUpdateStatus('');
      }
      // 下载开始后由 progress/downloaded 事件驱动状态更新
    } catch (error) {
      showToast(errorMessage(error, '下载更新失败'), 'error');
    }
  }

  async function installUpdate() {
    try {
      if (bridge.installUpdate) {
        await bridge.installUpdate();
        showToast('已请求安装更新', 'success');
      } else {
        showToast('当前环境不支持自动安装更新', 'info');
      }
    } catch (error) {
      showToast(errorMessage(error, '安装更新失败'), 'error');
    }
  }

  return (
    <div className="page">
      <h1>桌面端设置</h1>
      <div className="cards">
        <div className="card"><strong>API 端口</strong><span>{apiPort ?? '未知'}</span></div>
        <div className="card"><strong>开机自启</strong><span>{autoLaunch === null ? '未知' : autoLaunch ? '已开启' : '已关闭'}</span></div>
        <div className="card"><strong>本地服务</strong><span>{apiStatus || '正常'}</span></div>
      </div>
      <div className="inline-form">
        <button onClick={toggleAutoLaunch}>切换开机自启</button>
        <button onClick={restartApi}>重启 API</button>
        <button onClick={checkUpdates}>检查更新</button>
        {updateAvailable !== null && !updateStatus.includes('下载中') && !updateStatus.includes('已下载') && <button onClick={downloadUpdate}>下载更新</button>}
        {updateStatus.includes('已下载') && <button onClick={installUpdate}>立即重启安装</button>}
      </div>
      {updateStatus && <p className="info">{updateStatus}</p>}
    </div>
  );
}
