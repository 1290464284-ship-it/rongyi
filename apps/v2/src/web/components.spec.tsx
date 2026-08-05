// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  LoadingState,
  PageError,
  PromptDialog,
} from './components';
import { formatDate, formatDateTime, formatDisplayValue, formatMoney } from './format';

describe('shared web components', () => {
  afterEach(() => {
    cleanup();
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
    expect(screen.getByText('Request failed')).toBeDefined();
  });

  it('renders loading and empty states', () => {
    render(<LoadingState />);
    expect(screen.getByText('加载中...')).toBeDefined();
    render(<EmptyState message="没有记录" />);
    expect(screen.getByText('没有记录')).toBeDefined();
  });

  it('opens and closes dialogs and confirms destructive actions', () => {
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
    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits prompt values and supports textarea and number inputs', () => {
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

  it('closes dialogs when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="弹窗" onClose={onClose}>
        <p>内容</p>
      </Dialog>,
    );
    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!);
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
});
