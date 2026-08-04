// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResourceHub } from './ResourceHub';
import type { HubTab } from './hub-tabs';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const definition = {
  name: 'patients',
  table: 'Patient',
  fields: [{ name: 'name', type: 'text', required: true }],
  capabilities: { create: false, update: false, delete: false, softDelete: false },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('ResourceHub', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders custom tabs and hides write controls for read-only resources', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([definition])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    const tabs: HubTab[] = [
      { id: 'resource', label: 'Resource', kind: 'resource', resource: 'patients' },
      { id: 'custom', label: 'Custom', kind: 'custom', component: () => <div>Custom tab</div> },
    ];
    render(<ResourceHub title="Hub" tabs={tabs} />, { wrapper });
    expect(await screen.findByText('Hub')).toBeDefined();
    expect(screen.queryByText('Create')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    expect(screen.getByText('Custom tab')).toBeDefined();
  });

  it('shows create controls when the resource is writable', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([{ ...definition, capabilities: { create: true, update: false, delete: false, softDelete: false } }])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourceHub title="Hub" tabs={[{ id: 'resource', label: 'Resource', kind: 'resource', resource: 'patients' }]} />, { wrapper });
    expect(await screen.findByText('Create')).toBeDefined();
  });
});
