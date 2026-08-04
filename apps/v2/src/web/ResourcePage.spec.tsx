// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ResourcePage } from './ResourcePage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const writable = {
  name: 'patients',
  table: 'Patient',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'active', type: 'boolean' },
  ],
  capabilities: { create: true, update: true, delete: true, softDelete: true },
};

const readOnly = {
  ...writable,
  capabilities: { create: false, update: false, delete: false, softDelete: false },
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('ResourcePage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders rows and hides write controls for read-only resources', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([readOnly])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    expect(await screen.findByText('Alice')).toBeDefined();
    expect(screen.queryByText('Create')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('submits a create form for writable resources', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('Create'));
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 'p2' } })
      .mockResolvedValueOnce({ items: [{ id: 'p2', name: 'Bob', active: true }], total: 1, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('deletes rows when delete is confirmed', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    const deleteButton = await screen.findByText('Delete');
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: true, data: { id: 'p1' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(deleteButton);
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'DELETE' }),
    ));
  });

  it('submits an edit form and advances pages', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 30, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('Edit'));
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 'p1' } })
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice Updated', active: true }], total: 30, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Alice Updated' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 30, page: 2, pageSize: 20 });
    fireEvent.click(screen.getByText('Next'));
    expect(await screen.findByText('Page 2')).toBeDefined();
  });
});
