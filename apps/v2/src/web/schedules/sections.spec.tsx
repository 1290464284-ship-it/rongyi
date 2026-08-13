// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GenerateSection } from './GenerateSection';
import { TemplateSection } from './TemplateSection';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

const templates = [
  {
    id: 't-1',
    name: '早班',
    startTime: '09:00',
    endTime: '18:00',
    workDaysJson: '[1,2,3,4,5]',
    workDays: [1, 2, 3, 4, 5],
    color: '#4F46E5',
    active: 1,
  },
  {
    id: 't-2',
    name: '晚班',
    startTime: '13:00',
    endTime: '22:00',
    workDaysJson: 'bad-json',
    workDays: undefined,
    color: null,
    active: 0,
  },
];

const users = [
  { id: 'user-1', name: '张医生' },
  { id: 'user-2', username: 'wang' },
];

describe('GenerateSection', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('asks for a user, template and week before generating', () => {
    render(
      <GenerateSection
        templates={templates}
        users={users}
        weekStart="2026-08-03"
        onWeekStartChange={vi.fn()}
        onGenerated={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: '生成固定排班' }));
    expect(screen.getByText('请选择用户、模板和周')).toBeDefined();
  });

  it('normalizes a picked date to Monday and posts the generation request', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ created: 5, skipped: 0 });
    const onWeekStartChange = vi.fn();
    const onGenerated = vi.fn();
    render(
      <GenerateSection
        templates={templates}
        users={users}
        weekStart="2026-08-03"
        onWeekStartChange={onWeekStartChange}
        onGenerated={onGenerated}
      />,
      { wrapper },
    );

    fireEvent.change(screen.getByLabelText('选择用户'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('选择模板'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('选择周'), { target: { value: '2026-08-12' } });
    expect(onWeekStartChange).toHaveBeenCalledWith('2026-08-10');

    fireEvent.click(screen.getByRole('button', { name: '生成固定排班' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/shift-templates/generate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/shift-templates/generate');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      templateId: 't-1',
      userId: 'user-1',
      weekStart: '2026-08-03',
    });
    expect(await screen.findByText('已生成 5 条固定排班')).toBeDefined();
    expect(onGenerated).toHaveBeenCalled();
  });

  it('shows a toast when generation fails', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('Load failed'));
    render(
      <GenerateSection
        templates={templates}
        users={users}
        weekStart="2026-08-03"
        onWeekStartChange={vi.fn()}
        onGenerated={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText('选择用户'), { target: { value: 'user-1' } });
    fireEvent.change(screen.getByLabelText('选择模板'), { target: { value: 't-1' } });
    fireEvent.click(screen.getByRole('button', { name: '生成固定排班' }));
    expect(await screen.findByText('网络请求失败，请重试')).toBeDefined();
  });

  it('falls back to the user id when name and username are absent', () => {
    render(
      <GenerateSection
        templates={templates}
        users={[{ id: 'user-x' }]}
        weekStart="2026-08-03"
        onWeekStartChange={vi.fn()}
        onGenerated={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByRole('option', { name: 'user-x' })).toBeDefined();
  });
});

describe('TemplateSection', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('validates the form before creating', () => {
    vi.mocked(apiRequest).mockResolvedValue({});
    render(<TemplateSection templates={[]} reload={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '新增模板' }));
    expect(screen.getByText('请填写模板名称、时间并至少选择一个工作日')).toBeDefined();
  });

  it('creates a template with workDaysJson payload', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ id: 't-new' });
    const reload = vi.fn();
    render(<TemplateSection templates={[]} reload={reload} />, { wrapper });
    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '晚班' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '13:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByLabelText('工作日 周一'));
    fireEvent.click(screen.getByRole('button', { name: '新增模板' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/shift-templates', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/shift-templates');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      name: '晚班',
      startTime: '13:00',
      endTime: '22:00',
      active: true,
      workDaysJson: [2, 3, 4, 5],
    });
    expect(await screen.findByText('班次模板已创建')).toBeDefined();
    expect(reload).toHaveBeenCalled();
  });

  it('loads an existing template into the form for editing', async () => {
    vi.mocked(apiRequest).mockResolvedValue({});
    const reload = vi.fn();
    render(<TemplateSection templates={templates} reload={reload} />, { wrapper });
    const editButton = await screen.findAllByRole('button', { name: '编辑' });
    fireEvent.click(editButton[1]);

    expect((screen.getByLabelText('模板名称') as HTMLInputElement).value).toBe('晚班');
    expect((screen.getByLabelText('开始时间') as HTMLInputElement).value).toBe('13:00');
    expect((screen.getByLabelText('启用模板') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/shiftTemplates/t-2', expect.objectContaining({ method: 'PATCH' }));
    });
  });

  it('deletes a template after confirmation', async () => {
    vi.mocked(apiRequest).mockResolvedValue({});
    const reload = vi.fn();
    render(<TemplateSection templates={templates} reload={reload} />, { wrapper });
    const deleteButtons = await screen.findAllByRole('button', { name: '删除' });
    fireEvent.click(deleteButtons[0]);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(withinDialog(dialog, '删除'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/shiftTemplates/t-1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('班次模板已删除')).toBeDefined();
    expect(reload).toHaveBeenCalled();
  });

  it('toggles a template active state', async () => {
    vi.mocked(apiRequest).mockResolvedValue({});
    const reload = vi.fn();
    render(<TemplateSection templates={templates} reload={reload} />, { wrapper });
    fireEvent.click((await screen.findAllByRole('button', { name: '停用' }))[0]);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/shift-templates/t-1', expect.objectContaining({ method: 'PATCH' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/shift-templates/t-1');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ active: false });
    expect(reload).toHaveBeenCalled();
  });
});

function withinDialog(dialog: HTMLElement, name: string) {
  return Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === name) as HTMLButtonElement;
}
