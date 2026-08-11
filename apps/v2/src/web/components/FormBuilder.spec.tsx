// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormBuilder } from './FormBuilder';
import { apiRequest } from '../lib/api';
import type { ResourceField } from '../../domain/contracts';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('FormBuilder', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('renders scalar fields and forwards changes', () => {
    const fields: ResourceField[] = [
      { name: 'active', type: 'boolean', label: '启用' },
      { name: 'status', type: 'enum', label: '状态', enumValues: ['OPEN', 'DONE'], enumLabels: { OPEN: '进行中', DONE: '完成' } },
      { name: 'notes', type: 'longText', label: '备注' },
      { name: 'payload', type: 'json', label: '数据' },
      { name: 'takenAt', type: 'datetime', label: '时间' },
      { name: 'day', type: 'date', label: '日期' },
      { name: 'qty', type: 'number', label: '数量' },
      { name: 'price', type: 'money', label: '金额' },
      { name: 'ratio', type: 'decimal', label: '比例' },
      { name: 'name', type: 'text', label: '名称', helpText: '必填', required: true, placeholder: '请输入' },
    ];
    const values: Record<string, unknown> = {
      active: false,
      status: 'OPEN',
      notes: '',
      payload: '',
      takenAt: '',
      day: '',
      qty: '',
      price: '',
      ratio: '',
      name: '',
    };
    const onChange = vi.fn((name: string, value: unknown) => {
      values[name] = value;
    });
    render(<FormBuilder fields={fields} values={values} onChange={onChange} />, { wrapper });

    fireEvent.click(screen.getByLabelText('启用'));
    expect(onChange).toHaveBeenCalledWith('active', true);
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'DONE' } });
    expect(onChange).toHaveBeenCalledWith('status', 'DONE');
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: 'note' } });
    expect(onChange).toHaveBeenCalledWith('notes', 'note');
    fireEvent.change(screen.getByLabelText('数据'), { target: { value: '{}' } });
    expect(onChange).toHaveBeenCalledWith('payload', '{}');
    fireEvent.change(screen.getByLabelText('时间'), { target: { value: '2026-08-10T10:30' } });
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-08-10' } });
    fireEvent.change(screen.getByLabelText('数量'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('金额'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('比例'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByPlaceholderText('请输入'), { target: { value: '张三' } });
    expect(onChange).toHaveBeenCalledWith('takenAt', '2026-08-10T10:30');
    expect(onChange).toHaveBeenCalledWith('day', '2026-08-10');
    expect(onChange).toHaveBeenCalledWith('qty', '2');
    expect(onChange).toHaveBeenCalledWith('price', '100');
    expect(onChange).toHaveBeenCalledWith('ratio', '0.5');
    expect(onChange).toHaveBeenCalledWith('name', '张三');
    expect(screen.getByText('必填')).toBeDefined();
  });

  it('searches and loads more relation options', async () => {
    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path === '/resources/patients?page=1&pageSize=50') {
        const items = Array.from({ length: 50 }, (_, index) => ({
          id: `p${index + 1}`,
          name: index === 0 ? '甲' : index === 1 ? '乙' : `项目${index + 1}`,
        }));
        return { items, total: 150, page: 1, pageSize: 50 };
      }
      if (path === '/resources/patients?page=2&pageSize=50') {
        const items = Array.from({ length: 50 }, (_, index) => ({
          id: `p${index + 51}`,
          name: index === 0 ? '丙' : `项目${index + 51}`,
        }));
        return { items, total: 150, page: 2, pageSize: 50 };
      }
      if (path.includes('search=')) return { items: [{ id: 'p1', name: '甲' }], total: 1, page: 1, pageSize: 50 };
      return { items: [], total: 0, page: 1, pageSize: 50 };
    });
    const fields: ResourceField[] = [
      { name: 'patientId', type: 'relation', label: '患者', relation: { resource: 'patients', foreignKey: 'patientId', labelField: 'name' } },
    ];
    const onChange = vi.fn();
    render(<FormBuilder fields={fields} values={{ patientId: '' }} onChange={onChange} />, { wrapper });
    expect(await screen.findByRole('option', { name: '甲' })).toBeDefined();
    expect(screen.getByRole('option', { name: '乙' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByRole('option', { name: '丙' })).toBeDefined();
    fireEvent.change(screen.getByLabelText('患者'), { target: { value: 'p3' } });
    expect(onChange).toHaveBeenCalledWith('patientId', 'p3');

    fireEvent.change(screen.getByLabelText('搜索patients'), { target: { value: '甲' } });
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients?page=1&pageSize=50&search=%E7%94%B2');
    });
    expect(await screen.findByRole('option', { name: '甲' })).toBeDefined();
    expect(screen.queryByRole('option', { name: '乙' })).toBeNull();
  });
});
