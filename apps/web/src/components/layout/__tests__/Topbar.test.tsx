import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: () => ({ user: { id: '1', name: '管理员' } }),
}));

import Topbar from '../Topbar';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Topbar', () => {
  it('渲染顶部栏', () => {
    renderWithProviders();
    expect(document.querySelector('header')).toBeInTheDocument();
  });
});
