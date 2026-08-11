// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog, Dialog, PromptDialog } from './dialog';

describe('Dialog', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing while closed and content when open', () => {
    const { rerender } = render(<Dialog open={false} title="T" onClose={vi.fn()}><p>hidden</p></Dialog>);
    expect(screen.queryByText('hidden')).toBeNull();
    rerender(<Dialog open title="T" onClose={vi.fn()}><p>visible</p></Dialog>);
    expect(screen.getByRole('dialog', { name: 'T' })).toBeDefined();
    expect(screen.getByText('visible')).toBeDefined();
  });

  it('closes through Escape after the close animation', () => {
    const onClose = vi.fn();
    render(<Dialog open title="T" onClose={onClose}><p>content</p></Dialog>);
    vi.useFakeTimers();
    fireEvent.keyDown(document.querySelector('.modal')!, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(150));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes through a backdrop mouse down after the close animation', () => {
    const onClose = vi.fn();
    render(<Dialog open title="T" onClose={onClose}><p>content</p></Dialog>);
    vi.useFakeTimers();
    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!);
    act(() => vi.advanceTimersByTime(150));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps focus with Tab and Shift+Tab', () => {
    render(
      <Dialog open title="T" onClose={vi.fn()}>
        <button type="button">first</button>
        <button type="button">last</button>
      </Dialog>,
    );
    const modal = document.querySelector('.modal') as HTMLElement;
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });
    last.focus();
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(modal, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('keeps focus on the dialog when there are no focusable children', () => {
    render(
      <Dialog open title="T" onClose={vi.fn()}>
        <p>only text</p>
      </Dialog>,
    );
    const modal = document.querySelector('.modal') as HTMLElement;
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(modal);
  });
});

describe('ConfirmDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('runs onConfirm and guards duplicate clicks while pending', async () => {
    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { resolveConfirm = resolve; }));
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="确认" message="确认吗？" onConfirm={onConfirm} onCancel={onCancel} />);
    const button = screen.getByRole('button', { name: '确认' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolveConfirm();
    await act(async () => {});
    expect((screen.getByRole('button', { name: '确认' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('cancels through the cancel button', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="确认" message="确认吗？" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('PromptDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('submits text values and syncs external value changes', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <PromptDialog open title="输入" message="请填写" value="a" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('a');
    rerender(
      <PromptDialog open title="输入" message="请填写" value="b" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    expect(input.value).toBe('b');
    fireEvent.change(input, { target: { value: 'c' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(onSubmit).toHaveBeenCalledWith('c');
  });

  it('supports textarea and number input types', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <PromptDialog open title="备注" inputType="textarea" value="x" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'multi\nline' } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(onSubmit).toHaveBeenCalledWith('multi\nline');

    rerender(
      <PromptDialog open title="数量" inputType="number" value="5" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('5');
  });

  it('cancels through the cancel button', () => {
    const onCancel = vi.fn();
    render(<PromptDialog open title="输入" value="a" onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
