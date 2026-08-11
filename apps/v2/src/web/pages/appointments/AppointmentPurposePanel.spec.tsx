// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AppointmentPurposePanel } from './AppointmentPurposePanel';
import { apiRequest } from '../../lib/api';
import { ToastProvider } from '../../components/toast';
import type { Page } from '../../lib/types';
import type { PurposeRow } from '../../appointments/types';
import type { ToastKind } from '../../lib/toast-context';

vi.mock('../../lib/api', () => ({ apiRequest: vi.fn(), downloadCsv: vi.fn() }));

const purposePage = {
  items: [
    { id: 'p-1', name: '初诊咨询', color: '#3b82f6', sortOrder: 1, active: 1 },
    { id: 'p-2', name: '复诊', color: null, sortOrder: 2, active: 0 },
  ],
  total: 2,
  page: 1,
  pageSize: 100,
};

function PanelHarness({ showToast }: { showToast: Mock<(message: string, kind?: ToastKind) => void> }) {
  const purposes = useQuery({
    queryKey: ['purposes-test'],
    queryFn: () => apiRequest<Page<PurposeRow>>('/resources/appointmentPurposes?page=1&pageSize=100'),
  });
  return (
    <AppointmentPurposePanel
      purposes={purposes}
      showToast={showToast}
    />
  );
}

function renderPanel(showToast: Mock<(message: string, kind?: ToastKind) => void>) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <PanelHarness showToast={showToast} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('AppointmentPurposePanel', () => {
  let showToast: Mock<(message: string, kind?: ToastKind) => void>;

  beforeEach(() => {
    showToast = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders purposes and adds a new one', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return options?.method === 'POST' ? { items: [], total: 0, page: 1, pageSize: 100 } : purposePage;
      }
      return {};
    });
    renderPanel(showToast);
    expect(await screen.findByText('初诊咨询')).toBeDefined();
    expect(screen.getByText('复诊')).toBeDefined();
    expect(screen.getAllByRole('button', { name: '停用' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '启用' })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('新事项名称'), { target: { value: '急诊' } });
    fireEvent.click(screen.getByRole('button', { name: '添加事项' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/resources/appointmentPurposes',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '急诊', active: true }) }),
      );
    });
    expect(showToast).toHaveBeenCalledWith('事项已添加', 'success');
  });

  it('validates the purpose name and toggles active state', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return options?.method === 'PATCH' ? { items: [], total: 0, page: 1, pageSize: 100 } : purposePage;
      }
      return {};
    });
    renderPanel(showToast);
    await screen.findByText('初诊咨询');

    fireEvent.click(screen.getByRole('button', { name: '添加事项' }));
    expect(showToast).toHaveBeenCalledWith('请输入事项名称', 'error');
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/appointmentPurposes', expect.objectContaining({ method: 'POST' }));

    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/resources/appointmentPurposes/p-1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: false }) }),
      );
    });
    expect(showToast).toHaveBeenCalledWith('事项状态已更新', 'success');
  });

  it('edits and deletes a purpose after confirmation', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return options?.method === 'PATCH' || options?.method === 'DELETE'
          ? { items: [], total: 0, page: 1, pageSize: 100 }
          : purposePage;
      }
      return {};
    });
    renderPanel(showToast);
    await screen.findByText('初诊咨询');

    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    fireEvent.change(screen.getByLabelText('事项名称'), { target: { value: '初诊咨询（更新）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/resources/appointmentPurposes/p-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: '初诊咨询（更新）', color: '#3b82f6', sortOrder: 1, active: true }),
        }),
      );
    });
    expect(showToast).toHaveBeenCalledWith('事项已更新', 'success');

    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    expect(screen.getByText(/确定删除事项「初诊咨询」吗/)).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointmentPurposes/p-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(showToast).toHaveBeenCalledWith('事项已删除', 'success');
  });

  it('reports action failures and renders an empty purpose list', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/resources/appointmentPurposes' && options?.method === 'POST') throw new Error('add failed');
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return { items: [], total: 0, page: 1, pageSize: 100 };
      }
      return {};
    });
    renderPanel(showToast);
    expect(await screen.findByRole('button', { name: '添加事项' })).toBeDefined();

    fireEvent.change(screen.getByLabelText('新事项名称'), { target: { value: '急诊' } });
    fireEvent.click(screen.getByRole('button', { name: '添加事项' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/appointmentPurposes', expect.objectContaining({ method: 'POST' }));
    });
    expect(showToast).toHaveBeenCalledWith('操作失败，请稍后重试', 'error');
  });

  it('reports toggle failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/resources/appointmentPurposes/p-1') throw new Error('');
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return purposePage;
      }
      return {};
    });
    renderPanel(showToast);
    await screen.findByText('初诊咨询');
    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('更新事项失败', 'error');
    });
  });

  it('validates and reports edit failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'PATCH' && path === '/resources/appointmentPurposes/p-1') throw new Error('');
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return purposePage;
      }
      return {};
    });
    renderPanel(showToast);
    await screen.findByText('初诊咨询');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    const nameInput = screen.getByLabelText('事项名称') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(showToast).toHaveBeenCalledWith('请输入事项名称', 'error');

    fireEvent.change(nameInput, { target: { value: '初诊咨询（更新）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('更新事项失败', 'error');
    });
  });

  it('reports delete failures', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string, init?: RequestInit) => {
      const method = String(init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE' && path === '/resources/appointmentPurposes/p-1') throw new Error('');
      if (path === '/resources/appointmentPurposes?page=1&pageSize=100') {
        return purposePage;
      }
      return {};
    });
    renderPanel(showToast);
    await screen.findByText('初诊咨询');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!);
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('删除事项失败', 'error');
    });
  });
});
