import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: () => ({ user: { id: '1', name: '管理员' } }),
}));

vi.mock('@/lib/api/patients/patients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/patients/patients')>();
  return {
    ...actual,
    usePatients: () => ({ data: { items: [], total: 0 }, isLoading: false }),
  };
});

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '', debounce: (fn: () => void) => fn };
});

import PatientForm from '../PatientForm';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PatientForm onClose={() => {}} onSaved={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PatientForm', () => {
  it('渲染患者表单', () => {
    renderWithProviders();
    expect(document.querySelector('form')).toBeInTheDocument();
  });
});
