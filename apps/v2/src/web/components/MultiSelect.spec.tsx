// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MultiSelect } from './MultiSelect';

const options = [
  { value: '1', label: '根管治疗' },
  { value: '2', label: '正畸' },
  { value: '3', label: '种植' },
];

describe('MultiSelect', () => {
  let onChange: (value: string[]) => void;

  beforeEach(() => {
    onChange = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows selected chips and toggles options', () => {
    render(<MultiSelect value={['1']} options={options} onChange={onChange} />);
    expect(screen.getByText('根管治疗')).toBeDefined();

    fireEvent.click(screen.getByText('根管治疗'));
    fireEvent.click(screen.getByLabelText('正畸'));
    expect(onChange).toHaveBeenLastCalledWith(['1', '2']);
  });

  it('exposes options with listbox semantics', () => {
    render(<MultiSelect value={['1']} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '请选择' }));
    expect(screen.getByRole('option', { name: /根管治疗/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: /正畸/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('supports keyboard navigation with arrow keys and Enter', () => {
    render(<MultiSelect value={[]} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '请选择' }));
    const search = screen.getByRole('searchbox', { name: '筛选选项' }) as HTMLInputElement;
    search.focus();
    expect(search.getAttribute('aria-activedescendant')).toContain('multiselect-option-1');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search.getAttribute('aria-activedescendant')).toContain('multiselect-option-2');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['2']);
  });

  it('filters options by search query', () => {
    render(<MultiSelect value={[]} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByText('请选择'));
    const search = screen.getByRole('searchbox', { name: '筛选选项' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: '正畸' } });
    expect(screen.getByText('正畸')).toBeDefined();
    expect(screen.queryByText('根管治疗')).toBeNull();
    expect(screen.queryByText('种植')).toBeNull();
  });

  it('closes when clicking outside after the close delay', () => {
    vi.useFakeTimers();
    render(<MultiSelect value={[]} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByText('请选择'));
    expect(screen.getByRole('searchbox')).toBeDefined();

    act(() => {
      fireEvent.mouseDown(document.body);
      vi.advanceTimersByTime(140);
    });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('toggles a selected option off', () => {
    render(<MultiSelect value={['1', '2']} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByText('根管治疗'));
    fireEvent.click(screen.getByLabelText('根管治疗'));
    expect(onChange).toHaveBeenLastCalledWith(['2']);
  });

  it('closes on a second trigger click and reopens with a reset search', () => {
    vi.useFakeTimers();
    render(<MultiSelect value={[]} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByText('请选择'));
    fireEvent.change(screen.getByRole('searchbox', { name: '筛选选项' }), { target: { value: '正畸' } });
    expect(screen.queryByText('根管治疗')).toBeNull();

    fireEvent.click(screen.getByText('请选择'));
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('searchbox')).toBeNull();

    fireEvent.click(screen.getByText('请选择'));
    expect((screen.getByRole('searchbox', { name: '筛选选项' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('根管治疗')).toBeDefined();
    expect(screen.getByText('正畸')).toBeDefined();
  });
});
