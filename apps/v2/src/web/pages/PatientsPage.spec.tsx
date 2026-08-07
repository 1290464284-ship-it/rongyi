// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PatientsPage } from './PatientsPage';
import { apiRequest } from '../lib/api';
import { ToastProvider } from '../components/toast';

vi.mock('../lib/api', () => ({ apiRequest: vi.fn() }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  </MemoryRouter>
);

const patientList = {
  items: [{
    id: 'p1',
    code: 'P001',
    name: '张三',
    gender: 'MALE',
    phone: '13800000000',
    birthDate: '1990-01-01',
    source: 'WALK_IN',
    active: true,
    allergies: ['青霉素'],
  }],
  total: 1,
  page: 1,
  pageSize: 20,
};

describe('PatientsPage', () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiRequest).mockReset();
  });

  it('lists patients and creates a new patient after duplicate checks', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ id: 'p2' })
      .mockResolvedValueOnce({ ...patientList, total: 2 });
    render(<PatientsPage />, { wrapper });
    expect(await screen.findByText('张三')).toBeDefined();

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'P002' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李四' } });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13900000000' } });
    fireEvent.change(screen.getByLabelText('过敏史（每行一条）'), { target: { value: '花生\n鸡蛋' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients', expect.objectContaining({ method: 'POST' }));
    });
    const call = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/patients');
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      code: 'P002',
      name: '李四',
      phone: '13900000000',
      allergies: ['花生', '鸡蛋'],
      active: true,
      source: 'WALK_IN',
    });
    expect(await screen.findByText('患者档案已创建')).toBeDefined();
  });

  it('blocks duplicate phone or code before saving', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce(patientList);
    render(<PatientsPage />, { wrapper });
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('新建患者'));
    fireEvent.change(screen.getByLabelText('患者编号'), { target: { value: 'P001' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '重复' } });
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800000000' } });
    fireEvent.click(screen.getByText('保存'));

    expect(await screen.findByText('手机号或患者编号已存在，请检查后重试')).toBeDefined();
    expect(apiRequest).not.toHaveBeenCalledWith('/resources/patients', expect.objectContaining({ method: 'POST' }));
  });

  it('edits and deletes a patient', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(patientList);
    render(<PatientsPage />, { wrapper });
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('编辑'));
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '张三改' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'PATCH' }));
    });
    const updateCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/patients/p1');
    expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({
      name: '张三改',
      phone: '13800000000',
      allergies: ['青霉素'],
    });
    expect(await screen.findByText('患者档案已更新')).toBeDefined();

    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 });
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('确认删除'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(await screen.findByText('患者档案已删除')).toBeDefined();
  });

  it('prefills multiline fields when editing', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(patientList);
    render(<PatientsPage />, { wrapper });
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('编辑'));
    expect((screen.getByLabelText('过敏史（每行一条）') as HTMLTextAreaElement).value).toBe('青霉素');
    expect((screen.getByLabelText('患者编号') as HTMLInputElement).value).toBe('P001');
    fireEvent.change(screen.getByLabelText('过敏史（每行一条）'), { target: { value: '青霉素\n阿司匹林' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'PATCH' }));
    });
    const updateCall = vi.mocked(apiRequest).mock.calls.find(([path]) => path === '/resources/patients/p1');
    expect(JSON.parse(String(updateCall?.[1]?.body))).toMatchObject({
      allergies: ['青霉素', '阿司匹林'],
    });
    expect(await screen.findByText('患者档案已更新')).toBeDefined();
  });

  it('excludes the edited patient from duplicate checks', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce(patientList)
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(patientList);
    render(<PatientsPage />, { wrapper });
    await screen.findByText('张三');

    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith('/resources/patients/p1', expect.objectContaining({ method: 'PATCH' }));
    });
    expect(screen.queryByText('手机号或患者编号已存在，请检查后重试')).toBeNull();
    expect(await screen.findByText('患者档案已更新')).toBeDefined();
  });
});
