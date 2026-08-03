import { useEffect, useState } from 'react';

interface DesktopBridge {
  getApiPort: () => Promise<number>;
  restartApi: () => Promise<number>;
  setAutoLaunch: (enabled: boolean) => Promise<boolean>;
  getAutoLaunch: () => Promise<boolean>;
  checkUpdates: () => Promise<{ status: string; version?: string; message?: string }>;
}

export function DesktopSettingsPage() {
  const desktop = (window as unknown as { desktop?: DesktopBridge }).desktop;
  const [apiPort, setApiPort] = useState<number | null>(null);
  const [autoLaunch, setAutoLaunch] = useState<boolean | null>(null);
  const [updateStatus, setUpdateStatus] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!desktop) return;
    desktop.getApiPort().then(setApiPort).catch(() => setApiPort(null));
    desktop.getAutoLaunch().then(setAutoLaunch).catch(() => setAutoLaunch(null));
  }, [desktop]);

  if (!desktop) return <div className="page"><h1>桌面端设置</h1><p>当前运行在浏览器预览模式。</p></div>;
  const bridge = desktop;

  async function toggleAutoLaunch() {
    const next = !autoLaunch;
    await bridge.setAutoLaunch(next);
    setAutoLaunch(next);
    setMessage(`开机自启已${next ? '开启' : '关闭'}`);
  }

  async function restartApi() {
    const port = await bridge.restartApi();
    setApiPort(port);
    setMessage('API 已重启');
  }

  async function checkUpdates() {
    const result = await bridge.checkUpdates();
    setUpdateStatus(result.status === 'available' ? `发现新版本 ${result.version}` : result.status === 'none' ? '当前已是最新版本' : result.message ?? '检查失败');
  }

  return (
    <div className="page">
      <h1>桌面端设置</h1>
      <div className="cards">
        <div className="card"><strong>API 端口</strong><span>{apiPort ?? '未知'}</span></div>
        <div className="card"><strong>开机自启</strong><span>{autoLaunch === null ? '未知' : autoLaunch ? '已开启' : '已关闭'}</span></div>
      </div>
      <div className="inline-form">
        <button onClick={toggleAutoLaunch}>切换开机自启</button>
        <button onClick={restartApi}>重启 API</button>
        <button onClick={checkUpdates}>检查更新</button>
      </div>
      {(message || updateStatus) && <p className="info">{message || updateStatus}</p>}
    </div>
  );
}
