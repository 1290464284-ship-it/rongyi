import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/api/patients/patients', () => ({
  usePatients: () => ({ data: { items: [], total: 0, page: 1, pageSize: 20 }, isLoading: false }),
}));

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  const mockDebounce = vi.fn((fn: () => void) => {
    const debounced = (() => fn()) as (() => void) & { cancel: () => void };
    debounced.cancel = vi.fn();
    return debounced;
  });
  return { ...actual, formatDate: (d: string) => d?.slice(0, 10) ?? '', debounce: mockDebounce };
});

import { PatientSelector } from '../PatientSelector';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PatientSelector open={true} onClose={() => {}} onSelect={() => {}} title="选择患者" />
    </QueryClientProvider>
  );
}

describe('PatientSelector', () => {
  it('渲染患者选择器', () => {
    const { container } = renderWithProviders();
    expect(container.firstChild).toBeInTheDocument();
  });
});
