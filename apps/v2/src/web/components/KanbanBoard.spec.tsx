// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KanbanBoard } from './KanbanBoard';

const columns = [
  { id: 'todo', title: '待办', cards: [{ id: 'card-1', title: '任务一', subtitle: '子标题', footer: <em>脚注</em> }] },
  { id: 'done', title: '完成', cards: [] },
];

afterEach(() => {
  cleanup();
});

describe('KanbanBoard', () => {
  it('moves a card with keyboard arrows and ignores invalid moves', () => {
    render(<KanbanBoard columns={columns} />);
    const card = screen.getByLabelText('卡片 任务一');
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    expect(screen.getByText('子标题')).toBeDefined();
    expect(screen.getByText('脚注')).toBeDefined();
    const doneColumn = screen.getByText('完成').closest('.ui-kanban-col');
    expect(doneColumn?.querySelectorAll('.ui-kanban-card')).toHaveLength(1);

    fireEvent.keyDown(screen.getByLabelText('卡片 任务一'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByLabelText('卡片 任务一'), { key: 'Home' });
  });

  it('drops a card onto another column and ignores unknown cards', () => {
    render(<KanbanBoard columns={columns} />);
    const doneColumn = screen.getByText('完成').closest('.ui-kanban-col') as HTMLElement;
    fireEvent.drop(doneColumn, { dataTransfer: { getData: () => 'card-1' } });
    expect(doneColumn.querySelectorAll('.ui-kanban-card')).toHaveLength(1);

    fireEvent.drop(doneColumn, { dataTransfer: { getData: () => 'unknown-card' } });
    expect(doneColumn.querySelectorAll('.ui-kanban-card')).toHaveLength(1);
  });

  it('reports moves through onChange when provided', () => {
    const onChange = vi.fn();
    render(<KanbanBoard columns={columns} onChange={onChange} />);
    const doneColumn = screen.getByText('完成').closest('.ui-kanban-col') as HTMLElement;
    fireEvent.drop(doneColumn, { dataTransfer: { getData: () => 'card-1' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0][1].cards.map((card: { id: string }) => card.id)).toEqual(['card-1']);
  });

  it('ignores an out-of-bounds keyboard move', () => {
    render(<KanbanBoard columns={columns} />);
    // 任务一在第一列，向左移出边界应被守卫拦截
    fireEvent.keyDown(screen.getByLabelText('卡片 任务一'), { key: 'ArrowLeft' });
    const todoColumn = screen.getByText('待办').closest('.ui-kanban-col');
    expect(todoColumn?.querySelectorAll('.ui-kanban-card')).toHaveLength(1);
    expect(screen.getByText('完成').closest('.ui-kanban-col')?.querySelectorAll('.ui-kanban-card')).toHaveLength(0);
  });

  it('reports keyboard moves through onChange when provided', () => {
    const onChange = vi.fn();
    render(<KanbanBoard columns={columns} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('卡片 任务一'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0][1].cards.map((card: { id: string }) => card.id)).toEqual(['card-1']);
  });

  it('ignores a keyboard move between columns that share an id', () => {
    const dupColumns = [
      { id: 'same', title: '左', cards: [{ id: 'card-1', title: '任务一' }] },
      { id: 'same', title: '右', cards: [] },
    ];
    render(<KanbanBoard columns={dupColumns} />);
    // 目标列与来源列 id 相同，moveCard 返回 null，移动被忽略
    fireEvent.keyDown(screen.getByLabelText('卡片 任务一'), { key: 'ArrowRight' });
    expect(screen.getByText('左').closest('.ui-kanban-col')?.querySelectorAll('.ui-kanban-card')).toHaveLength(1);
    expect(screen.getByText('右').closest('.ui-kanban-col')?.querySelectorAll('.ui-kanban-card')).toHaveLength(0);
  });
});
