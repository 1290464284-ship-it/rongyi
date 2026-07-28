import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { queryClient } from './lib/api/query-client';
import { initErrorHandler } from './lib/error-logger';
import { initSyncService } from './lib/sync/sync-service';
import { GlobalLoading } from './components/GlobalLoading';
import './index.css';

initErrorHandler();
// P0 修复：保存 cleanup 函数，HMR 重载时清理旧的监听器和定时器
const cleanupSync = initSyncService();

// HMR 热重载时清理旧实例，防止监听器累积导致内存泄漏
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cleanupSync();
  });
}

// 生产环境：页面卸载时清理同步服务的监听器和定时器
window.addEventListener('pagehide', cleanupSync);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <QueryClientProvider client={queryClient}>
        <GlobalLoading />
        <App />
        <Toaster position="top-right" />
      </QueryClientProvider>
    </HashRouter>
  </React.StrictMode>,
);