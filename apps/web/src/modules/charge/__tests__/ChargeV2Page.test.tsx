import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../components/CombosTab', () => ({
  ChargeCombosTab: () => null,
}));
vi.mock('../components/PaymentMethodsTab', () => ({
  PaymentMethodsTab: () => null,
}));
vi.mock('../components/DebtsTab', () => ({
  DebtsTab: () => null,
}));

import ChargeV2Page from '../ChargeV2Page';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChargeV2Page />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ChargeV2Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    renderWithProviders();
    expect(screen.getByText('收费增强')).toBeInTheDocument();
  });
});
