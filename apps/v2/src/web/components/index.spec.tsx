// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  LoadingState,
  PageError,
  PromptDialog,
} from '.';
import { centsToYuanString, formatDate, formatDateTime, formatDisplayValue, formatMoney, toCents } from '../lib/format';

describe('shared web components', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders table columns and values', () => {
    render(
      <DataTable
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
        ]}
        rows={[{ name: 'A', status: 'OPEN' }, { name: 'B', status: 'DONE' }]}
        keyField="name"
      />,
    );
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('A')).toBeDefined();
    expect(screen.getByText('DONE')).toBeDefined();
  });

  it('renders custom cell content and empty state', () => {
    const { rerender } = render(
      <DataTable
        columns={[{ key: 'id', label: 'ID', render: (row) => <button>{String(row.id)}</button> }]}
        rows={[{ id: 'x' }]}
        keyField="id"
      />,
    );
    expect(screen.getByRole('button', { name: 'x' })).toBeDefined();

    rerender(
      <DataTable
        columns={[{ key: 'id', label: 'ID' }]}
        rows={[]}
        keyField="id"
        emptyText="Nothing here"
      />,
    );
    expect(screen.getByText('Nothing here')).toBeDefined();
  });

  it('renders rows without a stable key field', () => {
    render(
      <DataTable
        columns={[
          { key: 'amount', label: 'Amount' },
          { key: 'period', label: 'Period' },
        ]}
        rows={[{ amount: 10, period: '2026-08' }]}
      />,
    );
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('2026-08')).toBeDefined();
  });

  it('caps rendering at 500 rows and shows the truncation notice', () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: `r-${index}`, name: `行 ${index}` }));
    render(
      <DataTable
        columns={[{ key: 'name', label: '名称' }]}
        rows={rows}
        keyField="id"
      />,
    );
    expect(screen.getByText('仅显示前 500 行（共 501 行），请使用搜索或筛选缩小范围')).toBeDefined();
    expect(screen.queryByText('行 500')).toBeNull();
    const container = document.querySelector('.data-table-scroll') as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 20000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 19500, configurable: true });
    for (let index = 0; index < 5; index += 1) fireEvent.scroll(container);
    expect(screen.queryByText('行 499')).not.toBeNull();
    expect(screen.queryByText('行 500')).toBeNull();
  });

  it('renders rows when the key field value is null', () => {
    render(
      <DataTable
        columns={[{ key: 'name', label: 'Name' }]}
        rows={[{ id: null, name: 'Null Key' }]}
        keyField="id"
      />,
    );
    expect(screen.getByText('Null Key')).toBeDefined();
  });

  it('renders page errors', () => {
    render(<PageError message="Request failed" />);
    expect(screen.getByText('操作失败，请稍后重试')).toBeDefined();
  });

  it('renders loading and empty states', () => {
    render(<LoadingState />);
    expect(screen.getByText('加载中...')).toBeDefined();
    render(<EmptyState message="没有记录" />);
    expect(screen.getByText('没有记录')).toBeDefined();
  });

  it('opens and closes dialogs and confirms destructive actions', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open={false} message="删除？" onConfirm={onConfirm} onCancel={onClose} danger />,
    );
    expect(screen.queryByText('删除？')).toBeNull();

    rerender(
      <ConfirmDialog open title="删除确认" message="删除？" confirmText="删除" danger onConfirm={onConfirm} onCancel={onClose} />,
    );
    expect(screen.getByRole('dialog')).toBeDefined();
    fireEvent.click(screen.getByText('删除'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // pending 期间两按钮禁用；等异步 onConfirm 的微任务完成、状态复位后再点取消
    await act(async () => {});
    fireEvent.click(screen.getByText('取消'));
    // 关闭先播 120ms 淡出动画，动画结束后才通知父组件
    act(() => vi.advanceTimersByTime(150));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits prompt values and supports textarea and number inputs', () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <PromptDialog open title="输入" value="hello" onSubmit={onSubmit} onCancel={onCancel} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated' } });
    fireEvent.click(screen.getByText('确认'));
    expect(onSubmit).toHaveBeenCalledWith('updated');

    rerender(
      <PromptDialog open title="输入" inputType="number" value="1" onSubmit={onSubmit} onCancel={onCancel} />,
    );
    expect(screen.getByRole('spinbutton')).toBeDefined();
    fireEvent.click(screen.getByText('取消'));
    act(() => vi.advanceTimersByTime(150));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <PromptDialog open title="输入" message="请填写" inputType="textarea" value="note" onSubmit={onSubmit} onCancel={onCancel} />,
    );
    expect(screen.getByText('请填写')).toBeDefined();
    expect(screen.getByRole('textbox')).toBeDefined();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated note' } });
    fireEvent.click(screen.getByText('确认'));
    expect(onSubmit).toHaveBeenCalledWith('updated note');
  });

  it('formats money, dates, datetime, booleans, enums, and objects', () => {
    expect(formatMoney(12345)).toBe('¥123.45');
    expect(formatMoney('bad')).toBe('bad');
    expect(formatMoney(null)).toBe('');
    expect(formatDate('2026-08-05')).toContain('2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('bad')).toBe('bad');
    expect(formatDateTime('2026-08-05T02:00:00.000Z')).toContain('2026');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('bad')).toBe('bad');
    expect(formatDisplayValue(true, { name: 'active', type: 'boolean' })).toBe('是');
    expect(formatDisplayValue(false, { name: 'active', type: 'boolean' })).toBe('否');
    expect(formatDisplayValue(100, { name: 'price', type: 'money', format: 'money' })).toBe('¥1.00');
    expect(formatDisplayValue('2026-08-05', { name: 'day', type: 'date', format: 'date' })).toContain('2026');
    expect(formatDisplayValue('2026-08-05T02:00:00.000Z', { name: 'time', type: 'datetime', format: 'datetime' })).toContain('2026');
    expect(formatDisplayValue({ key: 'v' }, { name: 'data', type: 'json' })).toBe('{"key":"v"}');
    expect(formatDisplayValue('MALE', {
      name: 'gender',
      type: 'enum',
      enumLabels: { MALE: '男' },
    })).toBe('男');
    expect(formatDisplayValue('X', {
      name: 'gender',
      type: 'enum',
      enumLabels: { MALE: '男' },
    })).toBe('X');
  });

  it('covers nullish cents and invalid date fallbacks', () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents('abc')).toBe(0);
    expect(toCents(10.5)).toBe(1050);
    expect(centsToYuanString(null)).toBe('');
    expect(centsToYuanString('abc')).toBe('abc');
    expect(centsToYuanString(12345)).toBe('123.45');
    // 非 date-only 文本经 Date 解析成功 → 本地化日期
    expect(formatDate('2026-08-05T10:00:00Z')).toContain('2026');
  });

  it('closes dialogs when the backdrop is clicked', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <Dialog open title="弹窗" onClose={onClose}>
        <p>内容</p>
      </Dialog>,
    );
    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
    // 关闭动画 120ms 播放完成后才移除
    act(() => vi.advanceTimersByTime(150));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close dialogs when content inside the dialog is clicked', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="弹窗" onClose={onClose}>
        <p>内容</p>
      </Dialog>,
    );
    fireEvent.mouseDown(document.querySelector('.modal')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('confirms without the danger style', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open message="确定？" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('确认'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog with Escape and restores focus to the opener', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>打开</button>
          <Dialog open={open} title="弹窗" onClose={() => { onClose(); setOpen(false); }}>
            <button>弹窗内按钮</button>
          </Dialog>
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByText('打开');
    opener.focus();
    fireEvent.click(opener);
    // 打开后焦点移入弹窗
    expect(document.activeElement).toBe(screen.getByText('弹窗内按钮'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    // 关闭动画 120ms 播放完成后才移除并还原焦点
    act(() => vi.advanceTimersByTime(150));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    // 关闭后焦点还原到打开弹窗的元素
    expect(document.activeElement).toBe(opener);
  });

  it('moves focus into the dialog on open and traps Tab inside it', () => {
    const onClose = vi.fn();
    render(
      <div>
        <button>外部按钮</button>
        <Dialog open title="弹窗" onClose={onClose}>
          <button>第一个</button>
          <button>第二个</button>
        </Dialog>
      </div>,
    );
    expect(document.activeElement).toBe(screen.getByText('第一个'));

    // Tab 在最后一个可聚焦元素上循环回第一个
    screen.getByText('第二个').focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('第一个'));

    // Shift+Tab 从第一个循环到最后一个
    screen.getByText('第一个').focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('第二个'));

    // 焦点逃逸到弹窗外时，Tab 拉回弹窗内
    (document.querySelector('.modal-backdrop') as HTMLElement)?.focus?.();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('第一个'));
  });
});
