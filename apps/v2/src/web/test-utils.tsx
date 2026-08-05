import React from 'react';
import { afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, cleanup } from '@testing-library/react';
import { ToastProvider } from './toast';

vi.mock('./api', () => ({
  apiRequest: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetAllMocks();
});

function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

type RenderWithProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
  queryClient?: QueryClient;
};

export function renderWithProviders(
  ui: React.ReactNode,
  options: RenderWithProvidersOptions = {},
) {
  const { queryClient, ...renderOptions } = options;
  const client = queryClient ?? makeTestQueryClient();
  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper, ...renderOptions });
}

export { makeTestQueryClient };
