// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResourceHub } from './ResourceHub';
import { analyticsHubTabs, systemHubTabs, type HubTab } from './hub-tabs';
import { apiRequest } from '../lib/api';
import { ToastProvider } from './toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const definition = {
  name: 'patients',
  table: 'Patient',
  fields: [{ name: 'name', type: 'text', required: true }],
  capabilities: { create: false, update: false, delete: false, softDelete: false },
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}><ToastProvider>{children}</ToastProvider></QueryClientProvider>
);

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.mocked(apiRequest).mockReset();
});

describe('ResourceHub', () => {
  it('renders custom tabs and hides write controls for read-only resources', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([definition])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    const tabs: HubTab[] = [
      { id: 'resource', label: 'Resource', kind: 'resource', resource: 'patients' },
      { id: 'custom', label: 'Custom', kind: 'custom', component: () => <div>Custom tab</div> },
    ];
    render(<ResourceHub title="Hub" tabs={tabs} />, { wrapper });
    expect(await screen.findByText('Hub')).toBeDefined();
    expect(screen.queryByText('新建')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));
    expect(screen.getByText('Custom tab')).toBeDefined();
  });

  it('shows create controls when the resource is writable', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce([{ ...definition, capabilities: { create: true, update: false, delete: false, softDelete: false } }])
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    render(<ResourceHub title="Hub" tabs={[{ id: 'resource', label: 'Resource', kind: 'resource', resource: 'patients' }]} />, { wrapper });
    expect(await screen.findByText('新建')).toBeDefined();
  });

  it('renders empty tab lists without crashing', () => {
    render(<ResourceHub title="Empty" tabs={[]} />, { wrapper });
    expect(screen.getByText('Empty')).toBeDefined();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('renders unknown tab kinds as an empty panel', () => {
    const tabs = [{ id: 'unknown', label: 'Unknown', kind: 'unknown' } as unknown as HubTab];
    render(<ResourceHub title="Unknown Hub" tabs={tabs} />, { wrapper });
    expect(screen.getByText('Unknown')).toBeDefined();
  });

  it('renders analytics custom tab components', async () => {
    const tabs = analyticsHubTabs.filter((tab) => tab.id !== 'dashboard' && tab.id !== 'satisfaction');
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/auth/navigation') return { role: 'BOSS' };
      return [];
    });
    render(<ResourceHub title="Analytics" tabs={tabs} />, { wrapper });
    expect(await screen.findByText('RFM')).toBeDefined();
    expect(await screen.findByText(/\u591a\u95e8\u5e97/)).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: '月度报表' }));
    fireEvent.click(screen.getByRole('tab', { name: '库存报表' }));
    fireEvent.click(screen.getByRole('tab', { name: 'RFM' }));
    fireEvent.click(screen.getByRole('tab', { name: '流失预警' }));
  });
});

it('renders grouped tabs and filters tabs by label', async () => {
  vi.mocked(apiRequest).mockResolvedValue([]);
  render(<ResourceHub title="System" tabs={systemHubTabs} />, { wrapper });
  expect(await screen.findByText('运维')).toBeDefined();
  expect(screen.getByText('配置')).toBeDefined();

  fireEvent.change(screen.getByLabelText('System筛选'), { target: { value: '备份' } });
  expect(screen.getByRole('tab', { name: '备份' })).toBeDefined();
  expect(screen.queryByRole('tab', { name: '告警' })).toBeNull();

  fireEvent.change(screen.getByLabelText('System筛选'), { target: { value: '' } });
  expect(screen.getByRole('tab', { name: '告警' })).toBeDefined();
});
it('shows an empty state when the page filter matches nothing', async () => {
  vi.mocked(apiRequest).mockResolvedValue([]);
  render(<ResourceHub title="System" tabs={systemHubTabs} />, { wrapper });
  await screen.findByText('运维');
  fireEvent.change(screen.getByLabelText('System筛选'), { target: { value: '不存在的页面' } });
  expect(await screen.findByText('没有匹配的页面')).toBeDefined();
  expect(screen.queryByRole('tablist')).toBeNull();
});
it('hides boss-only analytics tabs from non-BOSS roles', async () => {
  const tabs = analyticsHubTabs.filter((tab) => tab.id !== 'dashboard' && tab.id !== 'satisfaction');
  vi.mocked(apiRequest).mockImplementation(async (path: string) => {
    if (path === '/auth/navigation') return { role: 'ADMIN' };
    return [];
  });
  render(<ResourceHub title="Analytics" tabs={tabs} />, { wrapper });
  expect(await screen.findByText('RFM')).toBeDefined();
  await waitFor(() => expect(screen.queryByText(/\u591a\u95e8\u5e97/)).toBeNull());
});

it('unmounts inactive tab panels so hub state does not accumulate', async () => {
  const mountCounts: Record<string, number> = {};
  function Counter({ id }: { id: string }) {
    useEffect(() => {
      mountCounts[id] = (mountCounts[id] ?? 0) + 1;
    }, [id]);
    return <div>{id} panel</div>;
  }
  const tabs: HubTab[] = [
    { id: 'a', label: 'A', kind: 'custom', component: () => <Counter id="a" /> },
    { id: 'b', label: 'B', kind: 'custom', component: () => <Counter id="b" /> },
  ];
  render(<ResourceHub title="Hub" tabs={tabs} />, { wrapper });
  expect(mountCounts.a).toBe(1);
  fireEvent.click(screen.getByRole('tab', { name: 'B' }));
  expect(mountCounts.b).toBe(1);
  // M3：非活动面板已卸载，不再常驻（useQuery 订阅与组件实例随之释放）
  expect(screen.queryByText('a panel')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'A' }));
  expect(mountCounts.a).toBe(2); // 切回重新挂载
  expect(screen.getByText('a panel')).toBeDefined();
});

it('exposes selected tab state and supports arrow key navigation', async () => {
  const tabs: HubTab[] = [
    { id: 'one', label: 'One', kind: 'custom', component: () => <div>One panel</div> },
    { id: 'two', label: 'Two', kind: 'custom', component: () => <div>Two panel</div> },
    { id: 'three', label: 'Three', kind: 'custom', component: () => <div>Three panel</div> },
  ];
  render(<ResourceHub title="Hub" tabs={tabs} />, { wrapper });
  const first = screen.getByRole('tab', { name: 'One' });
  expect(first.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tab', { name: 'Two' }).getAttribute('aria-selected')).toBe('false');
  expect(first.getAttribute('aria-controls')).toBe('hub-panel-one');

  fireEvent.keyDown(first, { key: 'ArrowRight' });
  const second = screen.getByRole('tab', { name: 'Two' });
  expect(second.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(second);
  expect(screen.getByText('Two panel')).toBeDefined();

  fireEvent.keyDown(second, { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'One' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Three' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Three' }), { key: 'Home' });
  expect(screen.getByRole('tab', { name: 'One' }).getAttribute('aria-selected')).toBe('true');
});
