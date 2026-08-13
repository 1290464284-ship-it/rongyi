// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintPreview } from './PrintPreview';

describe('PrintPreview', () => {
  it('renders sparse items with fallbacks and a default template', () => {
    vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<PrintPreview
      onClose={vi.fn()}
      payload={{
        plan: { name: '计划', patientName: null, doctorName: null },
        items: [{ name: null, quantity: null, price: 0 }],
        template: null,
      }}
    />);
    expect(screen.getByText('默认模板')).toBeDefined();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    vi.restoreAllMocks();
  });
});
