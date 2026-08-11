// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from '../components/toast';
import { useToast } from './toast-context';

function ToastProbe() {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        showToast('来自提供者的提示', 'info');
      }}
    >
      触发
    </button>
  );
}

describe('toast context', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses the default no-op context outside a provider without crashing', () => {
    render(<ToastProbe />);
    const button = screen.getByRole('button', { name: '触发' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(button).toBeDefined();
  });

  it('surfaces the provider showToast implementation', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '触发' }));
    expect(screen.getByText('来自提供者的提示')).toBeDefined();
  });
});
