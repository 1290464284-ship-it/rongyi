import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: (selector: (s: { user: { id: string; name: string }; isAuthenticated: () => boolean }) => unknown) =>
    selector({ user: { id: '1', name: '管理员' }, isAuthenticated: () => true }),
}));

vi.mock('@/lib/api/patients/patients', () => ({
  usePatients: () => ({ data: { items: [], total: 0 }, isLoading: false }),
  PATIENT_SOURCE_LABEL: { WALK_IN: '初诊', REFERRAL: '转介绍' },
  PATIENT_SOURCE_COLOR: { WALK_IN: 'bg-blue-100', REFERRAL: 'bg-green-100' },
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '', debounce: (fn: () => void) => fn };
});

import App from '../App';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('App', () => {
  it('渲染应用', () => {
    const { container } = renderWithProviders();
    expect(container.firstChild).toBeInTheDocument();
  });
});
