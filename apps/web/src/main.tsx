import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { queryClient } from './lib/query-client';
import { initErrorHandler } from './lib/error-logger';
import { GlobalLoading } from './components/GlobalLoading';
import './index.css';

initErrorHandler();

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