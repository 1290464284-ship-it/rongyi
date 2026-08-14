// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BackupStatusCard } from './BackupStatusCard';
import { DentalChart } from './DentalChart';
import { KanbanBoard } from './KanbanBoard';
import { Tooltip } from './Tooltip';
import { Tree } from './Tree';
import { UploadPreview } from './UploadPreview';
import { PagePager, SearchInput } from './list-controls';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UI primitives', () => {



  it('navigates pages with the shared PagePager', () => {
    const onPageChange = vi.fn();
    render(<PagePager page={2} hasNext onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: '上一页' }).getAttribute('type')).toBe('button');
    expect(screen.getByRole('button', { name: '下一页' }).getAttribute('type')).toBe('button');
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
    cleanup();
    render(<PagePager page={1} hasNext={false} onPageChange={onPageChange} />);
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const disabledChange = vi.fn();
    render(<PagePager page={2} hasNext disabled onPageChange={disabledChange} />);
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(disabledChange).not.toHaveBeenCalled();
  });

  it('emits debounced-style search changes through the shared SearchInput', () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索' }), { target: { value: '张三' } });
    expect(onChange).toHaveBeenCalledWith('张三');
  });




  it('renders Tooltip content', () => {
    render(<Tooltip content="帮助">按钮</Tooltip>);
    expect(screen.getByRole('tooltip').textContent).toBe('帮助');
  });

  it('shows Tooltip on focus and hides on blur', () => {
    render(<Tooltip content="帮助"><button type="button">按钮</button></Tooltip>);
    const button = screen.getByRole('button', { name: '按钮' });
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip').className).toContain('visible');
    fireEvent.blur(button);
    expect(screen.getByRole('tooltip').className).not.toContain('visible');
  });



  it('expands Tree and selects a node', () => {
    const onSelect = vi.fn();
    render(<Tree nodes={[{ id: 'root', label: '根', children: [{ id: 'leaf', label: '叶子' }] }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '展开 根' }));
    fireEvent.click(screen.getByText('叶子'));
    expect(onSelect).toHaveBeenCalledWith('leaf');
  });

  it('does not render a focusable toggle button for leaf nodes', () => {
    render(<Tree nodes={[{ id: 'root', label: '根', children: [{ id: 'leaf', label: '叶子' }] }]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '展开 根' }));
    expect(screen.getByText('叶子')).toBeDefined();
    expect(document.querySelectorAll('.ui-tree-toggle')).toHaveLength(1);
  });

  it('supports controlled Tree expansion and node actions', () => {
    const onToggle = vi.fn();
    const onAction = vi.fn();
    render(
      <Tree
        nodes={[{
          id: 'root',
          label: '根',
          children: [{
            id: 'leaf',
            label: '叶子',
            meta: '¥50.00',
            action: '划价',
            actionAriaLabel: '快捷划价 叶子',
          }],
        }]}
        expandedIds={{ root: true }}
        onToggle={onToggle}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '收起 根' }));
    expect(onToggle).toHaveBeenCalledWith('root');
    fireEvent.click(screen.getByRole('button', { name: '快捷划价 叶子' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'leaf', label: '叶子' }));
  });




  it('selects Tree nodes from the keyboard', () => {
    const onSelect = vi.fn();
    render(<Tree nodes={[{ id: 'root', label: '根', children: [{ id: 'leaf', label: '叶子' }] }]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '展开 根' }));
    const leaf = screen.getByRole('button', { name: '叶子' });
    fireEvent.keyDown(leaf, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('leaf');
  });

  it('renders DentalChart and forwards tooth clicks', () => {
    const onClick = vi.fn();
    render(<DentalChart upper={[11]} lower={[41]} onToothClick={onClick} />);
    fireEvent.click(screen.getByText('11'));
    expect(onClick).toHaveBeenCalledWith(11);
  });


  it('renders BackupStatusCard states', () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <BackupStatusCard hasBackups={false} isLoading={false} isError={false} timeLabel="从未备份" onOpenBackups={onOpen} />,
    );
    expect(screen.getByText('暂无备份')).toBeDefined();
    expect(screen.getByText('从未备份')).toBeDefined();

    rerender(
      <BackupStatusCard hasBackups isLoading={false} isError timeLabel="2026-08-01 10:00" onOpenBackups={onOpen} />,
    );
    expect(screen.getByText('数据已同步')).toBeDefined();
    expect(screen.getByText('备份状态不可用')).toBeDefined();

    rerender(
      <BackupStatusCard hasBackups isLoading isError={false} timeLabel="2026-08-01 10:00" onOpenBackups={onOpen} />,
    );
    expect(screen.getByText('读取中...')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '备份设置' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });


  it('moves a Kanban card between columns', () => {
    const onChange = vi.fn();
    const columns = [
      { id: 'todo', title: '待办', cards: [{ id: 'c1', title: '卡1' }] },
      { id: 'done', title: '完成', cards: [] },
    ];
    render(<KanbanBoard columns={columns} onChange={onChange} />);
    const dataTransfer = { setData: vi.fn(), getData: () => 'c1' };
    fireEvent.dragStart(screen.getByText('卡1'), { dataTransfer });
    fireEvent.drop(screen.getByText('完成'), { dataTransfer });
    expect(onChange).toHaveBeenCalledWith([
      { id: 'todo', title: '待办', cards: [] },
      { id: 'done', title: '完成', cards: [{ id: 'c1', title: '卡1' }] },
    ]);
  });






});

