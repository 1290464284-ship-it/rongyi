import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../components/RecordsTab', () => ({
  RecordsTab: () => <div data-testid="records-tab">RecordsTab</div>,
}));
vi.mock('../components/TemplatesTab', () => ({
  TemplatesTab: () => <div data-testid="templates-tab">TemplatesTab</div>,
}));
vi.mock('../components/PhrasesTab', () => ({
  PhrasesTab: () => <div data-testid="phrases-tab">PhrasesTab</div>,
}));
vi.mock('../components/RequestsTab', () => ({
  RequestsTab: () => <div data-testid="requests-tab">RequestsTab</div>,
}));

import MedicalRecordsPage from '../MedicalRecordsPage';

function renderWithProviders() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MedicalRecordsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('MedicalRecordsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题', () => {
    renderWithProviders();

    expect(screen.getByText('电子病历')).toBeInTheDocument();
  });
});
