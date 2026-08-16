// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDoctors } from './use-doctors';
import { DoctorSelect } from '../components/DoctorSelect';
import { apiRequest } from '../lib/api';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

afterEach(() => {
  cleanup();
  vi.mocked(apiRequest).mockReset();
});

describe('useDoctors', () => {
  it('fetches /doctors with a single shared queryKey', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'd-1', name: '张医生' }]);
    const { result } = renderHook(() => useDoctors(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiRequest).toHaveBeenCalledWith('/doctors');
    expect(result.current.data).toEqual([{ id: 'd-1', name: '张医生' }]);
  });
});

describe('DoctorSelect', () => {
  it('renders doctor options after loading, falling back to ids', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'd-1', name: '张医生' }, { id: 'd-2' }]);
    render(createElement(DoctorSelect, { value: '', onChange: vi.fn(), ariaLabel: '医生' }), { wrapper });
    expect(await screen.findByRole('option', { name: '张医生' })).toBeDefined();
    expect((screen.getByRole('option', { name: 'd-2' }) as HTMLOptionElement).value).toBe('d-2');
  });

  it('renders a MissingSelectOption when the value is not in the loaded list', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'd-1', name: '张医生' }]);
    render(createElement(DoctorSelect, { value: 'd-missing', onChange: vi.fn(), ariaLabel: '医生' }), { wrapper });
    expect(await screen.findByRole('option', { name: 'd-missing' })).toBeDefined();
  });

  it('shows an inline error with retry and recovers after refetch', async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce([{ id: 'd-1', name: '张医生' }]);
    render(createElement(DoctorSelect, { value: '', onChange: vi.fn(), ariaLabel: '医生' }), { wrapper });
    expect(await screen.findByText('医生列表加载失败')).toBeDefined();
    expect((screen.getByLabelText('医生') as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('option', { name: '张医生' })).toBeDefined();
    expect((screen.getByLabelText('医生') as HTMLSelectElement).disabled).toBe(false);
  });

  it('forwards disabled and required to the select', async () => {
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'd-1', name: '张医生' }]);
    render(createElement(DoctorSelect, { value: 'd-1', onChange: vi.fn(), ariaLabel: '医生', disabled: true }), { wrapper });
    await screen.findByRole('option', { name: '张医生' });
    expect((screen.getByLabelText('医生') as HTMLSelectElement).disabled).toBe(true);

    cleanup();
    render(createElement(DoctorSelect, { value: 'd-1', onChange: vi.fn(), ariaLabel: '医生', required: true }), { wrapper });
    expect((screen.getByLabelText('医生') as HTMLSelectElement).required).toBe(true);
  });

  it('emits the selected doctor id on change', async () => {
    const onChange = vi.fn();
    vi.mocked(apiRequest).mockResolvedValue([{ id: 'd-1', name: '张医生' }]);
    render(createElement(DoctorSelect, { value: '', onChange, ariaLabel: '医生' }), { wrapper });
    await screen.findByRole('option', { name: '张医生' });
    fireEvent.change(screen.getByLabelText('医生'), { target: { value: 'd-1' } });
    expect(onChange).toHaveBeenCalledWith('d-1');
  });
});
