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
initSyncService();

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