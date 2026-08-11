// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TemplateSection } from './TemplateSection';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';
import type { ShiftTemplate } from './types';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>{children}</ToastProvider>
  </QueryClientProvider>
);

function templateFixture(overrides: Partial<ShiftTemplate> = {}): ShiftTemplate {
  return {
    id: 't1',
    name: '早班',
    startTime: '09:00',
    endTime: '18:00',
    workDaysJson: '[1,2,3,4,5]',
    color: '#4F46E5',
    active: 1,
    ...overrides,
  } as ShiftTemplate;
}

describe('TemplateSection', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('creates a template with the selected workdays and color', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<TemplateSection templates={[]} reload={reload} />, { wrapper });
    fireEvent.change(await screen.findByLabelText('模板名称'), { target: { value: '晚班' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByLabelText('工作日 周一'));
    fireEvent.click(screen.getByLabelText('工作日 周六'));
    fireEvent.change(screen.getByLabelText('颜色'), { target: { value: '#10b981' } });
    fireEvent.click(screen.getByRole('button', { name: '新增模板' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/shift-templates',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: '晚班',
            startTime: '14:00',
            endTime: '22:00',
            workDaysJson: [2, 3, 4, 5, 6],
            color: '#10b981',
            active: true,
          }),
        }),
      );
    });
    expect(await screen.findByText('班次模板已创建')).toBeDefined();
    expect(reload).toHaveBeenCalled();
  });

  it('validates required template fields', async () => {
    render(<TemplateSection templates={[]} reload={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '新增模板' }));
    expect(await screen.findByText('请填写模板名称、时间并至少选择一个工作日')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/shift-templates', expect.objectContaining({ method: 'POST' }));
  });

  it('edits an existing template and PATCHes the row', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<TemplateSection templates={[templateFixture()]} reload={reload} />, { wrapper });
    await screen.findByText('早班');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    expect((screen.getByLabelText('模板名称') as HTMLInputElement).value).toBe('早班');
    expect((screen.getByLabelText('开始时间') as HTMLInputElement).value).toBe('09:00');
    expect((screen.getByLabelText('结束时间') as HTMLInputElement).value).toBe('18:00');
    expect((screen.getByLabelText('工作日 周一') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('启用模板') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '早班（更新）' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/resources/shiftTemplates/t1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(await screen.findByText('班次模板已更新')).toBeDefined();
    expect(reload).toHaveBeenCalled();
  });

  it('edits a sparse template with blank fallbacks', async () => {
    render(
      <TemplateSection
        templates={[{ id: 't2', name: null, startTime: null, endTime: null, workDaysJson: null, color: null, active: 0 } as unknown as ShiftTemplate]}
        reload={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    expect((screen.getByLabelText('模板名称') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('开始时间') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('结束时间') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('启用模板') as HTMLInputElement).checked).toBe(false);
  });

  it('toggles template active state and reports failures', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<TemplateSection templates={[templateFixture()]} reload={reload} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '停用' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/shift-templates/t1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: false }) }),
      );
    });
    expect(await screen.findByText('模板状态已更新')).toBeDefined();
    expect(reload).toHaveBeenCalled();

    cleanup();
    vi.mocked(apiRequest).mockRejectedValue('toggle failed');
    render(<TemplateSection templates={[templateFixture()]} reload={vi.fn()} />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: '停用' }));
    expect(await screen.findByText('更新模板状态失败')).toBeDefined();
  });

  it('deletes a template after confirmation and supports cancelling', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<TemplateSection templates={[templateFixture()]} reload={reload} />, { wrapper });
    await screen.findByText('早班');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog', { name: '删除班次模板' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/shiftTemplates/t1', expect.objectContaining({ method: 'DELETE' }));

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const confirm = await screen.findByRole('dialog', { name: '删除班次模板' });
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/shiftTemplates/t1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('班次模板已删除')).toBeDefined();
    expect(reload).toHaveBeenCalled();
  });
});
