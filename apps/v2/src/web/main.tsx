import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ToastProvider } from './components/toast';
import { onApiReady } from './lib/api';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

// API 子进程重启/首启就绪后，把所有失败/过期的查询置为失效自动重取，
// 消除刷新期「API 未就绪 → 查询进入 error 态 → 只能手动重试」的假失败。
onApiReady(() => {
  void queryClient.invalidateQueries();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </ToastProvider>
  </React.StrictMode>,
);
