import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../components/FirstExamListTab', () => ({
  FirstExamListTab: () => null,
}));
vi.mock('../components/TrackTab', () => ({
  TrackTab: () => null,
}));
vi.mock('../components/StatsTab', () => ({
  StatsTab: () => null,
}));

import FirstExamsPage from '../FirstExamsPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FirstExamsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FirstExamsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    renderWithProviders();
    expect(screen.getByText('首诊检查')).toBeInTheDocument();
  });
});
