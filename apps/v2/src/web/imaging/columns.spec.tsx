// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { categoryColumns, imagingColumns } from './columns';

describe('imaging/columns', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders imaging columns with fallbacks', () => {
    const columns = imagingColumns([{ id: 'cat-1', name: '全景' }]);
    const get = (key: string) => {
      const column = columns.find((entry) => entry.key === key);
      return column && typeof column.render === 'function' ? column.render({ id: 'i-1' } as never) : '';
    };
    expect(get('preview')).not.toBeNull();
    expect(get('categoryId')).toBe('');
    expect(get('phase')).toBe('');
    expect(get('patientId')).toBe('');
    expect(get('doctorId')).toBe('');
    expect(get('takenAt')).toBe('');

    const labeled = {
      id: 'i-2',
      patientIdLabel: '张三',
      doctorIdLabel: '李医生',
      categoryId: 'cat-1',
      phase: 'INITIAL',
      takenAt: '2026-08-10T10:30:00.000Z',
    } as never;
    expect(columns.find((entry) => entry.key === 'categoryId')?.render?.(labeled)).toBe('全景');
    expect(columns.find((entry) => entry.key === 'phase')?.render?.(labeled)).toBe('初诊');
    expect(columns.find((entry) => entry.key === 'patientId')?.render?.(labeled)).toBe('张三');
    expect(columns.find((entry) => entry.key === 'doctorId')?.render?.(labeled)).toBe('李医生');
    expect(String(columns.find((entry) => entry.key === 'takenAt')?.render?.(labeled))).toContain('2026');
  });

  it('renders category columns and forwards handlers', () => {
    const handlers = { onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn() };
    const columns = categoryColumns(handlers);
    const type = columns.find((entry) => entry.key === 'type')?.render?.({ id: 'c1', type: 'ORTHODONTIC' } as never);
    expect(type).toBe('正畸');
    const active = columns.find((entry) => entry.key === 'active')?.render?.({ id: 'c1', active: false } as never);
    expect(active).toBe('停用');

    const actions = columns.find((entry) => entry.key === 'actions')?.render?.({ id: 'c1', name: '全景', active: true } as never);
    render(<>{actions}</>);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(handlers.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(handlers.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(handlers.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });
});
