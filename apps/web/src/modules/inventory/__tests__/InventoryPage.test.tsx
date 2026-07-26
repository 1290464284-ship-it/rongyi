import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 子 Tab 组件，隔离测试 InventoryPage 自身的切换逻辑
vi.mock('../components/InventoryListTab', () => ({
  InventoryListTab: () => <div data-testid="tab-list">库存列表 Tab</div>,
}));
vi.mock('../components/TransactionsTab', () => ({
  TransactionsTab: () => <div data-testid="tab-transactions">出入库记录 Tab</div>,
}));
vi.mock('../components/LowStockTab', () => ({
  LowStockTab: () => <div data-testid="tab-lowstock">低库存预警 Tab</div>,
}));

import InventoryPage from '../InventoryPage';

describe('InventoryPage 库存管理页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染页面标题和描述', () => {
    render(<InventoryPage />);
    expect(screen.getByText('库存管理')).toBeInTheDocument();
    expect(screen.getByText('管理库存物资及出入库记录')).toBeInTheDocument();
  });

  it('展示三个 Tab：库存列表 / 出入库记录 / 低库存预警', () => {
    render(<InventoryPage />);
    expect(screen.getByText('库存列表')).toBeInTheDocument();
    expect(screen.getByText('出入库记录')).toBeInTheDocument();
    expect(screen.getByText('低库存预警')).toBeInTheDocument();
  });

  it('默认显示库存列表 Tab', () => {
    render(<InventoryPage />);
    expect(screen.getByTestId('tab-list')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-transactions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-lowstock')).not.toBeInTheDocument();
  });

  it('点击"出入库记录"切换到对应 Tab', async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.click(screen.getByText('出入库记录'));

    await waitFor(() => {
      expect(screen.getByTestId('tab-transactions')).toBeInTheDocument();
      expect(screen.queryByTestId('tab-list')).not.toBeInTheDocument();
    });
  });

  it('点击"低库存预警"切换到对应 Tab', async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.click(screen.getByText('低库存预警'));

    await waitFor(() => {
      expect(screen.getByTestId('tab-lowstock')).toBeInTheDocument();
      expect(screen.queryByTestId('tab-list')).not.toBeInTheDocument();
    });
  });

  it('在"出入库记录" Tab 下点击"库存列表"可切回', async () => {
    const user = userEvent.setup();
    render(<InventoryPage />);

    await user.click(screen.getByText('出入库记录'));
    expect(screen.getByTestId('tab-transactions')).toBeInTheDocument();

    await user.click(screen.getByText('库存列表'));
    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toBeInTheDocument();
    });
  });

  it('当前激活的 Tab 使用 primary 主题样式', () => {
    render(<InventoryPage />);
    const activeTab = screen.getByText('库存列表');
    expect(activeTab.className).toMatch(/border-primary|text-primary/);
  });
});
