import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

// Mock all tab components
vi.mock('../components/WorkbenchTab', () => ({
  WorkbenchTab: () => <div data-testid="workbench-tab">回访工作台内容</div>,
}));
vi.mock('../components/TemplatesTab', () => ({
  TemplatesTab: () => <div data-testid="templates-tab">回访模板内容</div>,
}));
vi.mock('../components/ItemsTab', () => ({
  ItemsTab: () => <div data-testid="items-tab">回访项目内容</div>,
}));
vi.mock('../components/AutoRulesTab', () => ({
  AutoRulesTab: () => <div data-testid="auto-rules-tab">自动规则内容</div>,
}));
vi.mock('../components/StatsTab', () => ({
  StatsTab: () => <div data-testid="stats-tab">统计分析内容</div>,
}));

import FollowUpsPage from '../FollowUpsPage';

describe('FollowUpsPage 回访管理', () => {
  it('渲染标题和所有标签页', () => {
    render(<FollowUpsPage />);
    expect(screen.getByText('回访管理')).toBeInTheDocument();
    expect(screen.getByText('回访工作台')).toBeInTheDocument();
    expect(screen.getByText('回访模板')).toBeInTheDocument();
    expect(screen.getByText('回访项目')).toBeInTheDocument();
    expect(screen.getByText('自动规则')).toBeInTheDocument();
    expect(screen.getByText('统计分析')).toBeInTheDocument();
  });

  it('默认显示回访工作台', () => {
    render(<FollowUpsPage />);
    expect(screen.getByTestId('workbench-tab')).toBeInTheDocument();
  });

  it('点击标签页切换内容', async () => {
    const user = userEvent.setup();
    render(<FollowUpsPage />);

    await user.click(screen.getByText('回访模板'));
    expect(screen.getByTestId('templates-tab')).toBeInTheDocument();

    await user.click(screen.getByText('统计分析'));
    expect(screen.getByTestId('stats-tab')).toBeInTheDocument();
  });
});
