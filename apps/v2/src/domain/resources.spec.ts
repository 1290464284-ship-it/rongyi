import { describe, expect, it } from 'vitest';
import { resourceRegistry } from './resources';

describe('resourceRegistry', () => {
  it('contains the core clinical and financial resources', () => {
    for (const name of ['patients', 'appointments', 'visits', 'treatments', 'charges', 'inventoryItems', 'followUps']) {
      expect(resourceRegistry.get(name)).toBeDefined();
    }
  });

  it('marks charge and refund resources for audit', () => {
    expect(resourceRegistry.get('charges')?.audit).toBe(true);
    expect(resourceRegistry.get('refunds')?.audit).toBe(true);
  });
});

