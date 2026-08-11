// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router';
import App from './App';

vi.mock('./components/Layout', () => ({
  Layout: () => <Outlet />,
}));

vi.mock('./components/ResourceHub', () => ({
  ResourceHub: ({ title }: { title: string }) => <div data-testid="hub-title">{title}</div>,
}));

vi.mock('./components/ResourcePage', () => ({
  ResourcePage: ({ resource }: { resource?: string }) => <div data-testid="resource-page">{resource}</div>,
}));

vi.mock('./components/hub-tabs', () => ({
  patientHubTabs: [],
  frontDeskHubTabs: [],
  clinicalHubTabs: [],
  financeHubTabs: [],
  inventoryHubTabs: [],
  communicationHubTabs: [],
  hrHubTabs: [],
  systemHubTabs: [],
  analyticsHubTabs: [],
}));

vi.mock('./components', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./pages/auth/LoginPage', () => ({
  LoginPage: () => <div>登录页</div>,
}));

vi.mock('./pages/analytics/DashboardPage', () => ({
  DashboardPage: () => <div>工作台</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App routing', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the login route', () => {
    renderAt('/login');
    expect(screen.getByText('登录页')).toBeDefined();
  });

  it('renders the dashboard index route', () => {
    renderAt('/');
    expect(screen.getByText('工作台')).toBeDefined();
  });

  it('redirects legacy hub paths to their new hubs', async () => {
    renderAt('/charges');
    expect(await screen.findByTestId('hub-title')).toBeDefined();
    expect(screen.getByText('财务中心')).toBeDefined();
    cleanup();

    renderAt('/follow-ups');
    expect(await screen.findByText('随访与沟通')).toBeDefined();
    cleanup();

    renderAt('/backups');
    expect(await screen.findByText('系统管理')).toBeDefined();
  });

  it('renders generic resource pages under resources/:resource', () => {
    renderAt('/resources/suppliers');
    expect(screen.getByTestId('resource-page').textContent).toBe('suppliers');
  });

  it('renders the front desk hub route', () => {
    renderAt('/front-desk');
    expect(screen.getByText('前台工作')).toBeDefined();
  });
});
