// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from './toast';
import { useToast } from '../lib/toast-context';

function ToastButton() {
  const { showToast } = useToast();
  return <button onClick={() => showToast('保存成功', 'success')}>显示提示</button>;
}

describe('ToastProvider', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows and removes toasts', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '显示提示' }));
    expect(screen.getByText('保存成功')).toBeDefined();
    act(() => vi.advanceTimersByTime(4300));
    expect(screen.queryByText('保存成功')).toBeNull();
  });
});
