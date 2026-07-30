import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: () => ({ user: { id: '1', name: '管理员' } }),
}));

const mockClinic = vi.hoisted(() => ({
  data: undefined as { id: string; name: string; code: string; isActive: number; createdAt: string } | undefined,
}));

vi.mock('@/lib/api/system/clinics', () => ({
  useCurrentClinic: () => ({ data: mockClinic.data }),
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
  beforeEach(() => {
    mockClinic.data = { id: 'c1', name: '仁爱口腔诊所', code: 'RA001', isActive: 1, createdAt: '' };
  });

  it('渲染顶部栏', () => {
    renderWithProviders();
    expect(document.querySelector('header')).toBeInTheDocument();
  });

  it('顶部显示当前诊所名称', () => {
    const { getByText } = renderWithProviders();
    expect(getByText('仁爱口腔诊所')).toBeInTheDocument();
  });

  it('诊所信息未加载时顶栏优雅降级，不渲染诊所区块', () => {
    mockClinic.data = undefined;
    const { queryByText } = renderWithProviders();
    expect(document.querySelector('header')).toBeInTheDocument();
    expect(queryByText('仁爱口腔诊所')).not.toBeInTheDocument();
  });
});
