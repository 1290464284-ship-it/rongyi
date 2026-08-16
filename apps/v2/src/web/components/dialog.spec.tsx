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
    const close = screen.getByRole('button', { name: '关闭弹窗' });
    const last = screen.getByRole('button', { name: 'last' });
    // 打开后初始焦点落在头部关闭按钮（第一个可聚焦元素）
    expect(document.activeElement).toBe(close);
    last.focus();
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(modal, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
  });

  it('focuses the header close button when there are no other focusable children', () => {
    render(
      <Dialog open title="T" onClose={vi.fn()}>
        <p>only text</p>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭弹窗' }));
  });

  it('marks background siblings inert while open and restores them on close', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <div>
        <button type="button">background</button>
        <Dialog open title="T" onClose={onClose}><p>content</p></Dialog>
      </div>,
    );
    const background = document.querySelector<HTMLElement>('button');
    expect(background?.hasAttribute('inert')).toBe(true);
    rerender(
      <div>
        <button type="button">background</button>
        <Dialog open={false} title="T" onClose={onClose}><p>content</p></Dialog>
      </div>,
    );
    expect(background?.hasAttribute('inert')).toBe(false);
  });

  it('keeps only the topmost of stacked dialogs non-inert', () => {
    const { rerender } = render(
      <div>
        <button type="button">background</button>
        <Dialog open title="A" onClose={vi.fn()}><p>a</p></Dialog>
        <Dialog open title="B" onClose={vi.fn()}><p>b</p></Dialog>
      </div>,
    );
    const backdrops = document.querySelectorAll<HTMLElement>('.modal-backdrop');
    expect(backdrops).toHaveLength(2);
    expect(backdrops[0].hasAttribute('inert')).toBe(true);
    expect(backdrops[1].hasAttribute('inert')).toBe(false);
    rerender(
      <div>
        <button type="button">background</button>
        <Dialog open title="A" onClose={vi.fn()}><p>a</p></Dialog>
      </div>,
    );
    const remaining = document.querySelector<HTMLElement>('.modal-backdrop');
    expect(remaining?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector<HTMLElement>('button')?.hasAttribute('inert')).toBe(true);
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

  it('ignores submits while pending', () => {
    const onSubmit = vi.fn();
    render(<PromptDialog open title="输入" value="a" pending onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.submit(screen.getByRole('textbox').closest('form') as HTMLFormElement);
    fireEvent.click(screen.getByRole('button', { name: '处理中...' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('records a null previously-focused element for non-HTML active elements', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.defineProperty(document, 'activeElement', { value: svg, configurable: true });
    render(<Dialog open title="T" onClose={vi.fn()}><p>content</p></Dialog>);
    expect(screen.getByText('content')).toBeDefined();
    delete (document as unknown as Record<string, unknown>).activeElement;
  });

  it('clears the close timer when the dialog unmounts mid-animation', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open title="T" onClose={onClose}><p>content</p></Dialog>);
    vi.useFakeTimers();
    fireEvent.keyDown(document.querySelector('.modal')!, { key: 'Escape' });
    // 动画期间卸载：effect 清理会取消定时器
    rerender(<Dialog open={false} title="T" onClose={onClose}><p>content</p></Dialog>);
    act(() => vi.advanceTimersByTime(150));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores non-tab key presses and no-ops mid-list tabs', () => {
    render(
      <Dialog open title="T" onClose={vi.fn()}>
        <button type="button">first</button>
        <button type="button">last</button>
      </Dialog>,
    );
    const modal = document.querySelector('.modal') as HTMLElement;
    fireEvent.keyDown(modal, { key: 'ArrowDown' });
    const first = screen.getByRole('button', { name: 'first' });
    const last = screen.getByRole('button', { name: 'last' });
    // 中间元素上的普通 Tab：不拦截、不改变焦点
    first.focus();
    fireEvent.keyDown(modal, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    // Shift+Tab 且焦点在弹窗外：拉回最后一个可聚焦元素
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(modal, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
