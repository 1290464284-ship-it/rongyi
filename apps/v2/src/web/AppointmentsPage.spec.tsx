// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppointmentsPage } from './AppointmentsPage';
import { apiRequest } from './api';

vi.mock('./api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('AppointmentsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders appointments and creates one', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return {
          items: [
            { id: 'a-1', patientId: 'p-1', doctorId: 'd-1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' },
            { id: 'a-2', patientId: null, doctorId: null, startTime: null, status: null },
          ],
          total: 2,
        };
      }
      if (path === '/appointments') return {};
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    expect(await screen.findByText('p-1')).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('patientId'), { target: { value: 'p-2' } });
    fireEvent.change(screen.getByPlaceholderText('doctorId'), { target: { value: 'd-2' } });
    const datetimeInputs = screen.getAllByDisplayValue('');
    fireEvent.change(datetimeInputs[0], { target: { value: '2026-08-05T09:00' } });
    fireEvent.change(datetimeInputs[1], { target: { value: '2026-08-05T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/appointments', expect.objectContaining({ method: 'POST' }));
    });
    expect(await screen.findByText('Appointment created')).toBeDefined();
  });

  it('transitions appointment status', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return { items: [{ id: 'a-1', patientId: 'p-1', doctorId: 'd-1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }], total: 1 };
      }
      return {};
    });

    render(<AppointmentsPage />, { wrapper });
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'ARRIVED' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/appointments/a-1/status', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('reports create and transition failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return { items: [{ id: 'a-1', patientId: 'p-1', doctorId: 'd-1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }], total: 1 };
      }
      throw new Error('appointment failed');
    });

    render(<AppointmentsPage />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
    expect(await screen.findByText('appointment failed')).toBeDefined();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ARRIVED' } });
    expect(await screen.findByText('appointment failed')).toBeDefined();

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/appointments?page=1&pageSize=20') {
        return { items: [{ id: 'a-1', patientId: 'p-1', doctorId: 'd-1', startTime: '2026-08-04T09:00:00.000Z', status: 'BOOKED' }], total: 1 };
      }
      throw 'boom';
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ARRIVED' } });
    expect(await screen.findByText('Status transition failed')).toBeDefined();
  });
});
