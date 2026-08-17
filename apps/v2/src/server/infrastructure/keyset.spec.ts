import { describe, expect, it } from 'vitest';
import {
  keysetCondition,
  keysetOrder,
  nextCursorFrom,
  type KeysetSpec,
} from './keyset';

const createdAtDesc: KeysetSpec = {
  columns: [{ column: 'D.createdAt', key: 'createdAt' }],
  idColumn: 'D.id',
  direction: 'DESC',
};

describe('keyset pagination helpers', () => {
  it('builds a DESC condition from a single-column cursor', () => {
    const result = keysetCondition('2026-08-05T10:00:00.000Z|id-9', createdAtDesc);
    expect(result.where).toContain('D.createdAt < ? OR (D.createdAt = ? AND D.id < ?)');
    expect(result.params).toEqual(['2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z', 'id-9']);
  });

  it('builds an ASC condition with > operators', () => {
    const spec: KeysetSpec = {
      columns: [{ column: 'F.planDate', key: 'planDate' }],
      idColumn: 'F.id',
      direction: 'ASC',
    };
    const result = keysetCondition('2026-08-05|id-3', spec);
    expect(result.where).toContain('F.planDate > ? OR (F.planDate = ? AND F.id > ?)');
    expect(result.params).toEqual(['2026-08-05', '2026-08-05', 'id-3']);
  });

  it('builds a nested condition for multi-column cursors', () => {
    const spec: KeysetSpec = {
      columns: [
        { column: 'N.recordDate', key: 'recordDate' },
        { column: 'N.createdAt', key: 'createdAt' },
      ],
      idColumn: 'N.id',
      direction: 'DESC',
    };
    const result = keysetCondition('2026-08-05|2026-08-05T10:00:00.000Z|id-9', spec);
    expect(result.where).toContain('N.recordDate < ? OR (N.recordDate = ? AND N.createdAt < ?');
    expect(result.where).toContain('N.createdAt = ? AND N.id < ?');
    expect(result.params).toEqual(['2026-08-05', '2026-08-05', '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z', 'id-9']);
  });

  it('falls back to no condition for missing or malformed cursors', () => {
    expect(keysetCondition(undefined, createdAtDesc)).toEqual({ where: '', params: [] });
    expect(keysetCondition('bad-cursor', createdAtDesc).where).toBe('');
  });

  it('generates the keyset ORDER BY with an id tiebreak', () => {
    expect(keysetOrder(createdAtDesc)).toBe('ORDER BY D.createdAt DESC, D.id DESC');
    const asc: KeysetSpec = { columns: [{ column: 'planDate', key: 'planDate' }], idColumn: 'id', direction: 'ASC' };
    expect(keysetOrder(asc)).toBe('ORDER BY planDate ASC, id ASC');
  });

  it('computes nextCursor only when a full page plus one row is present', () => {
    const rows = [
      { createdAt: '2026-08-05T10:00:00.000Z', id: 'a' },
      { createdAt: '2026-08-05T09:00:00.000Z', id: 'b' },
      { createdAt: '2026-08-05T08:00:00.000Z', id: 'c' },
    ];
    expect(nextCursorFrom(rows, 2, createdAtDesc)).toBe('2026-08-05T09:00:00.000Z|b');
    expect(nextCursorFrom(rows.slice(0, 2), 2, createdAtDesc)).toBeNull();
  });
});
