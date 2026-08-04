// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, PageError } from './components';

describe('shared web components', () => {
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

  it('renders page errors', () => {
    render(<PageError message="Request failed" />);
    expect(screen.getByText('Request failed')).toBeDefined();
  });
});
