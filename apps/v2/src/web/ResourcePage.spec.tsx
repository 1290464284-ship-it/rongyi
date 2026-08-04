// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ResourcePage } from './ResourcePage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn() }));

const writable = {
  name: 'patients',
  table: 'Patient',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'active', type: 'boolean' },
    { name: 'phone', type: 'text' },
    { name: 'price', type: 'money' },
    { name: 'data', type: 'json' },
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
    fireEvent.change(screen.getByLabelText('phone'), { target: { value: '' } });
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

  it('renders enum, relation, json, and long text form controls', async () => {
    const formResource = {
      name: 'wechatMessages',
      table: 'WechatMessage',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'status', type: 'enum', enumValues: ['PENDING', 'SENT'] },
        { name: 'patientId', type: 'relation', relation: { resource: 'patients', labelField: 'name' } },
        { name: 'notes', type: 'longText' },
        { name: 'data', type: 'json' },
        { name: 'active', type: 'boolean' },
      ],
      capabilities: { create: true, update: false, delete: false, softDelete: false },
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([formResource])
      .mockResolvedValueOnce({
        items: [{
          id: 'w1',
          name: 'Message',
          status: 'PENDING',
          patientId: 'p1',
          notes: 'note',
          data: { key: 'value' },
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'p1', name: 'Alice' }, { id: 'p2' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    render(<ResourcePage resource="wechatMessages" />, { wrapper });
    fireEvent.click(await screen.findByText('Create'));
    expect(await screen.findByText('Alice')).toBeDefined();
    expect(screen.getByLabelText('status')).toBeDefined();
    expect(screen.getByLabelText('notes')).toBeDefined();
    expect(screen.getByLabelText('data')).toBeDefined();
    expect(screen.getByLabelText('active')).toBeDefined();
    expect(screen.getByText('{"key":"value"}')).toBeDefined();
    expect(screen.getByText('p2')).toBeDefined();
    fireEvent.click(screen.getByLabelText('active'));
    fireEvent.change(screen.getByLabelText('status'), { target: { value: 'SENT' } });
    fireEvent.change(screen.getByLabelText('patientId'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('notes'), { target: { value: 'note updated' } });
    fireEvent.change(screen.getByLabelText('data'), { target: { value: '{}' } });
  });

  it('cancels create forms and hides write controls', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('Create'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('supports search and pager navigation', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 30, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 30, page: 2, pageSize: 20 });
    fireEvent.click(await screen.findByText('Next'));
    expect(await screen.findByText('Page 2')).toBeDefined();
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 30, page: 1, pageSize: 20 });
    fireEvent.click(screen.getByText('Previous'));
    expect(await screen.findByText('Page 1')).toBeDefined();
    vi.mocked(apiRequest).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'Alice' } });
    expect(await screen.findByText('No records.')).toBeDefined();
  });

  it('renders null cell values without crashing', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true, phone: null }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    expect(await screen.findByText('Alice')).toBeDefined();
  });

  it('reads the resource from route params and shows list errors', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockRejectedValueOnce(new Error('list failed'));
    render(
      <MemoryRouter initialEntries={['/resources/patients']}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Routes>
            <Route path="/resources/:resource" element={<ResourcePage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('list failed')).toBeDefined();
  });

  it('edits complex fields and skips empty optional values', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({
        items: [{ id: 'p1', name: 'Alice', active: true, phone: '13000000000', price: 1000, data: { key: 'value' } }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    render(<ResourcePage resource="patients" />, { wrapper });
    fireEvent.click(await screen.findByText('Edit'));
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true, data: { id: 'p1' } })
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice Updated', active: true, phone: '', price: 2500, data: {} }], total: 1, page: 1, pageSize: 20 });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Alice Updated' } });
    fireEvent.change(screen.getByLabelText('price'), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText('phone'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'PATCH' }),
    ));
  });

  it('does not delete when the user cancels confirmation', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [{ id: 'p1', name: 'Alice', active: true }], total: 1, page: 1, pageSize: 20 });
    render(<ResourcePage resource="patients" />, { wrapper });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(await screen.findByText('Delete'));
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalledWith(
      '/resources/patients/p1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('shows not found for unknown resources', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce([writable]);
    render(<ResourcePage resource="missing" />, { wrapper });
    expect(await screen.findByText('Resource not found')).toBeDefined();
  });

  it('falls back to patients when no route param is present', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([writable])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(
      <MemoryRouter initialEntries={['/']}>
        <QueryClientProvider client={new QueryClient()}>
          <Routes>
            <Route path="/" element={<ResourcePage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('No records.')).toBeDefined();
  });
});
