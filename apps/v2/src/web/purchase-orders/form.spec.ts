// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { buildValidItems, emptyPurchaseForm, newItem } from './form';

describe('purchase-orders/form', () => {
  it('creates default purchase items and forms', () => {
    const item = newItem();
    expect(item.quantity).toBe('1');
    expect(emptyPurchaseForm().items).toHaveLength(1);
  });

  it('builds valid items with form names or a custom fallback', () => {
    const rows = [
      { id: 'a', itemId: 'i-1', name: '', spec: '', quantity: '2', unitPrice: '100' },
      { id: 'b', itemId: '', name: '', spec: '', quantity: '1', unitPrice: '50' },
      { id: 'c', itemId: 'i-1', name: '', spec: '', quantity: '0', unitPrice: '100' },
    ];
    const valid = buildValidItems(rows as never);
    expect(valid).toHaveLength(2);
    expect(valid[0]).toMatchObject({ itemId: 'i-1', name: '自定义项目', quantity: 2, unitPrice: 10000 });
    expect(valid[1]).toMatchObject({ itemId: undefined, name: '自定义项目', quantity: 1, unitPrice: 5000 });
  });
});
