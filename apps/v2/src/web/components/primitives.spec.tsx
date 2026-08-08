// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Accordion } from './Accordion';
import { Drawer } from './Drawer';
import { Segmented } from './Segmented';
import { Switch } from './Switch';
import { Tooltip } from './Tooltip';

afterEach(cleanup);

describe('UI primitives', () => {
  it('toggles a Switch', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="启用" />);
    const button = screen.getByRole('switch', { name: '启用' });
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('selects a Segmented option', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value="day"
        onChange={onChange}
        options={[{ value: 'day', label: '今日' }, { value: 'week', label: '本周' }]}
      />,
    );
    fireEvent.click(screen.getByText('本周'));
    expect(onChange).toHaveBeenCalledWith('week');
  });

  it('opens and closes an Accordion item', () => {
    render(<Accordion items={[{ title: '设置', content: '内容' }, { title: '其他', content: '其他内容' }]} />);
    fireEvent.click(screen.getByText('其他'));
    expect(screen.getByText('其他内容')).toBeDefined();
    fireEvent.click(screen.getByText('设置'));
    expect(screen.getByText('内容')).toBeDefined();
  });

  it('renders Tooltip content', () => {
    render(<Tooltip content="帮助">按钮</Tooltip>);
    expect(screen.getByRole('tooltip').textContent).toBe('帮助');
  });

  it('closes Drawer with Escape', () => {
    const onClose = vi.fn();
    render(<Drawer open title="抽屉" onClose={onClose}>内容</Drawer>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
