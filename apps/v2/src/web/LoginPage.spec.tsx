// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { LoginPage } from './LoginPage';
import { login } from './api';

vi.mock('./api', () => ({
  apiRequest: vi.fn(),
  downloadCsv: vi.fn(),
  login: vi.fn(),
}));

function renderPage() {
  return render(<MemoryRouter><LoginPage /></MemoryRouter>);
}

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(login).mockReset();
  });

  it('renders login form and signs in', async () => {
    vi.mocked(login).mockResolvedValue({ token: 't', user: { id: 'u' } });
    renderPage();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'REDACTED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('admin', 'REDACTED');
    });
  });

  it('shows login errors', async () => {
    vi.mocked(login).mockRejectedValue(new Error('invalid credentials'));
    renderPage();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('invalid credentials')).toBeDefined();

    vi.mocked(login).mockRejectedValue('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Login failed')).toBeDefined();
  });
});