describe('shared primitive edge cases', () => {





  it('keeps Kanban cards on the same column and renders extras', () => {
    const onChange = vi.fn();
    const columns = [
      { id: 'todo', title: '待办', cards: [{ id: 'c1', title: '卡1', subtitle: '副标题', footer: <span>底部</span> }] },
      { id: 'done', title: '完成', cards: [] },
    ];
    render(<KanbanBoard columns={columns} onChange={onChange} />);
    expect(screen.getByText('副标题')).toBeDefined();
    expect(screen.getByText('底部')).toBeDefined();
    const dataTransfer = { setData: vi.fn(), getData: () => 'c1' };
    fireEvent.dragStart(screen.getByText('卡1'), { dataTransfer });
    fireEvent.drop(screen.getByText('待办'), { dataTransfer });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves Kanban cards in uncontrolled mode', () => {
    const columns = [
      { id: 'todo', title: '待办', cards: [{ id: 'c1', title: '卡1' }] },
      { id: 'done', title: '完成', cards: [] },
    ];
    render(<KanbanBoard columns={columns} />);
    const dataTransfer = { setData: vi.fn(), getData: () => 'c1' };
    fireEvent.dragStart(screen.getByText('卡1'), { dataTransfer });
    fireEvent.drop(screen.getByText('完成'), { dataTransfer });
    expect(screen.getByText('完成').closest('.ui-kanban-col')!.textContent).toContain('卡1');
  });

  it('toggles the drag-over class and ignores unknown Kanban cards', () => {
    const onChange = vi.fn();
    const columns = [
      { id: 'todo', title: '待办', cards: [{ id: 'c1', title: '卡1' }] },
      { id: 'done', title: '完成', cards: [] },
    ];
    render(<KanbanBoard columns={columns} onChange={onChange} />);
    const column = screen.getByText('待办').closest('.ui-kanban-col') as HTMLElement;
    const dataTransfer = { setData: vi.fn(), getData: () => 'missing' };
    fireEvent.dragOver(column, { dataTransfer });
    expect(column.className).toContain('drag-over');
    fireEvent.dragLeave(column, { dataTransfer });
    expect(column.className).not.toContain('drag-over');
    fireEvent.drop(screen.getByText('完成'), { dataTransfer });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders UploadPreview empty, image and remove states', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<UploadPreview files={[]} />);
    expect(screen.getByText('暂无上传文件')).toBeDefined();

    rerender(
      <UploadPreview
        files={[
          { id: 'f1', name: 'a.png', size: '1KB', url: '/a.png' },
          { id: 'f2', name: 'b.pdf', size: '2KB' },
        ]}
        onRemove={onRemove}
      />,
    );
    expect(document.querySelector('.ui-upload-item img')?.getAttribute('src')).toContain('/a.png');
    expect(screen.getByText('b.pdf')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '移除 b.pdf' }));
    expect(onRemove).toHaveBeenCalledWith('f2');
  });



});
