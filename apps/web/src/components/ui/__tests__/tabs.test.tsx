/* eslint-disable @typescript-eslint/no-unused-vars -- TODO: 逐步修复 lint 问题 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../tabs';

function renderTabs(props: Partial<React.ComponentProps<typeof Tabs>> = {}) {
  return render(
    <Tabs defaultValue="tab1" {...props}>
      <TabsList>
        <TabsTrigger value="tab1">标签一</TabsTrigger>
        <TabsTrigger value="tab2">标签二</TabsTrigger>
        <TabsTrigger value="tab3" disabled>标签三</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">
        <div data-testid="content-1">内容一</div>
      </TabsContent>
      <TabsContent value="tab2">
        <div data-testid="content-2">内容二</div>
      </TabsContent>
      <TabsContent value="tab3">
        <div data-testid="content-3">内容三</div>
      </TabsContent>
    </Tabs>
  );
}

describe('Tabs 行为测试', () => {
  describe('默认渲染', () => {
    it('渲染默认标签内容', () => {
      renderTabs();
      expect(screen.getByTestId('content-1')).toBeInTheDocument();
      expect(screen.queryByTestId('content-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('content-3')).not.toBeInTheDocument();
    });

    it('默认触发器标记 aria-selected=true', () => {
      renderTabs();
      const triggers = screen.getAllByRole('tab');
      expect(triggers[0]).toHaveAttribute('aria-selected', 'true');
      expect(triggers[0]).toHaveAttribute('data-state', 'active');
      expect(triggers[1]).toHaveAttribute('aria-selected', 'false');
      expect(triggers[1]).toHaveAttribute('data-state', 'inactive');
    });
  });

  describe('标签切换', () => {
    it('点击触发器切换内容', async () => {
      const user = userEvent.setup();
      renderTabs();
      expect(screen.getByTestId('content-1')).toBeInTheDocument();
      await user.click(screen.getByText('标签二'));
      expect(screen.queryByTestId('content-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('content-2')).toBeInTheDocument();
    });

    it('切换后更新 aria-selected 和 data-state', async () => {
      const user = userEvent.setup();
      renderTabs();
      const triggers = screen.getAllByRole('tab');
      expect(triggers[0]).toHaveAttribute('aria-selected', 'true');
      await user.click(triggers[1]);
      expect(triggers[0]).toHaveAttribute('aria-selected', 'false');
      expect(triggers[1]).toHaveAttribute('aria-selected', 'true');
      expect(triggers[1]).toHaveAttribute('data-state', 'active');
    });

    it('onValueChange 回调被调用', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      renderTabs({ onValueChange });
      await user.click(screen.getByText('标签二'));
      expect(onValueChange).toHaveBeenCalledWith('tab2');
    });
  });

  describe('受控模式', () => {
    it('value 属性优先于 defaultValue', () => {
      render(
        <Tabs value="tab2">
          <TabsList>
            <TabsTrigger value="tab1">标签一</TabsTrigger>
            <TabsTrigger value="tab2">标签二</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">
            <div data-testid="content-1">内容一</div>
          </TabsContent>
          <TabsContent value="tab2">
            <div data-testid="content-2">内容二</div>
          </TabsContent>
        </Tabs>
      );
      expect(screen.queryByTestId('content-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('content-2')).toBeInTheDocument();
    });

    it('受控模式下点击不改变内部状态', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(
        <Tabs value="tab1" onValueChange={onValueChange}>
          <TabsList>
            <TabsTrigger value="tab1">标签一</TabsTrigger>
            <TabsTrigger value="tab2">标签二</TabsTrigger>
          </TabsList>
          <TabsContent value="tab1">
            <div data-testid="content-1">内容一</div>
          </TabsContent>
          <TabsContent value="tab2">
            <div data-testid="content-2">内容二</div>
          </TabsContent>
        </Tabs>
      );
      await user.click(screen.getByText('标签二'));
      // onValueChange 被调用但内容不变（因为 value 固定为 tab1）
      expect(onValueChange).toHaveBeenCalledWith('tab2');
      expect(screen.getByTestId('content-1')).toBeInTheDocument();
      expect(screen.queryByTestId('content-2')).not.toBeInTheDocument();
    });
  });

  describe('禁用触发器', () => {
    it('disabled 触发器不响应点击', async () => {
      const user = userEvent.setup();
      renderTabs();
      const disabledTrigger = screen.getByText('标签三');
      expect(disabledTrigger).toBeDisabled();
      await user.click(disabledTrigger);
      // 内容不切换
      expect(screen.getByTestId('content-1')).toBeInTheDocument();
    });

    it('disabled 触发器有 disabled 属性', () => {
      renderTabs();
      const triggers = screen.getAllByRole('tab');
      expect(triggers[2]).toBeDisabled();
    });
  });

  describe('Context 安全', () => {
    it('TabsTrigger 在 Tabs 外部使用时抛出错误', () => {
      // 抑制 React error boundary 的 console.error
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => {
        render(<TabsTrigger value="x">孤立</TabsTrigger>);
      }).toThrow('Tabs components must be used within <Tabs>');
      spy.mockRestore();
    });

    it('TabsContent 在 Tabs 外部使用时抛出错误', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => {
        render(<TabsContent value="x">孤立</TabsContent>);
      }).toThrow('Tabs components must be used within <Tabs>');
      spy.mockRestore();
    });
  });

  describe('TabsContent role', () => {
    it('活跃面板有 role=tabpanel', () => {
      renderTabs();
      expect(screen.getByRole('tabpanel')).toHaveTextContent('内容一');
    });

    it('非活跃面板不渲染', () => {
      renderTabs();
      const panels = screen.queryAllByRole('tabpanel');
      expect(panels).toHaveLength(1);
    });
  });
});
