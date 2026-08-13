// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Timeline } from './Timeline';
import { Tooltip } from './Tooltip';
import { MissingSelectOption } from './list-controls';

afterEach(() => {
  cleanup();
});

describe('Timeline', () => {
  it('renders items with and without tones, descriptions and times', () => {
    render(<Timeline
      items={[
        { title: '已完成', tone: 'done', description: '描述', time: '10:00' },
        { title: '无附加字段' },
      ]}
    />);
    expect(screen.getByText('已完成')).toBeDefined();
    expect(screen.getByText('描述')).toBeDefined();
    expect(screen.getByText('10:00')).toBeDefined();
    expect(screen.getByText('无附加字段')).toBeDefined();
  });
});

describe('Tooltip', () => {
  it('shows the tooltip on focus and supports plain text children', () => {
    const onFocus = vi.fn();
    render(
      <Tooltip content="提示">
        <button onFocus={onFocus}>按钮</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: '按钮' });
    fireEvent.focus(button);
    expect(onFocus).toHaveBeenCalled();
    expect(screen.getByRole('tooltip').classList.contains('visible')).toBe(true);
    fireEvent.blur(button);
    expect(screen.getByRole('tooltip').classList.contains('visible')).toBe(false);
  });

  it('renders non-element children without cloning', () => {
    render(<Tooltip content="提示">文本</Tooltip>);
    expect(screen.getByText('文本')).toBeDefined();
  });
});

describe('MissingSelectOption', () => {
  it('returns null for empty or missing values and renders labels otherwise', () => {
    const { container } = render(
      <select>
        <MissingSelectOption value="" />
        <MissingSelectOption value={null} />
        <MissingSelectOption value={undefined} />
        <MissingSelectOption value="x" label="未知" />
      </select>,
    );
    expect(container.querySelectorAll('option')).toHaveLength(1);
    expect(screen.getByText('未知')).toBeDefined();
  });
});
