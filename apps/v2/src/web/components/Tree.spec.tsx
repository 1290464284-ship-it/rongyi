// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Tree, type TreeNode } from './Tree';

const nodes: TreeNode[] = [
  {
    id: 'root',
    label: '根',
    badge: '3',
    badgeTone: 'warning',
    meta: '说明',
    action: '更多',
    actionAriaLabel: 'root-more',
    children: [{ id: 'child', label: '子项' }],
  },
  { id: 'leaf', label: '叶子' },
];

afterEach(() => {
  cleanup();
});

describe('Tree', () => {
  it('toggles children with the internal state and renders badges, meta and actions', () => {
    render(<Tree nodes={nodes} />);
    expect(screen.queryByText('子项')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开 根' }));
    expect(screen.getByText('子项')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '收起 根' }));
    expect(screen.queryByText('子项')).toBeNull();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('说明')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'root-more' }));
  });

  it('selects via click and keyboard and leaves leaf nodes without toggles', () => {
    const onSelect = vi.fn();
    render(<Tree nodes={nodes} onSelect={onSelect} />);
    const leaf = screen.getByText('叶子');
    fireEvent.click(leaf);
    expect(onSelect).toHaveBeenCalledWith('leaf');
    fireEvent.keyDown(leaf, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('leaf');
    expect(screen.queryByRole('button', { name: '展开 叶子' })).toBeNull();
  });

  it('honours controlled expanded ids and toggle callbacks', () => {
    const onToggle = vi.fn();
    render(<Tree nodes={nodes} expandedIds={{ root: true }} onToggle={onToggle} />);
    expect(screen.getByText('子项')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '收起 根' }));
    expect(onToggle).toHaveBeenCalledWith('root');
  });
});
