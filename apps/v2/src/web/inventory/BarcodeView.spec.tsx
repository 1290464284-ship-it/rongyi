// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BarcodeView } from './BarcodeView';

describe('BarcodeView', () => {
  it('renders an accessible Code39 barcode with a stable size', () => {
    const { container } = render(<BarcodeView value="RONGYI-001" />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('条码 RONGYI-001');
    expect(svg?.getAttribute('height')).toBe('56');
    expect(Number(svg?.getAttribute('width'))).toBeGreaterThan(0);
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('falls back to a barcode for unsupported characters', () => {
    const { container } = render(<BarcodeView value="你好" />);
    const svg = container.querySelector('svg[role="img"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('条码 你好');
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
  });
});
