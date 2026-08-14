import { describe, expect, it } from 'vitest';
import { itemRowToForm } from './form';

describe('prescriptions/form', () => {
  it('falls back to blank strings and zero price for sparse server rows', () => {
    const row = itemRowToForm({ id: 'i-1' });
    expect(row.id).toBe('i-1');
    expect(row.name).toBe('');
    expect(row.spec).toBe('');
    expect(row.dosage).toBe('');
    expect(row.frequency).toBe('');
    expect(row.days).toBe('');
    expect(row.quantity).toBe('');
    expect(row.price).toBe('0.00');
  });

  it('maps populated server rows to the edit form', () => {
    const row = itemRowToForm({
      id: 'i-2',
      name: '阿莫西林',
      specification: '0.25g',
      dosage: '1粒',
      frequency: '每日三次',
      days: 5,
      quantity: 2,
      price: 1200,
    });
    expect(row).toMatchObject({
      id: 'i-2',
      name: '阿莫西林',
      spec: '0.25g',
      dosage: '1粒',
      frequency: '每日三次',
      days: '5',
      quantity: '2',
      price: '12.00',
    });
  });
});
