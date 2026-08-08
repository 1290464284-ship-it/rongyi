// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Accordion } from './Accordion';
import { Badge } from './Badge';
import { BatchBar } from './BatchBar';
import { DateRange } from './DateRange';
import { DentalChart } from './DentalChart';
import { Dropdown } from './Dropdown';
import { Drawer } from './Drawer';
import { MultiSelect } from './MultiSelect';
import { Progress } from './Progress';
import { Segmented } from './Segmented';
import { Steps } from './Steps';
import { Switch } from './Switch';
import { Timeline } from './Timeline';
import { Tooltip } from './Tooltip';
import { Tree } from './Tree';

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

  it('steps through Steps and invokes onChange', () => {
    const onChange = vi.fn();
    render(<Steps current={1} onChange={onChange} items={[{ label: '第一步' }, { label: '第二步' }]} />);
    fireEvent.click(screen.getByText('第二步'));
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('expands Tree and selects a node', () => {
    const onSelect = vi.fn();
    render(<Tree nodes={[{ id: 'root', label: '根', children: [{ id: 'leaf', label: '叶子' }] }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    fireEvent.click(screen.getByText('叶子'));
    expect(onSelect).toHaveBeenCalledWith('leaf');
  });

  it('opens Dropdown and triggers item action', () => {
    const onClick = vi.fn();
    render(<Dropdown label="更多" items={[{ label: '删除', danger: true, onClick }]} />);
    fireEvent.click(screen.getByText('更多'));
    fireEvent.click(screen.getByText('删除'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders DentalChart and forwards tooth clicks', () => {
    const onClick = vi.fn();
    render(<DentalChart upper={[11]} lower={[41]} onToothClick={onClick} />);
    fireEvent.click(screen.getByText('11'));
    expect(onClick).toHaveBeenCalledWith(11);
  });

  it('renders Timeline and BatchBar', () => {
    const onDelete = vi.fn();
    render(<Timeline items={[{ title: '登记', time: '09:00', tone: 'done' }]} />);
    expect(screen.getByText('登记')).toBeDefined();
    render(<BatchBar count={2} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('批量删除'));
    expect(onDelete).toHaveBeenCalled();
  });

  it('toggles a MultiSelect option', () => {
    const onChange = vi.fn();
    render(<MultiSelect value={[]} onChange={onChange} options={[{ value: 'a', label: '洁牙' }, { value: 'b', label: '补牙' }]} />);
    fireEvent.click(screen.getByText('请选择'));
    fireEvent.click(screen.getByText('洁牙'));
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('filters MultiSelect options by search', () => {
    const onChange = vi.fn();
    render(<MultiSelect value={[]} onChange={onChange} options={[{ value: 'a', label: '洁牙' }, { value: 'b', label: '补牙' }]} />);
    fireEvent.click(screen.getByText('请选择'));
    fireEvent.change(screen.getByLabelText('筛选选项'), { target: { value: '洁' } });
    expect(screen.getByText('洁牙')).toBeDefined();
    expect(screen.queryByText('补牙')).toBeNull();
    fireEvent.click(screen.getByText('洁牙'));
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('updates DateRange values', () => {
    const onChange = vi.fn();
    render(<DateRange onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-08-01' } });
    expect(onChange).toHaveBeenCalledWith('2026-08-01', undefined);
  });

  it('renders Progress and Badge', () => {
    render(<Progress value={40} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    render(<Badge tone="success">已完成</Badge>);
    expect(screen.getByText('已完成')).toBeDefined();
  });
});
